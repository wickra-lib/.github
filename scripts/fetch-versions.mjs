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
 *   4. Do two repos disagree about a third-party dependency? Every ecosystem a
 *      repo ships is read -- Cargo, npm, Maven, Python, R, NuGet, Go -- and the
 *      disagreements worth acting on are written to versions/dependencies.md.
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
import { FULL, REPOS } from './repos.mjs'

const OWNER = 'wickra-lib'
const OUT_DIR = 'versions'

// Which registries a repo publishes to at all. repos.mjs already carries this
// as the badge set, because the org is not uniform: wickra-embed ships a C
// binding and one crate, wickra-pico is firmware that attaches artefacts and
// publishes no package, wickra-playground is a deployed site. Asking npm about
// a package that was never meant to exist would report a wall of absences.
const ships = (entry, slug) => (entry.set ?? FULL).includes(slug)

// The package-name prefix every first-party artefact shares, which is what
// makes it usable as the "is this ours" test when reading a dependency.
const PROJECT_PREFIX = 'wickra'

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
    nodeLock: 'bindings/node/package-lock.json',
    // Not published, but both are bumped with every release and a stale one
    // fails `npm ci` in the examples rather than at publish time.
    exampleLock: 'examples/node/package-lock.json',
    // Benchmarks depend on the released artefact by version, so they go stale
    // the same way a manifest does.
    pomBench: 'bindings/java/benchmarks/pom.xml',
    // The wasm npm package is built by wasm-pack, so its package.json is a
    // build artefact and gitignored. The crate manifest is what tells us the
    // binding exists at all; the version only exists in the registry.
    wasmCargo: 'bindings/wasm/Cargo.toml',
    csproj: csharpDir ? `bindings/csharp/${csharpDir}/${csharpDir}.csproj` : null,
    pom: 'bindings/java/pom.xml',
    rDescription: 'bindings/r/DESCRIPTION',
    goMod: 'bindings/go/go.mod',
    // Carriers outside the package managers. Every one of them was found by
    // grepping the three repos for their own version, and every one is bumped
    // on release: a citation record, the supported-version table, the version
    // napi compiles into the loader, and the poms and snippets that depend on
    // the released artefact by version.
    citation: 'CITATION.cff',
    security: 'SECURITY.md',
    nodeIndex: 'bindings/node/index.js',
    examplePom: 'examples/java/pom.xml',
    javaReadme: 'bindings/java/README.md',
    // The root README carries an install snippet in some repos and only a
    // coordinate without a version in others; which of the two is what the
    // extraction decides, not this table.
    readme: 'README.md',
    exampleNodePkg: 'examples/node/package.json',
    // The terminal's Vue renderer. No sibling has one, and asking for a file
    // that is not there costs nothing.
    webPkg: 'web/package.json',
    webLock: 'web/package-lock.json',
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
  // Not every repo has a -go mirror, and GraphQL reports an absent repository as
  // an error rather than as null. That one is expected; anything else is not.
  const fatal = (body.errors ?? []).filter((e) => e.type !== 'NOT_FOUND')
  if (fatal.length > 0) throw new Error(`GraphQL: ${fatal.map((e) => e.message).join('; ')}`)
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
        releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes { tagName isDraft }
        }
        platformDir: object(expression: "HEAD:bindings/node/npm") {
          ... on Tree { entries { name } }
        }
        cratesDir: object(expression: "HEAD:crates") {
          ... on Tree { entries { name } }
        }
        bindingsDir: object(expression: "HEAD:bindings") {
          ... on Tree { entries { name } }
        }
        csharpDir: object(expression: "HEAD:bindings/csharp") {
          ... on Tree { entries { name object { ... on Tree { entries { name } } } } }
        }
        ${blobs}
      }
      go: repository(owner: $owner, name: $goName) {
        ...newestTag
        goMod: object(expression: "HEAD:go.mod") { ...blob }
      }
    }`
}

// Everything whose path is only known once the repository tree has been read:
// the platform stubs, the C# projects, and the per-crate manifests. Fetched in
// one further query so the shape of a repo costs one round trip, not one per
// file.
async function fetchDiscovered(name, paths) {
  if (paths.length === 0) return {}
  const blobs = paths
    .map((path, i) => `d${i}: object(expression: "HEAD:${path}") { ...blob }`)
    .join('\n        ')
  const data = await graphql(
    `
    fragment blob on Blob { text isTruncated byteSize }
    query ($owner: String!, $name: String!) {
      repo: repository(owner: $owner, name: $name) {
        ${blobs}
      }
    }`,
    { owner: OWNER, name },
  )
  return Object.fromEntries(paths.map((path, i) => [path, blobText(data.repo[`d${i}`])]))
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
// A git dependency records the exact commit it resolved to, which is the only
// version it has: no tag, no semver, just a point in that repository's history.
function gitSource(source) {
  const match = source.match(/^git\+https:\/\/github\.com\/([^/]+)\/([^#?]+?)(?:\.git)?(?:\?[^#]*)?#([0-9a-f]{7,40})$/)
  return match ? { owner: match[1], repo: match[2], sha: match[3] } : null
}

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
      // Three origins, and each asks a different question. A crate from
      // crates.io can be compared against what it publishes. A crate pinned by
      // git commit can be compared against the branch it was pinned from. A
      // workspace member resolved by path is this repo's own code and has
      // nothing to lag behind.
      origin: entries.some((e) => e.source.startsWith('registry+'))
        ? 'registry'
        : entries.some((e) => e.source.startsWith('git+'))
          ? 'git'
          : 'path',
      git: entries.map((e) => gitSource(e.source)).find(Boolean) ?? null,
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

// --- Dependency parsing ------------------------------------------------------
//
// Six ecosystems, two shapes. Cargo and npm commit a lockfile, so what comes out
// is the version actually built against. Maven, Python, R and NuGet declare a
// requirement and resolve it at build time, so what comes out is the range the
// repo asked for. The comparison downstream treats the two differently and says
// which it is.

// Everything in the lock that is not one of our own crates. cargoLockWickra
// answers the sibling question; this answers the third-party one.
function cargoLockThirdParty(lock) {
  const out = []
  for (const block of lock.split('\n[[package]]\n').slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1]
    const version = block.match(/^version = "([^"]+)"/m)?.[1]
    if (!name || !version || name.startsWith('wickra')) continue
    out.push({ name, version })
  }
  return out
}

// lockfileVersion 2 and 3 both key packages by install path; the trailing
// node_modules segment carries the name, including the scope.
function npmLockPackages(text) {
  const lock = JSON.parse(text)
  const out = []
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (path === '' || entry.link || !entry.version) continue
    const marker = path.lastIndexOf('node_modules/')
    const name = marker === -1 ? path : path.slice(marker + 'node_modules/'.length)
    if (name.startsWith('wickra')) continue
    out.push({ name, version: entry.version })
  }
  return out
}

// Maven versions are routinely written as ${some.version} and defined once in
// <properties>, so the properties are resolved before the dependency is
// reported -- an unresolved placeholder would compare as a literal string and
// call two identical versions a divergence.
function pomDeps(xml) {
  const props = {}
  const block = xml.match(/<properties>([\s\S]*?)<\/properties>/)
  if (block) for (const prop of block[1].matchAll(/<([\w.-]+)>([^<]*)<\/\1>/g)) props[prop[1]] = prop[2].trim()

  const out = []
  for (const dep of xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const groupId = dep[1].match(/<groupId>([^<]+)<\/groupId>/)?.[1]
    const artifactId = dep[1].match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]
    const declared = dep[1].match(/<version>([^<]+)<\/version>/)?.[1]
    if (!groupId || !artifactId || !declared) continue
    const placeholder = declared.match(/^\$\{([\w.-]+)\}$/)
    out.push({ name: `${groupId}:${artifactId}`, version: placeholder ? (props[placeholder[1]] ?? declared) : declared })
  }
  return out
}

// Runtime, build and optional requirements alike: all three decide what a user
// ends up installing, and the runtime list is empty in these repos anyway.
function pyprojectDeps(toml) {
  const arrays = []
  for (const pattern of [/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m, /^\s*requires\s*=\s*\[([\s\S]*?)\]/m]) {
    const match = toml.match(pattern)
    if (match) arrays.push(match[1])
  }
  const optional = toml.match(/\[project\.optional-dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? ''
  for (const group of optional.matchAll(/=\s*\[([\s\S]*?)\]/g)) {
    arrays.push(group[1])
  }

  const out = []
  for (const array of arrays) {
    for (const item of array.matchAll(/"([^"]+)"/g)) {
      const spec = item[1].trim()
      const name = spec.match(/^[A-Za-z0-9._-]+/)?.[0]
      if (!name) continue
      out.push({ name: name.toLowerCase(), version: spec.slice(name.length).trim() || '*' })
    }
  }
  return out
}

// R spreads its requirements over four fields and writes the constraint in
// parentheses after the package name, or omits it entirely.
function descriptionDeps(text) {
  const out = []
  const fields = /^(?:Depends|Imports|LinkingTo|Suggests):[ \t]*([\s\S]*?)(?=\n[A-Za-z][\w/]*:|$)/gm
  for (const section of text.matchAll(fields)) {
    for (const part of section[1].split(',')) {
      const name = part.trim().match(/^[A-Za-z][\w.]*/)?.[0]
      if (!name) continue
      out.push({ name, version: part.match(/\(([^)]+)\)/)?.[1].trim() ?? '*' })
    }
  }
  return out
}

// An npm lockfile records the version of a linked local package under its
// node_modules path, and that copy goes stale on a bump like any other file.
// npm records a locally linked package twice: the node_modules entry is a link
// pointing at a relative path, and the version lives on the entry keyed by that
// path.
function linkedLockVersion(text, pkgName) {
  const lock = JSON.parse(text)
  const entry = lock.packages?.[`node_modules/${pkgName}`]
  if (!entry) return null
  if (entry.link && entry.resolved) return lock.packages?.[entry.resolved]?.version ?? null
  return entry.version ?? null
}

// What a benchmark pom depends on from its own project, matched by the
// coordinates the shipped pom declares for itself.
function ownDependencyVersion(benchXml, mainXml) {
  const groupId = pomGroupId(mainXml)
  const artifactId = pomArtifactId(mainXml)
  if (!groupId || !artifactId) return null
  return pomDeps(benchXml).find((dep) => dep.name === `${groupId}:${artifactId}`)?.version ?? null
}

// Files that legitimately do not exist in every repo: absent is not a finding,
// only a present-but-wrong version is.
// Several carriers hold the version more than once, and one of them being
// stale is the whole point of looking. The distinct set is reported: one value
// renders as that value, more than one renders as the set and can never equal
// the declared version, which is exactly the outcome wanted.
const distinct = (values) => [...new Set(values)].sort()

const reportVersions = (values) => {
  const unique = distinct(values)
  if (unique.length === 0) return null
  return unique.join(', ')
}

const citationVersion = (yaml) => yaml.match(/^version:\s*"?([^"\s]+)"?/m)?.[1] ?? null

// A supported-version table names the release it supports and nothing else, so
// every three-part version in the file has to be the current one.
const securityVersions = (text) => text.match(/\b\d+\.\d+\.\d+\b/g) ?? []

// napi compiles the expected native package version into the loader; if a bump
// misses it, install-time validation rejects the very binary it shipped with.
const napiGuardVersions = (js) =>
  [...js.matchAll(/bindingPackageVersion !== '([^']+)'/g)].map((m) => m[1])

// Only versions belonging to this project. A pom carries plugin and
// third-party dependency versions too -- reading those would report the Maven
// compiler plugin as a stale release of ours.
function ownPomVersions(xml, mainXml) {
  const found = []
  const own = pomVersion(xml)
  if (own) found.push(own)
  const dependency = ownDependencyVersion(xml, mainXml)
  if (dependency) found.push(dependency)
  return found
}

// Install snippets, in both flavours a Java README shows: a Maven dependency
// block and a Gradle coordinate string.
function snippetVersions(text, mainXml) {
  const groupId = pomGroupId(mainXml)
  const artifactId = pomArtifactId(mainXml)
  if (!groupId || !artifactId) return []
  const found = pomDeps(text)
    .filter((dep) => dep.name === `${groupId}:${artifactId}`)
    .map((dep) => dep.version)
  for (const coordinate of text.matchAll(/["']([\w.-]+):([\w.-]+):([^"']+)["']/g)) {
    if (coordinate[1] === groupId && coordinate[2] === artifactId) found.push(coordinate[3])
  }
  return found
}

// A crate depending on a sibling by path AND version publishes a dependency on
// a version that has to exist, so the pin is a carrier like any other.
const pathDependencyVersions = (toml) =>
  [...toml.matchAll(/path\s*=\s*"[^"]*"\s*,\s*version\s*=\s*"([^"]+)"|version\s*=\s*"([^"]+)"\s*,\s*path\s*=\s*"[^"]*"/g)].map(
    (m) => m[1] ?? m[2],
  )

// An npm manifest carries our version in two places: as its own, when the
// package is ours, and as a pinned dependency on one of our packages. A
// `file:` reference is neither.
// Dependency pins only. An example's own version is a placeholder nobody bumps
// -- wickra's examples/node sits at 0.0.0 -- so reading it reports the example
// as drifting on every release.
function npmManifestVersions(text, prefix) {
  const pkg = JSON.parse(text)
  const found = []
  for (const group of [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies]) {
    for (const [dep, spec] of Object.entries(group ?? {})) {
      if (dep.startsWith(prefix) && /^\d+\.\d+\.\d+$/.test(spec)) found.push(spec)
    }
  }
  return found
}

const csprojDeps = (xml) =>
  [...xml.matchAll(/<PackageReference\s+Include="([^"]+)"[^>]*?Version="([^"]+)"/g)].map((m) => ({
    name: m[1],
    version: m[2],
  }))

const goModDeps = (text) =>
  [...text.matchAll(/^\s*(?:require\s+)?([\w.\-]+\/[^\s]+)\s+(v[^\s/]+)/gm)].map((m) => ({
    name: m[1],
    version: m[2],
  }))

// Locked ecosystems report what was built; declared ecosystems report what was
// asked for. Kept apart because a patch difference means something quite
// different on each side.
const LOCKED_ECOSYSTEMS = new Set(['cargo', 'npm'])

function collectDeps(files, paths) {
  const sources = [
    ['cargo', 'Cargo.lock', files.cargoLock, cargoLockThirdParty],
    ['npm', 'bindings/node/package-lock.json', files.nodeLock, npmLockPackages],
    ['maven', 'bindings/java/pom.xml', files.pom, pomDeps],
    ['python', 'bindings/python/pyproject.toml', files.pyproject, pyprojectDeps],
    ['r', 'bindings/r/DESCRIPTION', files.rDescription, descriptionDeps],
    ['nuget', paths.csproj, files.csproj, csprojDeps],
    ['go', 'bindings/go/go.mod', files.goMod, goModDeps],
  ]
  const deps = []
  const ecosystems = []
  for (const [ecosystem, source, text, parse] of sources) {
    if (!text) continue
    // Recorded even when it parses to nothing, so a binding with no third-party
    // dependencies reads as checked-and-empty rather than as not looked at.
    ecosystems.push(ecosystem)
    for (const item of parse(text)) deps.push({ ecosystem, source, name: item.name, version: item.version })
  }
  return { deps, ecosystems }
}

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
  // The file count comes along because a release publishes nine wheels and a
  // sdist; one of them failing to build leaves the version present but short.
  pypi: async (name) => {
    const body = await json(`https://pypi.org/pypi/${name}/json`)
    if (!body) return null
    return { version: body.info?.version ?? null, files: body.urls?.length ?? 0 }
  },
  npm: async (name) => (await json(`https://registry.npmjs.org/${encodeURIComponent(name)}`))?.['dist-tags']?.latest ?? null,
  nuget: async (id) => (await json(`https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`))?.versions?.at(-1) ?? null,
  maven: async (groupId, artifactId) => {
    const meta = await xml(`https://repo1.maven.org/maven2/${groupId.replaceAll('.', '/')}/${artifactId}/maven-metadata.xml`)
    return meta?.match(/<release>([^<]+)<\/release>/)?.[1] ?? null
  },
  runiverse: async (name) => (await json(`https://${OWNER}.r-universe.dev/api/packages/${name}`))?.Version ?? null,
}

// How far the pinned commit sits behind the branch it was taken from. This is
// the one drift a lockfile cannot express as a version: a git dependency has no
// semver to compare, only a position in someone else's history.
async function commitDistance(git) {
  const res = await request(`https://api.github.com/repos/${git.owner}/${git.repo}/compare/HEAD...${git.sha}`, {
    headers: {
      authorization: `bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': UA,
    },
  })
  if (res === null) return null
  const body = await res.json()
  return { status: body.status, behind: body.behind_by, ahead: body.ahead_by }
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

  const platformDirs = (data.repo.platformDir?.entries ?? []).map((e) => e.name).sort()

  // Paths that depend on the shape of this repository rather than on a
  // convention every repo follows. Read off the tree so a new crate, binding or
  // C# project is picked up by being there, not by being remembered.
  const crateManifests = (data.repo.cratesDir?.entries ?? []).map((e) => `crates/${e.name}/Cargo.toml`)
  const bindingManifests = (data.repo.bindingsDir?.entries ?? []).map((e) => `bindings/${e.name}/Cargo.toml`)
  const csprojPaths = (data.repo.csharpDir?.entries ?? []).flatMap((dir) =>
    (dir.object?.entries ?? [])
      .filter((file) => file.name.endsWith('.csproj'))
      .map((file) => `bindings/csharp/${dir.name}/${file.name}`),
  )
  const discovered = [
    ...platformDirs.map((dir) => `bindings/node/npm/${dir}/package.json`),
    ...crateManifests,
    ...bindingManifests,
    ...csprojPaths,
  ]
  const extra = await fetchDiscovered(name, discovered)

  // Every row records whether the file is in the repository, separately from
  // whether it carries a version. Conflating the two hides the more interesting
  // half: a binding a repo does not ship is not a defect, but a file that is
  // there and names no version, in a place where the version belongs, is.
  // `required` marks a file that has to name the release whenever it exists.
  // The rest reference it instead of declaring it -- a README with an install
  // snippet, an example that pins a real version -- and carrying nothing is a
  // legitimate state for those, not a defect.
  // `range` marks a value that is a version *requirement* rather than a
  // version: a sibling pinned as "0.1" admits 0.1.0 and is correct, and
  // comparing the two as strings reports every caret pin in the org as drift.
  const row = (file, ecosystem, text, extract, required = false, range = false) => ({
    file,
    ecosystem,
    required,
    range,
    present: text !== null && text !== undefined,
    version: text === null || text === undefined ? null : extract(text),
  })

  const manifests = [
    row('Cargo.toml', 'cargo', files.cargoToml, () => declared, true),
    row('bindings/python/pyproject.toml', 'python', files.pyproject, pyprojectVersion, true),
    row('bindings/node/package.json', 'npm', files.nodePkg, (t) => JSON.parse(t).version ?? null, true),
    row('bindings/java/pom.xml', 'maven', files.pom, pomVersion, true),
    row('bindings/r/DESCRIPTION', 'r', files.rDescription, descriptionVersion, true),
    row('bindings/node/package-lock.json', 'npm', files.nodeLock, (t) => JSON.parse(t).version ?? null, true),
    row('bindings/node/index.js', 'npm', files.nodeIndex, (t) => reportVersions(napiGuardVersions(t)), true),
    row('CITATION.cff', 'citation', files.citation, citationVersion, true),
    row('SECURITY.md', 'docs', files.security, (t) => reportVersions(securityVersions(t)), true),

    // Declared expectations rather than files: the six platform packages the
    // node manifest promises exist at this version.
    ...platformPkgs.map(([pkg, version]) => ({
      file: `bindings/node/package.json optionalDependencies.${pkg}`,
      ecosystem: 'npm',
      present: true,
      version,
    })),
    // Pins on the repo's own crates, which publish a dependency on a version
    // that has to exist.
    ...Object.entries(files.cargoToml ? cargoWorkspaceDeps(files.cargoToml) : {})
      .filter(([crate]) => crate.startsWith(name))
      .map(([crate, pin]) => ({
        file: `Cargo.toml [workspace.dependencies] ${crate}`,
        ecosystem: 'cargo',
        present: true,
        range: true,
        version: pin,
      })),

    // Discovered rather than assumed: whatever crates, bindings, C# projects and
    // platform stubs this repository actually has. A path built from a directory
    // listing that turns out to hold no such file is dropped rather than shown
    // as absent -- absence is worth rendering for a candidate the org expects,
    // not for one this scan constructed on spec.
    ...discovered.map((path) => {
      if (path.endsWith('.csproj')) {
        // The published project, whose directory is the NuGet id, must carry the
        // version; the test and benchmark projects beside it need not.
        const published = entry.nuget !== undefined && path === `bindings/csharp/${entry.nuget}/${entry.nuget}.csproj`
        return row(path, 'nuget', extra[path], csprojVersion, published)
      }
      if (path.endsWith('Cargo.toml')) {
        // A crate inheriting version.workspace = true carries nothing of its
        // own, which is the normal case; only a path-and-version pin does.
        return row(path, 'cargo', extra[path], (t) => reportVersions(pathDependencyVersions(t)), false, true)
      }
      return row(path, 'npm', extra[path], (t) => JSON.parse(t).version ?? null, true)
    }).filter((m) => m.present),

    // Files that reference the release rather than declare it. Each is read
    // through our own coordinates, so a plugin or third-party pin sitting at the
    // same number is not mistaken for ours.
    row('examples/node/package-lock.json', 'npm', files.exampleLock, (t) =>
      linkedLockVersion(t, nodePkg?.name ?? name),
    ),
    row('examples/node/package.json', 'npm', files.exampleNodePkg, (t) =>
      reportVersions(npmManifestVersions(t, PROJECT_PREFIX)),
    ),
    row('web/package.json', 'npm', files.webPkg, (t) => JSON.parse(t).version ?? null),
    row('web/package-lock.json', 'npm', files.webLock, (t) => JSON.parse(t).version ?? null),
    row('bindings/java/benchmarks/pom.xml', 'maven', files.pomBench, (t) =>
      files.pom ? ownDependencyVersion(t, files.pom) : null,
    ),
    row('examples/java/pom.xml', 'maven', files.examplePom, (t) =>
      files.pom ? reportVersions(ownPomVersions(t, files.pom)) : null,
    ),
    row('bindings/java/README.md', 'maven', files.javaReadme, (t) =>
      files.pom ? reportVersions(snippetVersions(t, files.pom)) : null,
    ),
    row('README.md', 'docs', files.readme, (t) => (files.pom ? reportVersions(snippetVersions(t, files.pom)) : null)),
  ].filter((m) => m.file !== null)

  const crateName = entry.crate ?? name
  const npmName = nodePkg?.name ?? name
  const runivName = entry.runiv ?? name.replaceAll('-', '')
  const groupId = files.pom ? pomGroupId(files.pom) : null
  const artifactId = files.pom ? pomArtifactId(files.pom) : null

  // Every crate the workspace builds, not just the one named after the repo:
  // a workspace publishes several and each one publishes on its own. Membership
  // comes from the lockfile, and crates.io decides which of them are published
  // at all -- a crate marked publish = false simply is not there.
  const members = files.cargoLock
    ? cargoLockWickra(files.cargoLock)
        .filter((entry) => entry.origin === 'path' && entry.name !== crateName)
        .map((entry) => entry.name)
    : []
  const memberRows = []
  if (ships(entry, 'crates')) {
    for (const member of members) {
      const result = await probe(() => registry.crates(member))
      if (result.version === null && !result.unreachable) continue
      memberRows.push({ registry: 'crates.io', pkg: member, ...result })
    }
  }

  const pypi = ships(entry, 'pypi') ? await probe(() => registry.pypi(name)) : null
  const published = [
    ...(ships(entry, 'crates')
      ? [{ registry: 'crates.io', pkg: crateName, ...(await probe(() => registry.crates(crateName))) }]
      : []),
    ...memberRows,
    ...(pypi
      ? [
          {
            registry: 'PyPI',
            pkg: name,
            version: pypi.version?.version ?? null,
            unreachable: pypi.unreachable,
            note: pypi.version ? `${pypi.version.files} files` : undefined,
          },
        ]
      : []),
    ...(ships(entry, 'npm')
      ? [
          { registry: 'npm', pkg: npmName, ...(await probe(() => registry.npm(npmName))) },
          ...(await Promise.all(
            platformPkgs.map(async ([pkg]) => ({ registry: 'npm', pkg, ...(await probe(() => registry.npm(pkg))) })),
          )),
          ...(files.wasmCargo
            ? [{ registry: 'npm', pkg: `${name}-wasm`, ...(await probe(() => registry.npm(`${name}-wasm`))) }]
            : []),
        ]
      : []),
    ...(ships(entry, 'nuget') && entry.nuget
      ? [{ registry: 'NuGet', pkg: entry.nuget, ...(await probe(() => registry.nuget(entry.nuget))) }]
      : []),
    ...(ships(entry, 'maven') && groupId && artifactId
      ? [
          {
            registry: 'Maven',
            pkg: `${groupId}:${artifactId}`,
            ...(await probe(() => registry.maven(groupId, artifactId))),
          },
        ]
      : []),
    ...(ships(entry, 'r-universe')
      ? [{ registry: 'r-universe', pkg: runivName, ...(await probe(() => registry.runiverse(runivName))) }]
      : []),
  ]

  const release = data.repo.releases?.nodes?.[0]
  return {
    repo: name,
    declared,
    tag: tagName(data.repo),
    release: release && !release.isDraft ? release.tagName : null,
    manifests,
    published,
    go: ships(entry, 'go') ? {
      repo: goRepo,
      // The module path that actually resolves is the mirror's, since that is
      // the repository a `go get` fetches and the tag comes from there too.
      module: data.go?.goMod ? goModule(blobText(data.go.goMod)) : null,
      declaredInRepo: files.goMod ? goModule(files.goMod) : null,
      tag: tagName(data.go),
    } : null,
    pins: files.cargoToml ? cargoWorkspaceDeps(files.cargoToml) : {},
    lock: files.cargoLock ? cargoLockWickra(files.cargoLock) : [],
    ...collectDeps(files, paths),
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
      const state = markManifest(m, repo.declared)
      if (state === 'ok') continue
      // Neither of these is a defect, and both are worth seeing: absent says
      // which bindings a repo does not ship, and no reference says which files
      // could name the release and do not. Reported as findings so the page
      // holds every state in one place, marked informational so they cannot
      // drown the rows that need acting on.
      if (state === 'absent' || state === 'no reference') {
        found.push({
          repo: repo.repo,
          kind: state === 'absent' ? 'not in the repository' : 'no version reference',
          subject: m.file,
          detail:
            state === 'absent'
              ? 'a binding or file this repository does not have'
              : 'present, and names no version -- legitimate for a file that only may reference one',
          informational: true,
        })
        continue
      }
      found.push({
        repo: repo.repo,
        kind:
          state === 'no version'
            ? 'carries no version'
            : state === 'out of range'
              ? 'pin excludes the declared version'
              : `manifest ${state}`,
        subject: m.file,
        detail:
          state === 'no version'
            ? `the file is present and names no version, while the repo declares ${repo.declared}`
            : state === 'out of range'
              ? `pinned \`${m.version}\`, which does not admit the declared ${repo.declared}`
            : `${m.version} against the declared ${repo.declared}`,
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

    if (released && repo.release !== repo.tag) {
      found.push({
        repo: repo.repo,
        kind: 'no release for the newest tag',
        subject: repo.tag,
        detail:
          repo.release === null
            ? 'the repository has no published release at all'
            : `the newest release is ${repo.release}; attaching assets depends on every publish job, so one failing leaves the tag without one`,
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
      if (l.origin === 'git') {
        const distance = l.gitDistance
        if (distance && distance.behind > 0) {
          found.push({
            repo: repo.repo,
            kind: 'git pin behind',
            subject: l.name,
            detail: `pinned at ${l.git.sha.slice(0, 8)}, ${distance.behind} commit(s) behind the default branch of ${l.git.owner}/${l.git.repo}`,
          })
        }
        continue
      }
      if (l.origin !== 'registry') continue
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

// Four ways a manifest row can fail to name the release, and only two of them
// are findings:
//
//   absent        the file is not in the repository -- a binding this repo does
//                 not ship. Across 25 repos of differing surface that is the
//                 common case, not a defect.
//   no version    the file is there, the version belongs in it, and it names
//                 none. This is what a list-driven check cannot see at all: it
//                 fails on a wrong number, never on an absent one.
//   no reference  the file is there and merely *may* reference the release --
//                 a README snippet, an example pinning a real version. Carrying
//                 nothing is legitimate.
//   differs       it names a version, and not the declared one.
function markManifest(manifest, expected) {
  if (!manifest.present) return 'absent'
  if (manifest.version === null) return manifest.required ? 'no version' : 'no reference'
  if (manifest.range && expected !== null) {
    const admits = caretAllows(manifest.version, expected)
    if (admits === null) return mark(manifest, expected)
    return admits ? 'ok' : 'out of range'
  }
  return mark(manifest, expected)
}

// Most consequential first: a crate resolving twice is broken now, a pin that
// cannot reach the newer release is a decision someone has to make, and a
// commit pin drifting is housekeeping.
const FINDING_ORDER = [
  'duplicate',
  'carries no version',
  'pin excludes the declared version',
  'no release for the newest tag',
  'pin blocks update',
  'manifest differs',
  'registry differs',
  'not published',
  'stale lock',
  'git pin behind',
  'no version reference',
  'not in the repository',
]

// The two states that describe a repository rather than fault it. Rendered
// last, collapsed, and aggregated by file: 334 rows of "this repo has no web/"
// would bury 114 that matter, and one row per file says the same thing.
const INFORMATIONAL_KINDS = new Set(['no version reference', 'not in the repository'])

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

  lines.push(`Scanning ${snapshot.repos.length} product repositories.`, '')

  if (snapshot.findings.length === 0) {
    lines.push(
      'Nothing to report: every artefact carries the version its repo declares, and every locked sibling crate is the one that crate publishes.',
      '',
    )
  } else {
    const actionable = snapshot.findings.filter((f) => !f.informational).length
    lines.push(
      `## Findings (${actionable})`,
      '',
      `Plus ${snapshot.findings.length - actionable} informational rows, collapsed at the end of this section: which files a repository does not have, and which of the ones it has name no version by design.`,
      '',
    )
    // Grouped by kind and ordered by what would be acted on first: a crate
    // resolving twice is a defect today, a pin that cannot reach the newer
    // release is a decision to make, and a commit pin drifting is housekeeping.
    const kinds = [...new Set(snapshot.findings.map((f) => f.kind))].sort(
      (a, b) => (FINDING_ORDER.indexOf(a) + 1 || 99) - (FINDING_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
    )
    for (const kind of kinds) {
      const group = snapshot.findings.filter((f) => f.kind === kind)
      if (INFORMATIONAL_KINDS.has(kind)) {
        const byFile = new Map()
        for (const f of group) {
          if (!byFile.has(f.subject)) byFile.set(f.subject, [])
          byFile.get(f.subject).push(f.repo)
        }
        lines.push(
          '<details>',
          `<summary><b>${kind}</b> -- ${group.length} across ${byFile.size} file(s), nothing to act on</summary>`,
          '',
          '| file | repos |',
          '| --- | --- |',
        )
        for (const [file, repos] of [...byFile].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
          lines.push(`| \`${file}\` | ${repos.length}: ${repos.map((r) => `\`${r}\``).join(', ')} |`)
        }
        lines.push('', '</details>', '')
        continue
      }
      lines.push(`### ${kind} (${group.length})`, '', '| repo | subject | detail |', '| --- | --- | --- |')
      for (const f of group) lines.push(`| \`${f.repo}\` | \`${f.subject}\` | ${f.detail} |`)
      lines.push('')
    }
  }

  lines.push('## Repositories', '', '| repo | declared | tag | release | artefacts | findings |', '| --- | --- | --- | --- | --- | --- |')
  for (const repo of snapshot.repos) {
    const released = repo.tag !== null
    const states = [
      ...repo.manifests.map((a) => markManifest(a, repo.declared)),
      ...repo.published.map((a) => mark(a, repo.declared, released)),
    ]
    // Absent rows are bindings this repo does not ship, so they belong in
    // neither half of the ratio.
    const applicable = states.filter((state) => state !== 'absent' && state !== 'no reference')
    const ok = applicable.filter((state) => state === 'ok').length
    const count = snapshot.findings.filter((f) => f.repo === repo.repo && !f.informational).length
    lines.push(
      `| \`${repo.repo}\` | ${repo.declared ?? '?'} | ${repo.tag ?? '-'} | ${repo.release ?? '-'} | ${ok}/${applicable.length} ok | ${count || '-'} |`,
    )
  }
  lines.push('', '## Detail', '')

  for (const repo of snapshot.repos) {
    const expected = repo.declared
    const released = repo.tag !== null
    lines.push('<details>', `<summary><code>${repo.repo}</code> -- ${repo.declared ?? '?'}</summary>`, '')
    lines.push(
      released
        ? `Declared \`${expected ?? '?'}\`, newest tag \`${repo.tag}\`, newest release \`${repo.release ?? 'none'}\`.`
        : `Declared \`${expected ?? '?'}\`, no tag yet -- nothing published.`,
      '',
    )

    lines.push('### Manifests', '', '| file | ecosystem | version | state |', '| --- | --- | --- | --- |')
    for (const m of repo.manifests) {
      lines.push(`| \`${m.file}\` | ${m.ecosystem} | ${m.version ?? '-'} | ${markManifest(m, expected)} |`)
    }

    lines.push(
      '',
      '### Published',
      '',
      '| registry | package | version | state | artefacts |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const p of repo.published) {
      lines.push(
        `| ${p.registry} | \`${p.pkg}\` | ${p.version ?? '-'} | ${mark(p, expected, released)} | ${p.note ?? '-'} |`,
      )
    }
    if (repo.go) {
      const goVersion = repo.go.tag ? stripV(repo.go.tag) : null
      lines.push(
        `| Go | \`${repo.go.module ?? repo.go.repo}\` | ${repo.go.tag ?? '-'} | ${mark({ version: goVersion }, expected, released)} | - |`,
      )
    }

    lines.push(
      '',
      '### Resolved wickra crates in `Cargo.lock`',
      '',
      '| crate | resolved | crates.io | state | pulled in by |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const l of repo.lock) {
      const published = publishedVersion(snapshot, l.name)
      const latest =
        l.origin === 'registry'
          ? describeCrate(snapshot, l.name)
          : l.origin === 'git'
            ? `git ${l.git ? l.git.sha.slice(0, 8) : '?'}`
            : 'workspace member'
      const states = []
      if (l.versions.length > 1) states.push('duplicate')
      if (l.origin === 'registry' && published && l.versions.some((v) => v !== published)) states.push('behind')
      if (l.origin === 'git' && l.gitDistance?.behind > 0) states.push(`${l.gitDistance.behind} commits behind`)
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
    lines.push('', '</details>', '')
  }

  return `${lines.join('\n')}\n`
}

// --- Dependency divergence ---------------------------------------------------
//
// The question here is narrower than "which versions exist": it is which
// dependency two repos disagree about in a way worth acting on.
//
// For a locked ecosystem a patch difference is almost always the two lockfiles
// having been refreshed on different days, and reporting it would bury the real
// rows under noise nobody acts on. Only a difference crossing a semver
// compatibility boundary is reported -- that is the one that yields two
// incompatible copies once anything pulls in both.
//
// For a declared ecosystem there is no such noise floor: the repo wrote the
// requirement down by hand, so any difference in it was a decision.

// The range a version belongs to under semver, where every 0.x minor is its own
// incompatible track.
function compatibilityTrack(version) {
  const [major = 0, minor = 0, patch = 0] = (version.match(/\d+/g) ?? []).slice(0, 3).map(Number)
  if (major !== 0) return `${major}`
  if (minor !== 0) return `0.${minor}`
  return `0.0.${patch}`
}

function commonPrefix(names) {
  const [first, ...rest] = names
  let end = first.length
  for (const name of rest) {
    let i = 0
    while (i < end && i < name.length && name[i] === first[i]) i++
    end = i
  }
  return first.slice(0, end)
}

// A family that moves as one release -- windows_x86_64_msvc and its eight
// siblings -- is one decision, not nine findings. Rows sharing an ecosystem and
// an identical per-repo version map collapse onto their common prefix.
function collapseFamilies(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = `${row.ecosystem} ${JSON.stringify(Object.entries(row.byRepo).sort())}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const out = []
  for (const members of groups.values()) {
    if (members.length < 3) {
      out.push(...members)
      continue
    }
    const prefix = commonPrefix(members.map((m) => m.name))
    out.push({
      ...members[0],
      name: prefix ? `${prefix}*` : members[0].name,
      family: members.map((m) => m.name).sort(),
    })
  }
  return out.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name))
}

function dependencyIndex(snapshot) {
  const index = new Map()
  for (const repo of snapshot.repos) {
    for (const dep of repo.deps) {
      const key = `${dep.ecosystem} ${dep.name}`
      if (!index.has(key)) index.set(key, { ecosystem: dep.ecosystem, name: dep.name, byRepo: {} })
      index.get(key).byRepo[repo.repo] = dep.version
    }
  }
  return index
}

function collectDivergences(snapshot) {
  const rows = []
  for (const entry of dependencyIndex(snapshot).values()) {
    if (Object.keys(entry.byRepo).length < 2) continue
    const values = new Set(Object.values(entry.byRepo))
    if (values.size < 2) continue
    if (LOCKED_ECOSYSTEMS.has(entry.ecosystem) && new Set([...values].map(compatibilityTrack)).size < 2) continue
    rows.push(entry)
  }
  return collapseFamilies(rows)
}

function dependencyStats(snapshot) {
  const stats = {}
  for (const repo of snapshot.repos) {
    for (const ecosystem of repo.ecosystems) stats[ecosystem] ??= { total: 0, shared: 0, differing: 0 }
  }
  for (const entry of dependencyIndex(snapshot).values()) {
    const bucket = (stats[entry.ecosystem] ??= { total: 0, shared: 0, differing: 0 })
    bucket.total++
    if (Object.keys(entry.byRepo).length < 2) continue
    bucket.shared++
    if (new Set(Object.values(entry.byRepo)).size > 1) bucket.differing++
  }
  return stats
}

const DEPENDENCY_SOURCE = {
  cargo: '`Cargo.lock` (resolved)',
  npm: '`package-lock.json` (resolved)',
  maven: '`pom.xml` (declared)',
  python: '`pyproject.toml` (declared)',
  r: '`DESCRIPTION` (declared)',
  nuget: '`.csproj` (declared)',
  go: '`go.mod` (declared)',
}

function renderDependencies(snapshot, divergences) {
  const stats = dependencyStats(snapshot)
  const repos = snapshot.repos.map((r) => r.repo)
  const lines = [
    '# Dependency divergence',
    '',
    'Generated by [`scripts/fetch-versions.mjs`](../scripts/fetch-versions.mjs) -- do not edit by hand.',
    '',
    `State last changed: **${snapshot.scanned_at}**`,
    '',
    `Comparing ${repos.map((r) => `\`${r}\``).join(', ')} across every ecosystem they ship.`,
    '',
  ]

  if (divergences.length === 0) {
    lines.push('Nothing to report: no dependency shared by two of these repos disagrees in a way worth acting on.', '')
  } else {
    lines.push(
      `## Findings (${divergences.length})`,
      '',
      `| ecosystem | dependency | ${repos.join(' | ')} |`,
      `| --- | --- | ${repos.map(() => '---').join(' | ')} |`,
    )
    for (const row of divergences) {
      const cells = repos.map((repo) => row.byRepo[repo] ?? '-')
      lines.push(`| ${row.ecosystem} | \`${row.name}\` | ${cells.join(' | ')} |`)
    }
    lines.push('')

    const families = divergences.filter((row) => row.family)
    if (families.length > 0) {
      lines.push('### Collapsed families', '')
      for (const row of families) {
        lines.push(`- \`${row.name}\` covers ${row.family.map((n) => `\`${n}\``).join(', ')}`)
      }
      lines.push('')
    }
  }

  lines.push(
    '## Coverage',
    '',
    '| ecosystem | source of truth | dependencies seen | shared by two or more | of those, differing |',
    '| --- | --- | --- | --- | --- |',
  )
  for (const ecosystem of Object.keys(stats).sort()) {
    const bucket = stats[ecosystem]
    lines.push(`| ${ecosystem} | ${DEPENDENCY_SOURCE[ecosystem]} | ${bucket.total} | ${bucket.shared} | ${bucket.differing} |`)
  }

  lines.push(
    '',
    'A resolved ecosystem only reports a difference that crosses a semver compatibility boundary: two lockfiles refreshed on different days differ by a patch across half their transitive tree, and reporting that would bury the rows that matter. A declared ecosystem reports every difference, because a written-down requirement was a decision rather than a resolver outcome.',
    '',
    'Divergence between independent repos is a maintenance signal rather than a build error -- two versions to review when an advisory lands, two behaviours free to drift apart. It becomes a defect only once both land in one graph, which is what the duplicate rows in the [version snapshot](README.md) report.',
    '',
  )

  return `${lines.join('\n')}\n`
}

// --- Main --------------------------------------------------------------------

// Every product repo in the org. repos.mjs is the list, and it already fails
// loudly when it drifts from the badge directories, so the scan inherits that
// guarantee rather than keeping a second list of its own.
const entries = REPOS

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
  ...snapshot.repos.flatMap((r) => r.lock.filter((l) => l.origin === 'registry').map((l) => l.name)),
  ...snapshot.repos.flatMap((r) => Object.keys(r.pins)),
])
snapshot.crates = {}
for (const crate of [...siblings].sort()) snapshot.crates[crate] = await probe(() => registry.crates(crate))

// One lookup per distinct pinned commit, shared across the repos that pin it.
const distances = new Map()
for (const repo of snapshot.repos) {
  for (const entry of repo.lock) {
    if (entry.origin !== 'git' || !entry.git) continue
    const key = `${entry.git.owner}/${entry.git.repo}@${entry.git.sha}`
    if (!distances.has(key)) distances.set(key, (await probe(() => commitDistance(entry.git))).version)
    entry.gitDistance = distances.get(key)
  }
}

snapshot.findings = collectFindings(snapshot)

const divergences = collectDivergences(snapshot)

await mkdir(OUT_DIR, { recursive: true })

// The dependency lists are an order of magnitude larger than everything else in
// the snapshot, so they get their own file instead of swamping state.json.
const dependencies = {
  scanned_at: snapshot.scanned_at,
  owner: OWNER,
  stats: dependencyStats(snapshot),
  divergences,
  repos: Object.fromEntries(snapshot.repos.map((repo) => [repo.repo, repo.deps])),
}
const versionState = { ...snapshot, repos: snapshot.repos.map(({ deps, ecosystems, ...rest }) => rest) }

await writeFile(`${OUT_DIR}/state.json`, `${JSON.stringify(versionState, null, 2)}\n`)
await writeFile(`${OUT_DIR}/README.md`, render(snapshot))
await writeFile(`${OUT_DIR}/dependencies.json`, `${JSON.stringify(dependencies, null, 2)}\n`)
await writeFile(`${OUT_DIR}/dependencies.md`, renderDependencies(snapshot, divergences))

for (const repo of snapshot.repos) {
  const released = repo.tag !== null
  const states = [
    ...repo.manifests.map((a) => markManifest(a, repo.declared)),
    ...repo.published.map((a) => mark(a, repo.declared, released)),
  ]
  const count = (state) => states.filter((s) => s === state).length
  const benign = new Set(['ok', 'absent', 'no reference', 'unreachable', 'unreleased'])
  const off = states.filter((s) => !benign.has(s)).length
  const duplicates = repo.lock.filter((l) => l.versions.length > 1).length
  console.log(
    `${repo.repo}: declared ${repo.declared}, ${released ? `tag ${repo.tag}` : 'no tag yet'}, ` +
      `${off} artefact(s) not matching, ${count('unreleased')} unreleased, ` +
      `${count('unreachable')} unreachable, ${duplicates} duplicate crate(s)`,
  )
}

console.log(
  `dependencies: ${divergences.length} divergence(s) over ${Object.keys(dependencyStats(snapshot)).length} ecosystem(s)`,
)

const actionable = snapshot.findings.filter((f) => !f.informational)
if (actionable.length === 0) {
  console.log('no findings')
} else {
  console.log(`${actionable.length} finding(s), plus ${snapshot.findings.length - actionable.length} informational:`)
  for (const f of actionable) console.log(`  ${f.repo}: ${f.kind} -- ${f.subject}`)
}
