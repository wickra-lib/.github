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

// Pilot scope. wickra is the widest case in the org -- seven registries, nine
// manifests, six npm platform packages -- so whatever holds here holds for the
// rest of REPOS. Widen to REPOS.map(r => r.repo) once the table reads well.
const PILOT = ['wickra']

const UA = 'wickra-lib-version-snapshot (https://github.com/wickra-lib/.github)'

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

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${process.env.GH_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': UA,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`)
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
      sources: [...new Set(entries.map((e) => e.source))],
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
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

async function xml(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.text()
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
    { registry: 'crates.io', pkg: crateName, version: await registry.crates(crateName) },
    { registry: 'PyPI', pkg: name, version: await registry.pypi(name) },
    { registry: 'npm', pkg: npmName, version: await registry.npm(npmName) },
    ...(await Promise.all(platformPkgs.map(async ([pkg]) => ({ registry: 'npm', pkg, version: await registry.npm(pkg) })))),
    ...(files.wasmCargo ? [{ registry: 'npm', pkg: `${name}-wasm`, version: await registry.npm(`${name}-wasm`) }] : []),
    ...(entry.nuget ? [{ registry: 'NuGet', pkg: entry.nuget, version: await registry.nuget(entry.nuget) }] : []),
    ...(groupId && artifactId
      ? [{ registry: 'Maven', pkg: `${groupId}:${artifactId}`, version: await registry.maven(groupId, artifactId) }]
      : []),
    { registry: 'r-universe', pkg: runivName, version: await registry.runiverse(runivName) },
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

function mark(version, expected) {
  if (version === null) return 'missing'
  if (expected === null) return 'unknown'
  return version === expected ? 'ok' : 'differs'
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

  for (const repo of snapshot.repos) {
    const expected = repo.declared
    lines.push(`## ${repo.repo}`, '')
    lines.push(`Declared \`${expected ?? '?'}\`, newest tag \`${repo.tag ?? '-'}\`.`, '')

    lines.push('### Manifests', '', '| file | ecosystem | version | state |', '| --- | --- | --- | --- |')
    for (const m of repo.manifests) {
      lines.push(`| \`${m.file}\` | ${m.ecosystem} | ${m.version ?? '-'} | ${mark(m.version, expected)} |`)
    }

    lines.push('', '### Published', '', '| registry | package | version | state |', '| --- | --- | --- | --- |')
    for (const p of repo.published) {
      lines.push(`| ${p.registry} | \`${p.pkg}\` | ${p.version ?? '-'} | ${mark(p.version, expected)} |`)
    }
    const goVersion = repo.go.tag ? stripV(repo.go.tag) : null
    lines.push(`| Go | \`${repo.go.module ?? repo.go.repo}\` | ${repo.go.tag ?? '-'} | ${mark(goVersion, expected)} |`)

    lines.push('', '### Resolved wickra crates in `Cargo.lock`', '', '| crate | resolved | pulled in by |', '| --- | --- | --- |')
    for (const l of repo.lock) {
      const duplicate = l.versions.length > 1 ? ' **duplicate**' : ''
      lines.push(`| \`${l.name}\` | ${l.versions.join(', ')}${duplicate} | ${l.pulledInBy.map((d) => `\`${d}\``).join(', ') || '-'} |`)
    }

    const pins = Object.entries(repo.pins)
    if (pins.length > 0) {
      lines.push('', '### Declared pins on sibling crates', '', '| crate | pin |', '| --- | --- |')
      for (const [crate, pin] of pins) lines.push(`| \`${crate}\` | \`${pin}\` |`)
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

await mkdir(OUT_DIR, { recursive: true })
await writeFile(`${OUT_DIR}/state.json`, `${JSON.stringify(snapshot, null, 2)}\n`)
await writeFile(`${OUT_DIR}/README.md`, render(snapshot))

for (const repo of snapshot.repos) {
  const off = [...repo.manifests, ...repo.published].filter((a) => mark(a.version, repo.declared) !== 'ok')
  const duplicates = repo.lock.filter((l) => l.versions.length > 1)
  console.log(
    `${repo.repo}: declared ${repo.declared}, tag ${repo.tag}, ` +
      `${off.length} artefact(s) not matching, ${duplicates.length} duplicate crate(s)`,
  )
}
