/*
 * Snapshot the repo-status badge SVGs into profile/badges/ so both the org
 * profile README (./badges/<slug>.svg) and the project READMEs
 * (raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/<slug>.svg,
 * like the banner) serve them from this repo instead of hot-linking the badge
 * hosts. This survives a badge-host (shields.io/codecov/...) outage: the last
 * committed snapshot is always used.
 *
 * Two badge rows are produced from one generator:
 *   - profile/badges/                  -> the main `wickra` library
 *   - profile/badges/wickra-backtest/  -> the `wickra-backtest` backtester
 * Both rows are styled identically; only the underlying repo/package differs.
 *
 * Run by .github/workflows/refresh-badges.yml on a schedule (commit-if-changed)
 * and on demand. Fault-tolerant: if a single badge can't be fetched, the
 * previous committed snapshot is kept rather than dropped (so an unreleased
 * package keeps its placeholder until the first version is published).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { REPO_NAMES } from './repos.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// shields static-badge message escaping: '-' -> '--', '_' -> '__', ' ' -> '_'.
const escBadge = (s) => String(s).replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_')

const ghJson = async (path) => {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      'user-agent': 'wickra-badges',
      accept: 'application/vnd.github+json',
      ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  return res.json()
}

const VERSION_SLUGS = ['release', 'crates', 'pypi', 'npm', 'nuget', 'maven', 'go', 'r-universe']

// Label and logo for the "unreleased" placeholder below, per version badge.
const UNRELEASED = {
  release: ['release', 'github'],
  crates: ['crates.io', 'rust'],
  pypi: ['pypi', 'pypi'],
  npm: ['npm', 'npm'],
  nuget: ['nuget', 'nuget'],
  maven: ['maven--central', 'apachemaven'],
  go: ['go', 'go'],
  'r-universe': ['r--universe', 'r'],
}

// Snapshot one badge row into outDir. `releaseRepo` / `goRepo` resolve the two
// version badges that read from the GitHub API (shields' hosted github/v/*
// endpoints share a token pool that frequently errors, freezing the snapshot).
async function snapshot(badges, outDir, { releaseRepo, goRepo }) {
  mkdirSync(outDir, { recursive: true })

  for (const b of badges) {
    try {
      if (b.slug === 'release') {
        const v = (await ghJson(`repos/${releaseRepo}/releases/latest`)).tag_name
        b.src = `https://img.shields.io/badge/release-${escBadge(v)}-green?logo=github`
      } else if (b.slug === 'go') {
        const v = (await ghJson(`repos/${goRepo}/tags`))[0]?.name
        if (!v) throw new Error('no tags')
        b.src = `https://img.shields.io/badge/go-${escBadge(v)}-00ADD8?logo=go&logoColor=white`
      }
    } catch (err) {
      console.warn(`fetch-badges: resolve ${b.slug} failed (${err.message}); keeping shields fallback`)
    }
  }

  let failures = 0
  for (const b of badges) {
    const target = resolve(outDir, `${b.slug}.svg`)
    try {
      const res = await fetch(b.src, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const svg = await res.text()
      if (!svg.includes('<svg')) throw new Error('response is not an SVG')
      // A badge host (shields.io especially) can answer HTTP 200 with an SVG whose
      // *text* is an error ("unable to select next github token from pool", ...).
      // Snapshotting that would replace a real value with an error string.
      const valueText = ((svg.match(/<text[^>]*>([^<]*)<\/text>/g) || []).pop() || '')
        .replace(/<[^>]+>/g, '')
        .trim()
      const valueLower = valueText.toLowerCase()
      const errorMarkers = ['unable to select', 'token from pool', 'inaccessible', 'invalid', 'no response', 'not found']
      if (errorMarkers.some((m) => valueLower.includes(m))) {
        throw new Error(`badge value is an upstream error: "${valueText}"`)
      }
      // Version badges must read like a version (e.g. "v0.7.5"); anything else is
      // an upstream error (or an unpublished package, e.g. NuGet before release).
      if (VERSION_SLUGS.includes(b.slug) && !/^v?\d/.test(valueText)) {
        throw new Error(`version badge value is not a version: "${valueText}"`)
      }
      // Version badges are monotonic: a value lower than the committed snapshot is
      // a stale badge-host cache, not a real downgrade — reject it so the badge can
      // never move backwards (e.g. shields serving 0.8.4 over a committed 0.8.5).
      if (VERSION_SLUGS.includes(b.slug) && existsSync(target)) {
        const toTuple = (t) => { const m = String(t).match(/(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : null }
        const next = toTuple(valueText)
        const prevText = ((readFileSync(target, 'utf-8').match(/<text[^>]*>([^<]*)<\/text>/g) || []).pop() || '').replace(/<[^>]+>/g, '').trim()
        const prev = toTuple(prevText)
        if (next && prev && (next[0] < prev[0] || (next[0] === prev[0] && (next[1] < prev[1] || (next[1] === prev[1] && next[2] < prev[2]))))) {
          throw new Error(`version went backwards: "${valueText}" < committed "${prev.join('.')}" (stale cache)`)
        }
      }
      writeFileSync(target, svg)
      console.log(`fetch-badges: ${outDir.split('badges')[1] || ''}/${b.slug} ok`)
    } catch (err) {
      failures++
      if (existsSync(target)) {
        readFileSync(target) // keep the previous snapshot
        console.warn(`fetch-badges: ${b.slug} failed (${err.message}); kept previous snapshot`)
      } else if (UNRELEASED[b.slug]) {
        // Nothing published yet. Write an explicit "unreleased" badge rather
        // than no file at all: a README can then carry the full row from the
        // start, and the badge flips to the real version on the first publish
        // without the README changing. A real version is never overwritten --
        // this branch only runs when no snapshot exists.
        const [label, logo] = UNRELEASED[b.slug]
        try {
          const res = await fetch(`https://img.shields.io/badge/${label}-unreleased-lightgrey?logo=${logo}`, { redirect: 'follow' })
          const svg = await res.text()
          if (!res.ok || !svg.includes('<svg')) throw new Error(`HTTP ${res.status}`)
          writeFileSync(target, svg)
          console.log(`fetch-badges: ${b.slug} unreleased placeholder written`)
          failures--
        } catch (placeholderErr) {
          console.warn(`fetch-badges: ${b.slug} placeholder failed (${placeholderErr.message}); skipped`)
        }
      } else {
        console.warn(`fetch-badges: ${b.slug} failed (${err.message}); no previous snapshot, skipped`)
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// One entry per repo. Everything that follows the org naming convention is
// derived; only the parts that genuinely differ are spelled out.
//
//   crate      published crate name          default: the repo name
//   nuget      NuGet package id              no default -- the casing is not
//                                            derivable (Wickra.Backtest vs
//                                            WickraExchange vs Wickra.StrategyCi)
//   docs       docs host                     default: wickra.org
//   go         repo the go tag is read from  default: <repo>-go
//   runiv      r-universe package            default: the repo name, unhyphenated
//   verified   languages the corpus covers   default: 10
//   set        which badges apply            default: FULL
//   overrides  per-slug URL, for one-offs
//
// `set` exists because the repos are not uniform: wickra-embed ships only a C
// binding, wickra-pico publishes nothing to a package registry, and
// wickra-playground is a site with no release at all. Giving those the full row
// would point badges at packages that will never exist.
// ---------------------------------------------------------------------------
const FULL = ['ci', 'codeql', 'codecov', 'release', 'crates', 'pypi', 'npm', 'nuget', 'maven', 'go', 'r-universe', 'license', 'scorecard', 'best-practices', 'provenance', 'docs', 'verified']
const RUST_ONLY = ['ci', 'codeql', 'release', 'crates', 'license', 'scorecard', 'best-practices', 'provenance', 'docs']
const NO_REGISTRY = ['ci', 'codeql', 'release', 'license', 'scorecard', 'best-practices', 'provenance', 'docs']
const SITE_ONLY = ['ci', 'codeql', 'license', 'scorecard', 'docs']

const BEST_PRACTICES_PENDING = 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey'

const REPOS = [
  { repo: 'wickra', nuget: 'Wickra', docs: 'docs.wickra.org',
    overrides: { 'best-practices': 'https://www.bestpractices.dev/projects/13094/badge' } },
  { repo: 'wickra-backtest', nuget: 'Wickra.Backtest', docs: 'backtest.wickra.org' },
  { repo: 'wickra-benchmark', crate: 'wickra-benchmark-cli', nuget: 'Wickra.Benchmark' },
  { repo: 'wickra-compile', nuget: 'Wickra.Compile' },
  { repo: 'wickra-copilot', nuget: 'Wickra.Copilot', docs: 'copilot.wickra.org' },
  { repo: 'wickra-darwin', nuget: 'Wickra.Darwin' },
  // Ships a C binding only, and publishes the core crate under its own name.
  { repo: 'wickra-embed', crate: 'embed-core', set: RUST_ONLY },
  { repo: 'wickra-exchange', nuget: 'WickraExchange', verified: 9 },
  { repo: 'wickra-feature-store', nuget: 'Wickra.FeatureStore' },
  { repo: 'wickra-genome', nuget: 'Wickra.Genome' },
  { repo: 'wickra-gym', nuget: 'Wickra.Gym' },
  { repo: 'wickra-impact', nuget: 'Wickra.Impact' },
  // Firmware: its release workflow attaches artefacts and publishes no package.
  { repo: 'wickra-pico', set: NO_REGISTRY },
  // A deployed site, not a released package.
  { repo: 'wickra-playground', set: SITE_ONLY },
  { repo: 'wickra-proof', crate: 'wickra-proof-cli', nuget: 'Wickra.Proof' },
  { repo: 'wickra-radar', nuget: 'Wickra.Radar', docs: 'radar.wickra.org' },
  { repo: 'wickra-screener', nuget: 'Wickra.Screener' },
  { repo: 'wickra-shazam', nuget: 'Wickra.Shazam', docs: 'shazam.wickra.org' },
  { repo: 'wickra-strategy-ci', crate: 'wickra-strategy-ci-cli', nuget: 'Wickra.StrategyCi' },
  { repo: 'wickra-synth', nuget: 'Wickra.Synth' },
  { repo: 'wickra-terminal', nuget: 'WickraTerminal', docs: 'terminal.wickra.org' },
  { repo: 'wickra-timemachine', nuget: 'Wickra.TimeMachine' },
  { repo: 'wickra-verify', crate: 'wickra-verify-cli', nuget: 'Wickra.Verify' },
  { repo: 'wickra-xray', nuget: 'Wickra.Xray' },
  // Publishes the CLI crate under the repo name; no language bindings.
  { repo: 'wickra-zk', set: RUST_ONLY },
]

// Fail loudly if a repo is added to the shared list but not configured here,
// or configured here but dropped from the list. Silent drift is how copilot,
// radar and shazam ended up with two-month-old badges.
const configured = REPOS.map((r) => r.repo)
const missing = REPO_NAMES.filter((r) => !configured.includes(r))
const extra = configured.filter((r) => !REPO_NAMES.includes(r))
if (missing.length || extra.length) {
  throw new Error(`fetch-badges: config out of step with repos.mjs (missing: ${missing.join(', ') || 'none'}; unknown: ${extra.join(', ') || 'none'})`)
}

function buildRow(cfg) {
  const repo = cfg.repo
  const crate = cfg.crate ?? repo
  const docs = cfg.docs ?? 'wickra.org'
  const runiv = cfg.runiv ?? repo.replaceAll('-', '')
  const verified = cfg.verified ?? 10
  const src = {
    ci: `https://github.com/wickra-lib/${repo}/actions/workflows/ci.yml/badge.svg`,
    codeql: `https://github.com/wickra-lib/${repo}/actions/workflows/codeql.yml/badge.svg`,
    codecov: `https://codecov.io/gh/wickra-lib/${repo}/branch/main/graph/badge.svg`,
    release: `https://img.shields.io/github/v/release/wickra-lib/${repo}?logo=github&color=green`,
    crates: `https://img.shields.io/crates/v/${crate}.svg?logo=rust&color=orange`,
    pypi: `https://img.shields.io/pypi/v/${repo}.svg?logo=pypi&color=blue`,
    npm: `https://img.shields.io/npm/v/${repo}.svg?logo=npm&color=red`,
    nuget: `https://img.shields.io/nuget/v/${cfg.nuget}.svg?logo=nuget&color=blue`,
    maven: `https://img.shields.io/maven-central/v/org.wickra/${repo}.svg?logo=apachemaven&color=blue`,
    go: `https://img.shields.io/github/v/tag/wickra-lib/${cfg.go ?? `${repo}-go`}.svg?logo=go&logoColor=white&color=00ADD8&label=go`,
    'r-universe': `https://wickra-lib.r-universe.dev/badges/${runiv}`,
    license: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue',
    scorecard: `https://api.securityscorecards.dev/projects/github.com/wickra-lib/${repo}/badge`,
    'best-practices': BEST_PRACTICES_PENDING,
    provenance: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github',
    docs: `https://img.shields.io/badge/docs-${docs}-0ea5e9?logo=readthedocs&logoColor=white`,
    verified: `https://img.shields.io/badge/verified-${verified}_languages-brightgreen`,
  }
  return (cfg.set ?? FULL).map((slug) => ({ slug, src: cfg.overrides?.[slug] ?? src[slug] }))
}

// --dry-run prints the resolved URLs instead of fetching, so a change to the
// derivation above can be diffed against the previous output before it ships.
if (process.argv.includes('--dry-run')) {
  for (const cfg of REPOS) {
    for (const b of buildRow(cfg)) {
      console.log(`profile/badges/${cfg.repo}|${b.slug}\t${b.src}`)
    }
  }
  process.exit(0)
}

let failures = 0
for (const cfg of REPOS) {
  failures += await snapshot(buildRow(cfg), resolve(root, `profile/badges/${cfg.repo}`), {
    releaseRepo: `wickra-lib/${cfg.repo}`,
    goRepo: `wickra-lib/${cfg.go ?? `${cfg.repo}-go`}`,
  })
}

console.log(`fetch-badges: done (${failures} failure(s) across ${REPOS.length} rows)`)
