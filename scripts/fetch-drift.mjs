/*
 * Version drift across the family, every ecosystem, every lockfile -- the org
 * side of ScriptHelpers' version_drift.py. fetch-versions.mjs asks whether each
 * repository agrees with the registries; this asks whether the repositories
 * agree with each other, which none of them can see from inside.
 *
 * What it reports, by severity:
 *
 *   defect  wrong on its own terms: a family crate pinned or locked below the
 *           version its owner's main declares, a git source for a published
 *           crate, a committed lock that disagrees with its manifest, two
 *           versions of one family crate in one graph, an unpinned pip install
 *           in CI, a uv checksum that belongs to another release, a Dependabot
 *           directory that does not exist.
 *   drift   the same thing spelled differently in two repositories: a
 *           dependency, a toolchain floor, a CI matrix, an action pin, a lock
 *           convention, a Dependabot directory one repository covers and
 *           another does not.
 *   info    resolved-lock differences across a semver band, and the
 *           supply-chain ignore lists -- maintenance signal, not a task.
 *
 * Reads every relevant file of every product repository (and dependabot.yml of
 * every site) through the GitHub API; nothing is cloned. Output:
 * versions/drift.md and versions/drift.json (the finding keys, so the next run's
 * table can say what is new).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { REPO_NAMES } from './repos.mjs'

const OWNER = 'wickra-lib'
const ATTEMPTS = 5
const UV_TARGETS = ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'aarch64-apple-darwin', 'x86_64-apple-darwin']
const SKIP = /(^|\/)(target|node_modules|\.venv|\.venv312|dist|build|\.toolchain|site|pkg|pkg-node|vendor|__pycache__)\//

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- network
async function request(url, init = {}) {
  let reason = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res
    try {
      res = await fetch(url, init)
    } catch (err) {
      reason = err.message
      if (attempt < ATTEMPTS) await sleep(attempt * 500)
      continue
    }
    if (res.status === 404) return null
    if (res.ok) return res
    if (res.status < 500 && res.status !== 429) throw new Error(`${url} -> HTTP ${res.status}`)
    reason = `HTTP ${res.status}`
    if (attempt < ATTEMPTS) await sleep(attempt * 500)
  }
  throw new Error(`${url} unreachable after ${ATTEMPTS} attempts: ${reason}`)
}

const gh = (path) =>
  request(`https://api.github.com${path}`, {
    headers: { authorization: `bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'wickra-lib/.github fetch-drift' },
  })

async function graphql(query, variables) {
  const res = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${process.env.GH_TOKEN}`, 'content-type': 'application/json', 'user-agent': 'wickra-lib/.github fetch-drift' },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json()
  if (body.errors) throw new Error(`graphql: ${JSON.stringify(body.errors).slice(0, 300)}`)
  return body.data
}

// Every path in the repository at HEAD (blobs only).
async function tree(name) {
  const res = await gh(`/repos/${OWNER}/${name}/git/trees/HEAD?recursive=1`)
  if (!res) return []
  const body = await res.json()
  return body.tree.filter((e) => e.type === 'blob').map((e) => e.path)
}

// The text of many files of one repository, in batches of one GraphQL query.
async function blobs(name, paths) {
  const out = new Map()
  for (let i = 0; i < paths.length; i += 60) {
    const chunk = paths.slice(i, i + 60)
    const fields = chunk.map((p, j) => `f${j}: object(expression: ${JSON.stringify('HEAD:' + p)}) { ... on Blob { text isBinary } }`).join('\n')
    const data = await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, { owner: OWNER, name })
    chunk.forEach((p, j) => {
      const node = data.repository[`f${j}`]
      if (node && !node.isBinary && typeof node.text === 'string') out.set(p, node.text)
    })
  }
  return out
}

// ---------------------------------------------------------------- parsers
// A TOML reader for the shapes Cargo.toml, Cargo.lock, pyproject.toml,
// deny.toml and osv-scanner.toml use: tables, arrays of tables, strings,
// numbers, booleans, inline tables and (multi-line) arrays. Enough for a
// manifest; not a validator.
function parseToml(text) {
  const root = {}
  let cur = root
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  const strip = (s) => {
    // drop a trailing comment outside of strings
    let out = '', q = null
    for (let k = 0; k < s.length; k++) {
      const ch = s[k]
      if (q) { out += ch; if (ch === q && s[k - 1] !== '\\') q = null; continue }
      if (ch === '"' || ch === "'") { q = ch; out += ch; continue }
      if (ch === '#') break
      out += ch
    }
    return out.trim()
  }
  const dig = (obj, keys, arrayTable) => {
    let o = obj
    keys.forEach((k, idx) => {
      const last = idx === keys.length - 1
      if (last && arrayTable) {
        if (!Array.isArray(o[k])) o[k] = []
        const t = {}
        o[k].push(t)
        o = t
      } else {
        if (Array.isArray(o[k])) o = o[k][o[k].length - 1]
        else o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}
      }
    })
    return o
  }
  const splitKeys = (s) => s.split('.').map((k) => k.trim().replace(/^"(.*)"$/, '$1'))
  const parseValue = (raw) => {
    raw = raw.trim()
    if (raw.startsWith('"""')) return raw.slice(3, -3)
    if (raw.startsWith('"')) return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    if (raw.startsWith("'")) return raw.slice(1, -1)
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (raw.startsWith('{')) {
      const obj = {}
      for (const part of splitTop(raw.slice(1, -1), ',')) {
        const m = part.match(/^\s*([^=]+?)\s*=\s*([\s\S]+)$/)
        if (m) obj[m[1].trim().replace(/^"(.*)"$/, '$1')] = parseValue(m[2])
      }
      return obj
    }
    if (raw.startsWith('[')) return splitTop(raw.slice(1, -1), ',').map((x) => x.trim()).filter(Boolean).map(parseValue)
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
    return raw
  }
  // split on a separator at nesting depth 0, respecting strings
  const splitTop = (s, sep) => {
    const out = []
    let depth = 0, q = null, buf = ''
    for (let k = 0; k < s.length; k++) {
      const ch = s[k]
      if (q) { buf += ch; if (ch === q && s[k - 1] !== '\\') q = null; continue }
      if (ch === '"' || ch === "'") { q = ch; buf += ch; continue }
      if (ch === '{' || ch === '[') depth++
      if (ch === '}' || ch === ']') depth--
      if (ch === sep && depth === 0) { out.push(buf); buf = ''; continue }
      buf += ch
    }
    if (buf.trim()) out.push(buf)
    return out
  }
  while (i < lines.length) {
    let line = strip(lines[i])
    i++
    if (!line) continue
    let m
    if ((m = line.match(/^\[\[(.+)\]\]$/))) { cur = dig(root, splitKeys(m[1]), true); continue }
    if ((m = line.match(/^\[(.+)\]$/))) { cur = dig(root, splitKeys(m[1]), false); continue }
    m = line.match(/^([^=]+?)\s*=\s*([\s\S]*)$/)
    if (!m) continue
    let value = m[2]
    // a value that opens more than it closes continues on the next lines
    const balance = (s) => (s.match(/[[{]/g) || []).length - (s.match(/[\]}]/g) || []).length
    while (balance(value) > 0 && i < lines.length) value += '\n' + strip(lines[i++])
    if (value.startsWith('"""')) while (!value.slice(3).includes('"""') && i < lines.length) value += '\n' + lines[i++]
    const keys = splitKeys(m[1])
    const target = dig(cur, keys.slice(0, -1), false)
    target[keys[keys.length - 1]] = parseValue(value)
  }
  return root
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x)
const band = (v) => {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return v
  return m[1] !== '0' ? `${m[1]}.x` : `0.${m[2]}.x`
}
const vkey = (v) => v.replace(/^[v=^~ ]+/, '').split(/[.\-+]/).slice(0, 3).map((x) => (/^\d+$/.test(x) ? Number(x) : 0))
const vcmp = (a, b) => {
  const x = vkey(a), y = vkey(b)
  for (let k = 0; k < 3; k++) if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) - (y[k] || 0)
  return 0
}
const specNumber = (spec) => spec.match(/^\s*[=^~]?\s*(\d+(?:\.\d+){0,2})/)?.[1] ?? null
function satisfied(spec, latest) {
  const num = specNumber(spec)
  if (!num) return false
  if (spec.trim().startsWith('=')) return num === latest
  const parts = num.split('.'), lp = latest.split('.')
  if (parts[0] !== '0') return parts[0] === lp[0] && vcmp(latest, num) >= 0
  if (parts.length === 1) return lp[0] === '0' && vcmp(latest, num) >= 0
  return lp[0] === '0' && lp[1] === parts[1] && vcmp(latest, num) >= 0
}

// ---------------------------------------------------------------- findings
const findings = []
const add = (severity, kind, subject, detail, repos, key) =>
  findings.push({ severity, kind, subject, detail, repos: [...new Set(repos)].sort(), key: key || `${kind}|${subject}|${[...new Set(repos)].sort().join(',')}|${detail}` })

// decl[eco|subject][repo] = Map(value -> Set(src)); lock likewise per graph
const decl = new Map()
const lock = new Map()
function note(store, eco, subject, repo, value, src) {
  if (value === null || value === undefined) return
  value = String(value).trim()
  if (!value) return
  const k = `${eco}|${subject}`
  if (!store.has(k)) store.set(k, new Map())
  const per = store.get(k)
  if (!per.has(repo)) per.set(repo, new Map())
  const vals = per.get(repo)
  if (!vals.has(value)) vals.set(value, new Set())
  vals.get(value).add(src)
}
const declNote = (...a) => note(decl, ...a)
const lockNote = (...a) => note(lock, ...a)

// ---------------------------------------------------------------- one repo
const WANT = /(^|\/)(Cargo\.toml|Cargo\.lock|package\.json|package-lock\.json|pyproject\.toml|pom\.xml|go\.mod|DESCRIPTION|CMakeLists\.txt|deny\.toml|osv-scanner\.toml|dependabot\.yml|update-lockfiles\.sh)$|\.csproj$|\.props$|^\.github\/workflows\/[^/]+\.ya?ml$|^\.github\/requirements\/[^/]+\.(in|txt)$/

class Product {
  constructor(name, paths, files) {
    this.name = name
    this.paths = paths
    this.files = files
    this.root = files.has('Cargo.toml') ? parseToml(files.get('Cargo.toml')) : {}
    const wp = this.root.workspace?.package || {}
    this.version = wp.version || this.root.package?.version || null
    this.crates = new Set()
    this.crateVersion = new Map()
    this.publishFalse = new Set()
    for (const [p, text] of files) {
      if (!/(^|\/)Cargo\.toml$/.test(p)) continue
      const t = parseToml(text)
      const pk = t.package || {}
      if (!pk.name) continue
      const v = isObj(pk.version) && pk.version.workspace ? this.version : pk.version
      this.crateVersion.set(pk.name, v)
      if (p !== 'fuzz/Cargo.toml' && !p.startsWith('examples/')) this.crates.add(pk.name)
      if (pk.publish === false) this.publishFalse.add(pk.name)
    }
  }
}

async function load(name) {
  const paths = (await tree(name)).filter((p) => !SKIP.test(p + '/'))
  const wanted = paths.filter((p) => WANT.test(p))
  const files = await blobs(name, wanted)
  return { paths, files }
}

// ---------------------------------------------------------------- 1. cargo
function scanCargo(p, owner) {
  for (const [src, text] of p.files) {
    if (!/(^|\/)Cargo\.toml$/.test(src)) continue
    const t = parseToml(text)
    const pk = t.package || {}
    const ws = t.workspace || {}
    if (ws.package?.['rust-version']) declNote('toolchain', 'rust-version (workspace)', p.name, ws.package['rust-version'], src)
    if (typeof pk['rust-version'] === 'string') declNote('toolchain', `rust-version (${src.startsWith('bindings/node/') ? 'bindings/node' : 'crate'})`, p.name, pk['rust-version'], src)
    if (ws.package?.edition) declNote('toolchain', 'edition', p.name, ws.package.edition, src)
    if (typeof pk.edition === 'string') declNote('toolchain', 'edition', p.name, pk.edition, src)
    const sections = [ws.dependencies || {}]
    for (const s of ['dependencies', 'dev-dependencies', 'build-dependencies']) {
      sections.push(t[s] || {})
      for (const tg of Object.values(t.target || {})) sections.push(tg[s] || {})
    }
    for (const sec of sections) {
      for (const [name, v] of Object.entries(sec)) {
        const real = isObj(v) ? v.package || name : name
        if (isObj(v) && 'workspace' in v) continue
        if (isObj(v) && 'path' in v && !('version' in v) && !('git' in v)) continue
        const spec = isObj(v) && 'git' in v ? 'git:' + (v.rev || v.tag || v.branch || 'HEAD') : typeof v === 'string' ? v : v?.version
        if (!spec) continue
        declNote('cargo', real, p.name, spec, src)
        const own = owner.get(real)
        if (own && own !== p) familyPin(p, real, spec, src, own)
        else if (own === p && p.crateVersion.get(real)) {
          const num = specNumber(spec), want = p.crateVersion.get(real)
          if (num && num.split('.').length === 3 && num !== want)
            add('defect', 'pin-stale-own', `${p.name} ${src}`, `${real} version = ${spec} while its manifest says ${want}; a bump touchpoint the bump script does not know`, [p.name])
        }
      }
    }
  }
  for (const [r, text] of p.files) {
    if (!/(^|\/)Cargo\.lock$/.test(r)) continue
    const graph = r === 'Cargo.lock' ? p.name : `${p.name}@${r.replace(/\/Cargo\.lock$/, '')}`
    const t = parseToml(text)
    const seen = new Map()
    for (const pk of t.package || []) {
      const { name: n, version: v } = pk
      const s = pk.source || ''
      if (!n || !v) continue
      lockNote('cargo', n, graph, v, r)
      const own = owner.get(n)
      if (!own) continue
      if (own === p) {
        const want = p.crateVersion.get(n)
        if (!s && want && v !== want && r !== 'Cargo.lock')
          add('defect', 'lock-stale', `${p.name} ${r}`, `records own crate ${n} ${v} while its manifest says ${want}; the lock was not refreshed after the bump`, [p.name])
        continue
      }
      if (!seen.has(n)) seen.set(n, new Set())
      seen.get(n).add(v)
      if (s.startsWith('git+')) add('defect', 'lock-git', `${p.name} ${r}`, `${n} ${v} comes from ${s.split('#')[0]}; ${own.name} publishes it`, [p.name, own.name])
      else if (own.version && vcmp(v, own.version) < 0) add('defect', 'lock-stale', `${p.name} ${r}`, `${n} locked at ${v}; ${own.name} main is ${own.version}`, [p.name, own.name])
    }
    for (const [n, vs] of seen) if (vs.size > 1) add('defect', 'lock-duplicate', `${p.name} ${r}`, `two copies of ${n} in one graph: ${[...vs].sort().join(', ')}`, [p.name])
  }
  if (p.files.has('fuzz/Cargo.toml')) declNote('convention', 'fuzz/Cargo.lock', p.name, p.paths.includes('fuzz/Cargo.lock') ? 'tracked' : 'ignored', 'fuzz/')
}

function familyPin(p, crate, spec, src, own) {
  const latest = own.version
  if (spec.startsWith('git:')) {
    add('defect', 'pin-git', `${p.name} ${src}`, `${crate} from git (${spec.slice(4)}); ${own.name} publishes ${latest} on crates.io`, [p.name, own.name])
    return
  }
  const num = specNumber(spec)
  if (!num || !latest) return
  if (spec.trim().startsWith('=')) {
    if (num !== latest) add('defect', 'pin-behind', `${p.name} ${src}`, `${crate} = ${spec} while ${own.name} main is ${latest}`, [p.name, own.name])
  } else if (!satisfied(spec, latest)) add('defect', 'pin-blocked', `${p.name} ${src}`, `${crate} = ${spec} cannot reach ${latest} (${own.name} main)`, [p.name, own.name])
  const dots = num.split('.').length - 1
  const style = spec.trim().startsWith('=') ? 'exact' : dots === 0 ? 'major-only' : dots === 1 ? 'minor' : 'caret-patch'
  declNote('convention', `family pin style for ${crate}`, p.name, style, src)
}

// ---------------------------------------------------------------- 2. npm
function scanNpm(p) {
  for (const [src, text] of p.files) {
    if (/(^|\/)package\.json$/.test(src)) {
      let t
      try { t = JSON.parse(text) } catch { continue }
      for (const sec of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, v] of Object.entries(t[sec] || {})) {
          if (name.startsWith('wickra') && (String(v).startsWith('file:') || String(v).startsWith('$'))) continue
          if (name.startsWith('wickra') && sec === 'optionalDependencies') continue
          declNote('npm', name, p.name, v, src)
        }
      }
      for (const [k, v] of Object.entries(t.engines || {})) declNote('toolchain', `engines.${k}`, p.name, String(v).replace(/\s+/g, ''), src)
    }
    if (/(^|\/)package-lock\.json$/.test(src)) {
      let t
      try { t = JSON.parse(text) } catch { continue }
      const graph = src === 'bindings/node/package-lock.json' ? p.name : `${p.name}@${src.replace(/\/package-lock\.json$/, '')}`
      for (const [path, pk] of Object.entries(t.packages || {})) {
        if (path && pk.version && !pk.link) lockNote('npm', path.split('node_modules/').pop(), graph, pk.version, src)
      }
    }
  }
}

// ---------------------------------------------------------------- 3. python
const pyName = (r) => r.split(/[<>=~!;[ ]/)[0]
function scanPython(p) {
  for (const [src, text] of p.files) {
    if (/(^|\/)pyproject\.toml$/.test(src)) {
      const t = parseToml(text)
      for (const r of t['build-system']?.requires || []) declNote('python', 'build: ' + pyName(r), p.name, r, src)
      const pr = t.project || {}
      if (pr['requires-python']) declNote('toolchain', 'requires-python', p.name, pr['requires-python'], src)
      const deps = [...(pr.dependencies || []), ...Object.values(pr['optional-dependencies'] || {}).flat()]
      for (const r of deps) declNote('python', pyName(r), p.name, r, src)
    }
  }
  const reqs = p.paths.filter((x) => x.startsWith('.github/requirements/'))
  if (reqs.length) {
    declNote('convention', 'requirements layout', p.name, reqs.filter((x) => x.endsWith('.in')).map((x) => x.split('/').pop()).sort().join(' '), '.github/requirements')
    for (const f of reqs) {
      const text = p.files.get(f)
      if (!text) continue
      const base = f.split('/').pop()
      for (const raw of text.split('\n')) {
        const line = raw.split('#')[0].trim()
        if (!line || line.startsWith('-')) continue
        if (f.endsWith('.in')) declNote('python-req', `${base}: ${pyName(line)}`, p.name, line, f)
        else {
          const m = line.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?==([^ \\;]+)/)
          if (m) lockNote('python', `${base}: ${m[1].toLowerCase()}`, p.name, m[2], f)
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 4. maven / dotnet / go / R / cmake
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim()
function scanOthers(p) {
  for (const [src, text] of p.files) {
    if (/(^|\/)pom\.xml$/.test(src)) {
      const props = {}
      const propsBlock = text.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] || ''
      for (const m of propsBlock.matchAll(/<([\w.\-]+)>([^<]*)<\/\1>/g)) {
        props[m[1]] = m[2].trim()
        if (['maven.compiler.release', 'maven.compiler.source', 'maven.compiler.target'].includes(m[1])) declNote('toolchain', m[1], p.name, props[m[1]], src)
      }
      const resolve = (v) => (v.startsWith('${') && v.endsWith('}') ? props[v.slice(2, -1)] ?? v : v)
      for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const g = tag(m[1], 'groupId') || '', a = tag(m[1], 'artifactId') || '', v = tag(m[1], 'version')
        if (v && !a.startsWith('wickra')) declNote('maven', `${g}:${a}`, p.name, resolve(v), src)
      }
      for (const m of text.matchAll(/<plugin>([\s\S]*?)<\/plugin>/g)) {
        const g = tag(m[1], 'groupId') || 'org.apache.maven.plugins', a = tag(m[1], 'artifactId') || '', v = tag(m[1], 'version')
        if (v) declNote('maven', `plugin ${g}:${a}`, p.name, resolve(v), src)
      }
    }
    if (/\.(csproj|props)$/.test(src)) {
      for (const t of ['TargetFramework', 'TargetFrameworks', 'LangVersion']) {
        for (const m of text.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))) declNote(t === 'LangVersion' ? 'dotnet' : 'toolchain', t, p.name, m[1].trim(), src)
      }
      for (const m of text.matchAll(/<PackageReference\s+([^>]*?)\/?>/g)) {
        const n = m[1].match(/(?:Include|Update)="([^"]+)"/)?.[1]
        const v = m[1].match(/Version="([^"]+)"/)?.[1]
        if (n && v && !v.startsWith('$(') && !n.startsWith('Wickra')) declNote('dotnet', n, p.name, v, src)
      }
    }
    if (/(^|\/)go\.mod$/.test(src)) {
      const m = text.match(/^go (\S+)/m)
      if (m) declNote('toolchain', 'go directive', p.name, m[1], src)
      for (const mm of text.matchAll(/^\s*([\w./\-]+) (v[\w.\-+]+)/gm)) if (!mm[1].startsWith('github.com/wickra-lib')) declNote('go', mm[1], p.name, mm[2], src)
    }
    if (/(^|\/)DESCRIPTION$/.test(src)) {
      const fields = {}
      let cur = null
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Za-z/@]+):(.*)$/)
        if (m) { cur = m[1]; fields[cur] = m[2].trim() }
        else if (cur && /^[ \t]/.test(line)) fields[cur] += ' ' + line.trim()
      }
      for (const f of ['Depends', 'Imports', 'Suggests', 'LinkingTo']) {
        for (const item of (fields[f] || '').split(',')) {
          const it = item.trim()
          const m = it.match(/^([\w.]+)\s*(\(.*\))?/)
          if (m && it) declNote(m[1] === 'R' ? 'toolchain' : 'r', `${f}: ${m[1]}`, p.name, (m[2] || '(any)').replace(/^\(|\)$/g, '').trim(), src)
        }
      }
    }
    if (/(^|\/)CMakeLists\.txt$/.test(src)) {
      const m = text.match(/cmake_minimum_required\s*\(\s*VERSION\s+([\d.]+)/i)
      if (m) declNote('toolchain', 'cmake_minimum_required', p.name, m[1], src)
      for (const v of ['CMAKE_C_STANDARD', 'CMAKE_CXX_STANDARD']) {
        const mm = text.match(new RegExp(`set\\s*\\(\\s*${v}\\s+(\\d+)`))
        if (mm) declNote('toolchain', v, p.name, mm[1], src)
      }
    }
  }
}

// ---------------------------------------------------------------- 5. CI
const uvHashes = new Map() // version -> Map(repo -> {target: sha})
function scanCi(p) {
  for (const [src, text] of p.files) {
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(src)) {
      for (const m of text.matchAll(/uses:\s*([\w.\-]+\/[\w.\-/]+)@([\w.\-]+)(?:\s*#\s*(v?[\w.\-]+))?/g)) {
        declNote('actions', m[1], p.name, `${m[2].slice(0, 12)} ${m[3] || ''}`.trim(), src)
      }
      for (const lang of ['java', 'go', 'python', 'node', 'dotnet']) {
        const vals = new Set()
        for (const m of text.matchAll(new RegExp(`${lang}-version:\\s*(\\[[^\\]]+\\]|['"]?[\\w.]+['"]?)`, 'g'))) {
          const v = m[1]
          if (v.includes('${{')) continue
          for (const x of v.match(/[\w.]+/g) || []) if (x !== 'matrix') vals.add(x.replace(/\.x$/, ''))
        }
        if (vals.size && src === '.github/workflows/ci.yml') declNote('ci-matrix', `${lang}-version in ci.yml`, p.name, [...vals].sort(vcmp).join(','), src)
      }
      for (const m of text.matchAll(/^\s*-?\s*run:\s*(?:python -m )?pip install ([\w\-= .<>/]+)$/gm)) {
        const args = m[1].trim()
        if (['--require-hashes', '-r ', '--no-index', '--find-links', '-e ', './', 'dist'].some((x) => args.includes(x))) continue
        add('defect', 'ci-unpinned', `${p.name} ${src}`, `\`pip install ${args}\` resolves from the index without a hash-locked requirements file`, [p.name])
      }
      for (const m of text.matchAll(/(nightly-\d{4}-\d{2}-\d{2}|\bnightly\b)/g)) declNote('ci-matrix', 'fuzz nightly', p.name, m[1] === 'nightly' ? 'floating' : 'pinned', src)
    }
  }
  const ul = p.files.get('scripts/update-lockfiles.sh')
  if (ul) {
    const m = ul.match(/^UV_VERSION="([^"]+)"/m)
    if (m) {
      declNote('toolchain', 'uv bootstrap', p.name, m[1], 'scripts/update-lockfiles.sh')
      const hashes = {}
      for (const h of ul.matchAll(/^\s*([\w\-]+)\)\s*echo "([0-9a-f]{64})" ;;/gm)) hashes[h[1]] = h[2]
      if (!uvHashes.has(m[1])) uvHashes.set(m[1], new Map())
      uvHashes.get(m[1]).set(p.name, hashes)
    }
  }
}

async function checkUv() {
  for (const [ver, per] of uvHashes) {
    const sets = new Map()
    for (const [repo, hs] of per) {
      const k = JSON.stringify(Object.entries(hs).sort())
      if (!sets.has(k)) sets.set(k, [])
      sets.get(k).push(repo)
    }
    if (sets.size > 1) {
      for (const [k, repos] of sets) {
        const first = Object.fromEntries(JSON.parse(k))[UV_TARGETS[0]] || '?'
        add('defect', 'uv-checksums', `uv ${ver}`, `${sets.size} different checksum sets for one version; this one starts ${first.slice(0, 8)}`, repos)
      }
    }
    const upstream = {}
    for (const t of UV_TARGETS) {
      const res = await request(`https://github.com/astral-sh/uv/releases/download/${ver}/uv-${t}.tar.gz.sha256`)
      upstream[t] = res ? (await res.text()).split(/\s+/)[0] : null
    }
    for (const [repo, hs] of per) {
      const bad = UV_TARGETS.filter((t) => upstream[t] && hs[t] !== upstream[t])
      if (bad.length) add('defect', 'uv-checksums', `${repo} uv ${ver}`, `checksum for ${bad.join(', ')} is not the one uv ${ver} publishes; WICKRA_BOOTSTRAP_UV=1 refuses the download`, [repo])
    }
  }
}

// ---------------------------------------------------------------- 6. dependabot
const MANIFESTS = { cargo: ['Cargo.toml'], npm: ['package.json'], pip: ['pyproject.toml', 'requirements.in', 'requirements.txt'], maven: ['pom.xml'], nuget: ['.csproj'], gomod: ['go.mod'] }
function scanDependabot(name, paths, files) {
  const dirs = Object.fromEntries(Object.keys(MANIFESTS).map((k) => [k, new Set()]))
  const dirOf = (p) => { const d = p.split('/').slice(0, -1).join('/'); return d ? '/' + d : '/' }
  const set = new Set(paths)
  for (const p of paths) {
    const f = p.split('/').pop()
    for (const [eco, names] of Object.entries(MANIFESTS)) {
      const hit = names.includes(f) || (names[0].startsWith('.') && f.endsWith(names[0]))
      if (!hit) continue
      const d = dirOf(p)
      if (eco === 'cargo' && d !== '/' && !set.has(p.replace(/Cargo\.toml$/, 'Cargo.lock'))) continue
      if (eco === 'pip' && f.endsWith('.in') && !d.includes('requirements')) continue
      dirs[eco].add(d)
    }
  }
  const cfg = files.get('.github/dependabot.yml')
  if (!cfg) { declNote('convention', 'dependabot.yml present', name, 'no', '.github/'); return }
  declNote('convention', 'dependabot.yml present', name, 'yes', '.github/')
  // the two keys this needs, read line by line: one update block per
  // `package-ecosystem`, its `directory` or `directories` list.
  const covered = {}
  let eco = null
  const lines = cfg.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].split('#')[0]
    let m
    if ((m = line.match(/package-ecosystem:\s*['"]?([\w-]+)/))) { eco = m[1]; covered[eco] ??= new Set(); continue }
    if (!eco) continue
    if ((m = line.match(/^\s*directory:\s*['"]?([^'"\s]+)/))) covered[eco].add(m[1].replace(/\/$/, '') || '/')
    else if ((m = line.match(/^\s*directories:\s*\[([^\]]*)\]/))) for (const d of m[1].split(',')) { const x = d.trim().replace(/^['"]|['"]$/g, ''); if (x) covered[eco].add(x.replace(/\/$/, '') || '/') }
    else if (/^\s*directories:\s*$/.test(line)) {
      // the list runs until the next key; comment and blank lines inside it are skipped
      while (i + 1 < lines.length && /^\s*(-\s*|#|$)/.test(lines[i + 1])) {
        const item = lines[++i].split('#')[0]
        if (!/^\s*-\s*/.test(item)) continue
        const x = item.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '')
        if (x) covered[eco].add(x.replace(/\/$/, '') || '/')
      }
    }
  }
  const dirExists = (d) => d === '/' || paths.some((p) => p.startsWith(d.replace(/^\//, '') + '/'))
  for (const [e, cov] of Object.entries(covered)) for (const d of cov) if (!dirExists(d)) add('defect', 'dependabot-missing-dir', `${name} dependabot.yml`, `${e} directory ${d} does not exist; Dependabot silently skips it`, [name])
  for (const e of Object.keys(MANIFESTS)) {
    for (const d of [...dirs[e]].sort()) {
      if (covered[e]?.has(d)) continue
      if (e === 'nuget' && !d.endsWith('.Tests')) continue
      if (e === 'pip' && d.startsWith('/.github')) continue
      declNote('dependabot', `${e} ${d}`, name, 'uncovered', '.github/dependabot.yml')
    }
  }
  for (const [e, cov] of Object.entries(covered)) for (const d of cov) declNote('dependabot', `${e} ${d}`, name, 'covered', '.github/dependabot.yml')
}

// ---------------------------------------------------------------- 7. supply-chain
function scanSupply(p) {
  const dt = p.files.get('deny.toml')
  if (dt) for (const adv of parseToml(dt).advisories?.ignore || []) declNote('supply', 'deny ignore ' + (isObj(adv) ? adv.id : adv), p.name, 'yes', 'deny.toml')
  const ot = p.files.get('osv-scanner.toml')
  if (ot) for (const ip of parseToml(ot).IgnoredVulns || []) declNote('supply', 'osv ignore ' + ip.id, p.name, 'yes', 'osv-scanner.toml')
}

// ---------------------------------------------------------------- reduce
const short = (r) => r.replace(/^wickra-/, '') || 'core'
function reduce(owner) {
  for (const [k, per] of [...decl].sort()) {
    const [eco, subject] = k.split('|')
    if (per.size < 2 && eco !== 'cargo') continue
    const values = new Map()
    for (const [repo, vs] of per) for (const v of vs.keys()) { if (!values.has(v)) values.set(v, new Set()); values.get(v).add(repo) }
    const dup = [...per].filter(([, vs]) => vs.size > 1).map(([repo, vs]) => [repo, [...vs.keys()].sort()])
    if (values.size < 2 && !dup.length) continue
    let sev = eco === 'supply' ? 'info' : 'drift'
    if (eco === 'dependabot' && !(values.has('covered') && values.has('uncovered'))) continue
    const groups = [...values].sort((a, b) => b[1].size - a[1].size)
    let detail = groups.map(([v, rs]) => `${v}: ${rs.size} [${[...rs].map(short).sort().join(', ')}]`).join(' | ')
    if (dup.length) detail += ' || two values in one repo: ' + dup.map(([r, v]) => `${short(r)}=${v.join('/')}`).join('; ')
    add(sev, `decl:${eco}`, subject, detail, [...per.keys()], `decl:${eco}|${subject}|` + [...values].sort().map(([v, rs]) => `${v}=${[...rs].sort().join(',')}`).join('|'))
  }
  for (const [k, per] of [...lock].sort()) {
    const [eco, subject] = k.split('|')
    if (per.size < 2) continue
    const bands = new Map()
    for (const [graph, vs] of per) for (const v of vs.keys()) { const b = band(v); if (!bands.has(b)) bands.set(b, new Set()); bands.get(b).add(graph) }
    if (bands.size < 2) continue
    const isFamily = owner.has(subject) || subject.startsWith('wickra')
    const groups = [...bands].sort((a, b) => b[1].size - a[1].size)
    const detail = groups.map(([b, gs]) => `${b}: ${gs.size} [${[...gs].map((g) => g.replace(/^wickra-/, '')).sort().join(', ')}]`).join(' | ')
    add(isFamily ? 'drift' : 'info', `lock:${eco}`, subject, detail, [...per.keys()].map((g) => g.split('@')[0]), `lock:${eco}|${subject}|` + [...bands].sort().map(([b, gs]) => `${b}=${[...gs].sort().join(',')}`).join('|'))
  }
}

// ---------------------------------------------------------------- main
const orgRepos = []
for (let page = 1; ; page++) {
  const res = await gh(`/orgs/${OWNER}/repos?type=public&per_page=100&page=${page}`)
  const body = res ? await res.json() : []
  if (!body.length) break
  orgRepos.push(...body.filter((r) => !r.archived).map((r) => r.name))
}
const productNames = REPO_NAMES.filter((n) => orgRepos.includes(n))
const siteNames = orgRepos.filter((n) => /-site$|^wickra-docs$|^webpage$|-live$/.test(n) && !productNames.includes(n))

const products = []
for (const name of productNames) {
  const { paths, files } = await load(name)
  products.push(new Product(name, paths, files))
}
const owner = new Map()
for (const p of products) for (const c of p.crates) owner.set(c, p)

for (const p of products) {
  scanCargo(p, owner)
  scanNpm(p)
  scanPython(p)
  scanOthers(p)
  scanCi(p)
  scanDependabot(p.name, p.paths, p.files)
  scanSupply(p)
}
await checkUv()
for (const name of siteNames) {
  const { paths, files } = await load(name)
  scanDependabot(name, paths, files)
}
reduce(owner)

const ORDER = { defect: 0, drift: 1, info: 2 }
findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject))
let previous = new Set()
try { previous = new Set(JSON.parse(await readFile('versions/drift.json', 'utf8')).keys) } catch {}
const counts = { defect: 0, drift: 0, info: 0 }
for (const f of findings) counts[f.severity]++
const fresh = findings.filter((f) => !previous.has(f.key))
const scannedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const esc = (s) => String(s).replace(/\|/g, '\\|')

const out = []
out.push('# Version drift', '', 'Generated by [`scripts/fetch-drift.mjs`](../scripts/fetch-drift.mjs) -- do not edit by hand.', '')
out.push(`Last scan: **${scannedAt}** over ${products.length} product repositories and ${siteNames.length} sites.`, '')
out.push(`**${counts.defect} defects, ${counts.drift} drift, ${counts.info} info**` + (fresh.length ? `; ${fresh.length} new since the previous scan.` : '; nothing new since the previous scan.'), '')
out.push('A *defect* is wrong on its own terms (a family pin behind its owner, a git source for a published crate, a stale committed lock, an unpinned pip install, a uv checksum of another release, a Dependabot directory that does not exist). *Drift* is the same thing spelled differently in two repositories. *Info* is a resolved-lock band difference or a supply-chain ignore.', '')
for (const sev of ['defect', 'drift', 'info']) {
  const rows = findings.filter((f) => f.severity === sev)
  out.push(`## ${sev} (${rows.length})`, '')
  if (!rows.length) { out.push('None.', ''); continue }
  out.push('| | kind | subject | detail |', '|---|---|---|---|')
  for (const f of rows) out.push(`| ${previous.has(f.key) ? '' : 'new'} | \`${f.kind}\` | ${esc(f.subject)} | ${esc(f.detail)} |`)
  out.push('')
}
await writeFile('versions/drift.md', out.join('\n') + '\n')
await writeFile('versions/drift.json', JSON.stringify({ scanned_at: scannedAt, counts, keys: findings.map((f) => f.key), findings }, null, 1) + '\n')
console.log(`drift: ${counts.defect} defects, ${counts.drift} drift, ${counts.info} info over ${products.length} products + ${siteNames.length} sites; ${fresh.length} new`)
