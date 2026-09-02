/*
 * Collects the version of every artefact a product repo publishes -- from the
 * repo's own manifests and from the registries it publishes to -- and writes a
 * machine-readable snapshot plus a rendered table.
 *
 * It answers two questions nothing else in the org answers:
 *
 *   1. Did a release land everywhere? One tag publishes to crates.io, PyPI, npm
 *      (the main package plus six platform packages), NuGet, Maven Central and
 *      r-universe. Any one of those can fail on its own -- v0.2.0 shipped
 *      without a GitHub release because npm's spam filter blocked a platform
 *      package -- and today a partial release is only visible by opening six
 *      registry pages by hand.
 *   2. Do the manifests inside the repo agree with the tag? A version bump
 *      touches a dozen files across six languages, and a missed one stays
 *      invisible until some later publish job fails on it.
 *   3. Is a repo still building against a sibling crate that has moved on? Each
 *      locked wickra crate is compared with what that crate publishes, and the
 *      declared pin decides whether the gap is a stale lockfile or a range that
 *      cannot reach the newer release at all.
 *
 * No version here is declared: every number comes from a manifest or from a
 * registry. The repo list comes from repos.mjs, and the only hand-written
 * values are the package ids whose casing is not derivable, which repos.mjs
 * already owns.
 *
 * All manifests of a repo are fetched in a single GraphQL query -- one round
 * trip instead of one REST call per file, which is what makes this affordable
 * once it covers all 25 product repos rather than the pilot's one.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { REPOS } from './repos.mjs'

const OWNER = 'wickra-lib'
const OUT_DIR = 'versions'

// Pilot scope, chosen so each addition has to prove something the one before
// could not: wickra is the widest case in the org, wickra-backtest is the first
// repo the paths were not written against, and wickra-exchange is the first that
// has never released. Widen to REPOS.map(r => r.repo) once the table still reads
// well at that length.
const PILOT = ['wickra', 'wickra-backtest', 'wickra-exchange']

const UA = 'wickra-lib-version-snapshot (https://github.com/wickra-lib/.github)'

// --- Networking --------------------------------------------------------------
//
// A full scan is a few hundred requests an hour across six third-party services,
// so a transient 5xx or a DNS blip is a matter of when, not if. Retrying keeps
// those from turning into red runs that mean nothing; a service that is still
// down afterwards is reported as unreachable in the table rather than taking the
// whole scan with it.

const ATTEMPTS = 3

class Unreachable extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(url, init) {
  let reason = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch(url, init)
    } catch (err) {
      // DNS, TLS and socket failures land here, and all of them are worth
      // another try.
      reason = err.message
      if (attempt < ATTEMPTS) await sleep(attempt * 500)
      continue
    }
    if (res.status === 404) return null
    if (res.ok) return res
    // Anything else in the 4xx range means the request itself is wrong -- a bad
    // package name, a missing User-Agent -- and repeating it cannot help.
    if (res.status < 500 && res.status !== 429) throw new Error(`${url} -> HTTP ${res.status}`)
    reason = `HTTP ${res.status}`
    if (attempt < ATTEMPTS) await sleep(attempt * 500)
  }
  throw new Unreachable(`${url} unreachable after ${ATTEMPTS} attempts: ${reason}`)
}

// Runs one registry lookup, turning an unreachable service into a rendered cell
// instead of a failed run. Anything else still throws: a wrong package name is
// a bug in the config, not weather.
async function probe(lookup) {
  try {
    return { version: await lookup() }
  } catch (err) {
    if (err instanceof Unreachable) return { version: null, unreachable: true }
    throw err
  }
}

// Files read per repo. Paths that differ per repo are derived from that repo's
// entry in repos.mjs rather than spelled out again here.
function manifestPaths(entry) {
  const csharpDir = entry.nuget
  return {
    cargoToml: 'Cargo.toml',
    cargoLock: 'Cargo.lock',
    pyproject: 'bindings/python/pyproject.toml',
    nodePkg: 'bindings/node/package.json',
    // The wasm npm package is built by wasm-pack, so its package.json is a
    // build artefact and gitignored. The crate manifest is what tells us the
    // binding exists at all; the version only exists in the registry.
    wasmCargo: 'bindings/wasm/Cargo.toml',
    csproj: csharpDir ? `bindings/csharp/${csharpDir}/${csharpDir}.csproj` : null,
    pom: 'bindings/java/pom.xml',
    rDescription: 'bindings/r/DESCRIPTION',
    goMod: 'bindings/go/go.mod',
  }
}

// --- GraphQL -----------------------------------------------------------------

// Unlike a registry lookup this is not allowed to degrade: without the
// manifests there is no version to compare anything against, and a table full
// of unknowns would read like mass drift rather than like a failed scan.
async function graphql(query, variables) {
  const res = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${process.env.GH_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': UA,
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json()
  if (body.errors) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join('; ')}`)
  return body.data
}

// One query per repo: every manifest as an aliased blob, the newest tag, and
// the newest tag of the -go mirror (a Go module carries no version in go.mod --
// the tag is the version).
function repoQuery(paths) {
  const blobs = Object.entries(paths)
    .filter(([, path]) => path !== null)
    .map(([alias, path]) => `${alias}: object(expression: "HEAD:${path}") { ...blob }`)
    .join('\n        ')

  return `
    fragment blob on Blob { text isTruncated byteSize }
    fragment newestTag on Repository {
      refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        nodes { name }
      }
    }
    query ($owner: String!, $name: String!, $goName: String!) {
      repo: repository(owner: $owner, name: $name) {
        ...newestTag
        ${blobs}
      }
      go: repository(owner: $owner, name: $goName) { ...newestTag }
    }`
}

function blobText(node) {
  if (!node) return null
  if (node.isTruncated) throw new Error(`blob truncated at ${node.byteSize} bytes; GraphQL cannot return it whole`)
  return node.text
}

const tagName = (repo) => repo?.refs?.nodes?.[0]?.name ?? null

// --- Manifest parsing --------------------------------------------------------
//
// Deliberately regex-based rather than pulling in TOML and XML parsers: every
// field read here is one well-known key in a machine-generated or
// convention-formatted file, and the alternative is three new dependencies in a
// repo whose only ones today render an SVG.

const stripV = (tag) => tag.replace(/^v/, '')

function cargoWorkspaceVersion(toml) {
  const section = toml.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/)
  return section?.[1].match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? null
}

// The pins this repo declares on other wickra crates, e.g. wickra-core = "1".
function cargoWorkspaceDeps(toml) {
  const section = toml.match(/\[workspace\.dependencies\]([\s\S]*?)(?:\n\[|$)/)
  if (!section) return {}
  const pins = {}
  for (const line of section[1].split('\n')) {
    const pin = line.match(/^\s*(wickra[\w-]*)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/)
    if (pin) pins[pin[1]] = pin[2] ?? pin[3]
  }
  return pins
}

// Every wickra package the lock actually resolved to, plus who pulled it in.
// Two entries under one name is the cross-repo diamond that made this worth
// writing: wickra-terminal resolves wickra-core twice, 1.0.x directly and 0.9.9
// through wickra-exchange-core.
function cargoLockWickra(lock) {
  const resolved = new Map()
  const dependants = new Map()
  for (const block of lock.split('\n[[package]]\n').slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1]
    const version = block.match(/^version = "([^"]+)"/m)?.[1]
    if (!name || !version) continue
    const deps = block.match(/^dependencies = \[([\s\S]*?)\]/m)?.[1] ?? ''
    for (const dep of deps.matchAll(/"(wickra[\w-]*)"/g)) {
      if (!dependants.has(dep[1])) dependants.set(dep[1], new Set())
      dependants.get(dep[1]).add(name)
    }
    if (!name.startsWith('wickra')) continue
    const source = block.match(/^source = "([^"]+)"/m)?.[1] ?? 'path'
    if (!resolved.has(name)) resolved.set(name, [])
    resolved.get(name).push({ version, source })
  }
  return [...resolved.entries()]
    .map(([name, entries]) => ({
      name,
      versions: entries.map((e) => e.version).sort(),
      // A crate pulled from crates.io can be compared against what it publishes;
      // a workspace member resolved by path is this repo's own code and has
      // nothing to lag behind.
      fromRegistry: entries.some((e) => e.source.startsWith('registry+')),
      pulledInBy: [...(dependants.get(name) ?? [])].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const pyprojectVersion = (toml) => toml.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? null
const csprojVersion = (xml) => xml.match(/<Version>([^<]+)<\/Version>/)?.[1] ?? null
const descriptionVersion = (txt) => txt.match(/^Version:\s*(\S+)/m)?.[1] ?? null
const goModule = (txt) => txt.match(/^module\s+(\S+)/m)?.[1] ?? null

// The artefact's own coordinates, i.e. not a dependency's and not the parent
// POM's -- both of those blocks are dropped before matching.
const pomBody = (xml) =>
  xml.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '')

const pomVersion = (xml) => pomBody(xml).match(/<version>([^<]+)<\/version>/)?.[1] ?? null
const pomGroupId = (xml) => pomBody(xml).match(/<groupId>([^<]+)<\/groupId>/)?.[1] ?? null
const pomArtifactId = (xml) => pomBody(xml).match(/<artifactId>([^<]+)<\/artifactId>/)?.[1] ?? null

// --- Registries --------------------------------------------------------------

async function json(url) {
  const res = await request(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
  return res === null ? null : res.json()
}

async function xml(url) {
  const res = await request(url, { headers: { 'user-agent': UA } })
  return res === null ? null : res.text()
}

const registry = {
  // crates.io rejects requests whose User-Agent carries no contact address.
  crates: async (name) => (await json(`https://crates.io/api/v1/crates/${name}`))?.crate?.max_stable_version ?? null,
  pypi: async (name) => (await json(`https://pypi.org/pypi/${name}/json`))?.info?.version ?? null,
  npm: async (name) => (await json(`https://registry.npmjs.org/${encodeURIComponent(name)}`))?.['dist-tags']?.latest ?? null,
  nuget: async (id) => (await json(`https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`))?.versions?.at(-1) ?? null,
  maven: async (groupId, artifactId) => {
    const meta = await xml(`https://repo1.maven.org/maven2/${groupId.replaceAll('.', '/')}/${artifactId}/maven-metadata.xml`)
    return meta?.match(/<release>([^<]+)<\/release>/)?.[1] ?? null
  },
  runiverse: async (name) => (await json(`https://${OWNER}.r-universe.dev/api/packages/${name}`))?.Version ?? null,
}

// --- Scan --------------------------------------------------------------------

async function scanRepo(entry) {
  const name = entry.repo
  const goRepo = entry.go ?? `${name}-go`
  const paths = manifestPaths(entry)
  const data = await graphql(repoQuery(paths), { owner: OWNER, name, goName: goRepo })

  const files = Object.fromEntries(Object.keys(paths).map((alias) => [alias, blobText(data.repo[alias])]))

  const declared = files.cargoToml ? cargoWorkspaceVersion(files.cargoToml) : null
  const nodePkg = files.nodePkg ? JSON.parse(files.nodePkg) : null
  const platformPkgs = Object.entries(nodePkg?.optionalDependencies ?? {})

  const manifests = [
    { file: 'Cargo.toml', ecosystem: 'cargo', version: declared },
    { file: 'bindings/python/pyproject.toml', ecosystem: 'python', version: files.pyproject ? pyprojectVersion(files.pyproject) : null },
    { file: 'bindings/node/package.json', ecosystem: 'npm', version: nodePkg?.version ?? null },
    { file: paths.csproj, ecosystem: 'nuget', version: files.csproj ? csprojVersion(files.csproj) : null },
    { file: 'bindings/java/pom.xml', ecosystem: 'maven', version: files.pom ? pomVersion(files.pom) : null },
    { file: 'bindings/r/DESCRIPTION', ecosystem: 'r', version: files.rDescription ? descriptionVersion(files.rDescription) : null },
    ...platformPkgs.map(([pkg, version]) => ({ file: `bindings/node/package.json optionalDependencies.${pkg}`, ecosystem: 'npm', version })),
  ].filter((m) => m.file !== null)

  const crateName = entry.crate ?? name
  const npmName = nodePkg?.name ?? name
  const runivName = entry.runiv ?? name.replaceAll('-', '')
  const groupId = files.pom ? pomGroupId(files.pom) : null
  const artifactId = files.pom ? pomArtifactId(files.pom) : null

  const published = [
    { registry: 'crates.io', pkg: crateName, ...(await probe(() => registry.crates(crateName))) },
    { registry: 'PyPI', pkg: name, ...(await probe(() => registry.pypi(name))) },
    { registry: 'npm', pkg: npmName, ...(await probe(() => registry.npm(npmName))) },
    ...(await Promise.all(
      platformPkgs.map(async ([pkg]) => ({ registry: 'npm', pkg, ...(await probe(() => registry.npm(pkg))) })),
    )),
    ...(files.wasmCargo
      ? [{ registry: 'npm', pkg: `${name}-wasm`, ...(await probe(() => registry.npm(`${name}-wasm`))) }]
      : []),
    ...(entry.nuget ? [{ registry: 'NuGet', pkg: entry.nuget, ...(await probe(() => registry.nuget(entry.nuget))) }] : []),
    ...(groupId && artifactId
      ? [
          {
            registry: 'Maven',
            pkg: `${groupId}:${artifactId}`,
            ...(await probe(() => registry.maven(groupId, artifactId))),
          },
        ]
      : []),
    { registry: 'r-universe', pkg: runivName, ...(await probe(() => registry.runiverse(runivName))) },
  ]

  return {
    repo: name,
    declared,
    tag: tagName(data.repo),
    manifests,
    published,
    go: { repo: goRepo, module: files.goMod ? goModule(files.goMod) : null, tag: tagName(data.go) },
    pins: files.cargoToml ? cargoWorkspaceDeps(files.cargoToml) : {},
    lock: files.cargoLock ? cargoLockWickra(files.cargoLock) : [],
  }
}

// --- Render ------------------------------------------------------------------

// A registry that does not carry a package is only a finding once the repo has
// released at all. Without that distinction every pre-release repo -- and the
// org has several -- would report its whole artefact list as missing, which is
// the opposite of what this table is for: `missing` has to keep meaning "this
// one publish target fell out while the others went through".
// crates.io answers per sibling crate are stored as probe results, so a service
// outage stays distinguishable from a crate that genuinely is not published.
const publishedVersion = (snapshot, name) => snapshot.crates[name]?.version ?? null

const describeCrate = (snapshot, name) => {
  const entry = snapshot.crates[name]
  if (!entry) return 'not looked up'
  if (entry.unreachable) return 'unreachable'
  return entry.version ?? 'not on crates.io'
}

// Whether a cargo version requirement admits a given version. This decides the
// difference that matters between two lockfiles that both look behind: a pin of
// "1.0" already permits 1.0.4 and one cargo update closes it, while "0.9" cannot
// reach it at all, because under cargo semver every 0.x minor is a breaking
// change. Only bare and caret requirements are answered -- those are what the
// org's manifests use; anything carrying another operator returns null rather
// than a guess.
function caretAllows(req, version) {
  const bare = req.trim().replace(/^\^/, '')
  if (!/^\d+(\.\d+){0,2}$/.test(bare) || !/^\d+\.\d+\.\d+$/.test(version)) return null

  const parts = bare.split('.').map(Number)
  const [major = 0, minor = 0, patch = 0] = parts
  const lower = [major, minor, patch]

  // The caret range runs up to the next increment of the leftmost non-zero
  // component, which is what makes 0.x minors breaking.
  let upper
  if (major !== 0) upper = [major + 1, 0, 0]
  else if (minor !== 0) upper = [0, minor + 1, 0]
  else if (parts.length >= 3) upper = [0, 0, patch + 1]
  else if (parts.length === 2) upper = [0, 1, 0]
  else upper = [1, 0, 0]

  const target = version.split('.').map(Number)
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  return cmp(target, lower) >= 0 && cmp(target, upper) < 0
}

// Everything in the snapshot that is not as it should be, gathered into one
// list so the table can lead with it. Reading three sections per repo and
// knowing by heart what each sibling crate publishes is not a thing anyone will
// keep doing.
function collectFindings(snapshot) {
  const found = []
  for (const repo of snapshot.repos) {
    const released = repo.tag !== null

    for (const m of repo.manifests) {
      const state = mark(m, repo.declared)
      if (state === 'ok') continue
      found.push({
        repo: repo.repo,
        kind: state === 'missing' ? 'manifest absent' : `manifest ${state}`,
        subject: m.file,
        detail: `${m.version ?? 'absent'} against the declared ${repo.declared}`,
      })
    }

    for (const p of repo.published) {
      const state = mark(p, repo.declared, released)
      if (state === 'ok' || state === 'unreleased') continue
      found.push({
        repo: repo.repo,
        kind: state === 'missing' ? 'not published' : `registry ${state}`,
        subject: `${p.registry} ${p.pkg}`,
        detail: `${p.version ?? 'absent'} against the declared ${repo.declared}`,
      })
    }

    for (const l of repo.lock) {
      if (l.versions.length > 1) {
        found.push({
          repo: repo.repo,
          kind: 'duplicate',
          subject: l.name,
          detail: `resolved at ${l.versions.join(' and ')} in one graph, so the two do not share types`,
        })
      }
      if (!l.fromRegistry) continue
      const latest = publishedVersion(snapshot, l.name)
      if (!latest) continue
      const behind = l.versions.filter((version) => version !== latest)
      if (behind.length === 0) continue

      const pin = repo.pins[l.name] ?? null
      const allows = pin === null ? null : caretAllows(pin, latest)
      found.push({
        repo: repo.repo,
        kind: allows === false ? 'pin blocks update' : 'stale lock',
        subject: l.name,
        detail:
          `locked at ${behind.join(', ')} while ${l.name} publishes ${latest}; ` +
          (allows === false
            ? `the pin \`${pin}\` cannot reach it -- raising the pin is a breaking-change review, not a lockfile refresh`
            : allows === true
              ? `the pin \`${pin}\` already allows it, so cargo update -p ${l.name} closes it`
              : `the pin ${pin === null ? 'is not declared here' : `\`${pin}\` was not interpreted`}`),
      })
    }
  }
  return found
}

function mark(artefact, expected, released = true) {
  if (artefact.unreachable) return 'unreachable'
  if (artefact.version === null) return released ? 'missing' : 'unreleased'
  if (expected === null) return 'unknown'
  return artefact.version === expected ? 'ok' : 'differs'
}

function render(snapshot) {
  const lines = [
    '# Version snapshot',
    '',
    'Generated by [`scripts/fetch-versions.mjs`](../scripts/fetch-versions.mjs) -- do not edit by hand.',
    '',
    // The scan runs hourly but only commits when something moved, so the
    // timestamp that survives into git is the moment the state last changed --
    // not the moment it was last checked. Whether the scanner is still running
    // is the workflow's own status badge to answer, not this file's.
    `State last changed: **${snapshot.scanned_at}**`,
    '',
  ]

  if (snapshot.findings.length === 0) {
    lines.push(
      'Nothing to report: every artefact carries the version its repo declares, and every locked sibling crate is the one that crate publishes.',
      '',
    )
  } else {
    lines.push(
      `## Findings (${snapshot.findings.length})`,
      '',
      '| repo | finding | subject | detail |',
      '| --- | --- | --- | --- |',
    )
    for (const f of snapshot.findings) {
      lines.push(`| \`${f.repo}\` | ${f.kind} | \`${f.subject}\` | ${f.detail} |`)
    }
    lines.push('')
  }

  for (const repo of snapshot.repos) {
    const expected = repo.declared
    const released = repo.tag !== null
    lines.push(`## ${repo.repo}`, '')
    lines.push(
      released
        ? `Declared \`${expected ?? '?'}\`, newest tag \`${repo.tag}\`.`
        : `Declared \`${expected ?? '?'}\`, no tag yet -- nothing published.`,
      '',
    )

    lines.push('### Manifests', '', '| file | ecosystem | version | state |', '| --- | --- | --- | --- |')
    for (const m of repo.manifests) {
      lines.push(`| \`${m.file}\` | ${m.ecosystem} | ${m.version ?? '-'} | ${mark(m, expected)} |`)
    }

    lines.push('', '### Published', '', '| registry | package | version | state |', '| --- | --- | --- | --- |')
    for (const p of repo.published) {
      lines.push(`| ${p.registry} | \`${p.pkg}\` | ${p.version ?? '-'} | ${mark(p, expected, released)} |`)
    }
    const goVersion = repo.go.tag ? stripV(repo.go.tag) : null
    lines.push(`| Go | \`${repo.go.module ?? repo.go.repo}\` | ${repo.go.tag ?? '-'} | ${mark({ version: goVersion }, expected, released)} |`)

    lines.push(
      '',
      '### Resolved wickra crates in `Cargo.lock`',
      '',
      '| crate | resolved | crates.io | state | pulled in by |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const l of repo.lock) {
      const published = publishedVersion(snapshot, l.name)
      const latest = l.fromRegistry ? describeCrate(snapshot, l.name) : 'workspace member'
      const states = []
      if (l.versions.length > 1) states.push('duplicate')
      if (l.fromRegistry && published && l.versions.some((v) => v !== published)) states.push('behind')
      const by = l.pulledInBy.map((d) => `\`${d}\``).join(', ') || '-'
      lines.push(`| \`${l.name}\` | ${l.versions.join(', ')} | ${latest} | ${states.join(', ') || 'ok'} | ${by} |`)
    }

    const pins = Object.entries(repo.pins)
    if (pins.length > 0) {
      lines.push('', '### Declared pins on sibling crates', '', '| crate | pin | admits the newest release |', '| --- | --- | --- |')
      for (const [crate, pin] of pins) {
        const latest = publishedVersion(snapshot, crate)
        const allows = latest ? caretAllows(pin, latest) : null
        const verdict = !latest
          ? describeCrate(snapshot, crate)
          : allows === null
            ? 'not interpreted'
            : allows
              ? `yes, ${latest}`
              : `no, ${latest} is out of range`
        lines.push(`| \`${crate}\` | \`${pin}\` | ${verdict} |`)
      }
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

// --- Main --------------------------------------------------------------------

const entries = REPOS.filter((r) => PILOT.includes(r.repo))
const unknown = PILOT.filter((name) => !entries.some((e) => e.repo === name))
if (unknown.length > 0) throw new Error(`not listed in repos.mjs: ${unknown.join(', ')}`)

const snapshot = {
  scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  owner: OWNER,
  repos: [],
}
for (const entry of entries) snapshot.repos.push(await scanRepo(entry))

// What each sibling crate publishes, so a lockfile can be judged against the
// crate it locks rather than against a number someone has to remember. Both the
// crates a lock pulls from the registry and the crates a manifest pins are
// looked up, deduplicated across repos.
const siblings = new Set([
  ...snapshot.repos.flatMap((r) => r.lock.filter((l) => l.fromRegistry).map((l) => l.name)),
  ...snapshot.repos.flatMap((r) => Object.keys(r.pins)),
])
snapshot.crates = {}
for (const crate of [...siblings].sort()) snapshot.crates[crate] = await probe(() => registry.crates(crate))

snapshot.findings = collectFindings(snapshot)

await mkdir(OUT_DIR, { recursive: true })
await writeFile(`${OUT_DIR}/state.json`, `${JSON.stringify(snapshot, null, 2)}\n`)
await writeFile(`${OUT_DIR}/README.md`, render(snapshot))

for (const repo of snapshot.repos) {
  const released = repo.tag !== null
  const states = [
    ...repo.manifests.map((a) => mark(a, repo.declared)),
    ...repo.published.map((a) => mark(a, repo.declared, released)),
  ]
  const count = (state) => states.filter((s) => s === state).length
  const off = states.filter((s) => s !== 'ok' && s !== 'unreachable' && s !== 'unreleased').length
  const duplicates = repo.lock.filter((l) => l.versions.length > 1).length
  console.log(
    `${repo.repo}: declared ${repo.declared}, ${released ? `tag ${repo.tag}` : 'no tag yet'}, ` +
      `${off} artefact(s) not matching, ${count('unreleased')} unreleased, ` +
      `${count('unreachable')} unreachable, ${duplicates} duplicate crate(s)`,
  )
}

if (snapshot.findings.length === 0) {
  console.log('no findings')
} else {
  console.log(`${snapshot.findings.length} finding(s):`)
  for (const f of snapshot.findings) console.log(`  ${f.repo}: ${f.kind} -- ${f.subject}`)
}
