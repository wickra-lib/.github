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
      } else {
        console.warn(`fetch-badges: ${b.slug} failed (${err.message}); no previous snapshot, skipped`)
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// Row 1 — the main wickra library.
// ---------------------------------------------------------------------------
const wickraBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickra' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra/badge' },
  { slug: 'best-practices', src: 'https://www.bestpractices.dev/projects/13094/badge' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-docs.wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 2 — the wickra-backtest backtester. Same style; backtest packages.
// Version badges read "unreleased" until the first publish, then auto-update.
// ---------------------------------------------------------------------------
const backtestBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-backtest/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-backtest/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-backtest/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-backtest?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-backtest.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-backtest.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-backtest.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.Backtest.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-backtest.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-backtest-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickrabacktest' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-backtest/badge' },
  // OpenSSF Best Practices: shows the passing/silver/gold level (not the score).
  // Placeholder until the bestpractices.dev project is registered; swap the src
  // to https://www.bestpractices.dev/projects/<id>/badge once it has an id.
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-backtest.wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 3 — the wickra-terminal trading terminal. Same style; terminal packages.
// Version badges read "unreleased" until the first publish, then auto-update.
// ---------------------------------------------------------------------------
const terminalBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-terminal/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-terminal/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-terminal/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-terminal?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-terminal.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-terminal.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-terminal.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/WickraTerminal.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-terminal.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-terminal-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickraterminal' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-terminal/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 4 — the wickra-exchange connectivity layer. Same style; exchange packages.
// Version badges read "unreleased" until the first publish, then auto-update.
// ---------------------------------------------------------------------------
const exchangeBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-exchange/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-exchange/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-exchange/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-exchange?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-exchange.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-exchange.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-exchange.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/WickraExchange.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-exchange.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-exchange-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickraexchange' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-exchange/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-9_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 5 — the wickra-screener multi-symbol screener. Same style; screener packages.
// Version badges read "unreleased" until the first publish, then auto-update.
// ---------------------------------------------------------------------------
const screenerBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-screener/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-screener/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-screener/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-screener?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-screener.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-screener.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-screener.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.Screener.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-screener.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-screener-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickrascreener' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-screener/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 6 — the wickra-xray market-microstructure explorer. Same style; xray packages.
// Version badges read "unreleased" until the first publish, then auto-update.
// ---------------------------------------------------------------------------
const xrayBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-xray/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-xray/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-xray/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-xray?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-xray.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-xray.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-xray.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.Xray.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-xray.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-xray-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickraxray' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-xray/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 7 — the wickra-proof proof-of-backtest core. Same style; proof packages.
// Version badges read "unreleased" until the first publish, then auto-update.
// ---------------------------------------------------------------------------
const proofBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-proof/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-proof/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-proof/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-proof?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-proof-cli.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-proof.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-proof.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.Proof.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-proof.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-proof-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickraproof' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-proof/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 8 — the wickra-verify backtest verifier. Same style; verify packages.
// Version badges read "unreleased" until the first publish, then auto-update.
// ---------------------------------------------------------------------------
const verifyBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-verify/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-verify/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-verify/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-verify?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-verify-cli.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-verify.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-verify.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.Verify.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-verify.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-verify-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickraverify' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-verify/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 9 — the wickra-benchmark reproducible benchmark suite. Same style;
// benchmark packages. Version badges read "unreleased" until the first publish.
// ---------------------------------------------------------------------------
const benchmarkBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-benchmark/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-benchmark/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-benchmark/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-benchmark?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-benchmark-cli.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-benchmark.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-benchmark.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.Benchmark.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-benchmark.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-benchmark-go.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickrabenchmark' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-benchmark/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

// ---------------------------------------------------------------------------
// Row 10 — the wickra-gym RL environment. Same style; gym packages. The Go
// module is published as a `bindings/go` subdirectory tag on wickra-gym itself
// (no standalone mirror repo), so the go badge reads that repo's tags. Version
// badges read "unreleased" until the first publish.
// ---------------------------------------------------------------------------
const gymBadges = [
  { slug: 'ci', src: 'https://github.com/wickra-lib/wickra-gym/actions/workflows/ci.yml/badge.svg' },
  { slug: 'codeql', src: 'https://github.com/wickra-lib/wickra-gym/actions/workflows/codeql.yml/badge.svg' },
  { slug: 'codecov', src: 'https://codecov.io/gh/wickra-lib/wickra-gym/branch/main/graph/badge.svg' },
  { slug: 'release', src: 'https://img.shields.io/github/v/release/wickra-lib/wickra-gym?logo=github&color=green' },
  { slug: 'crates', src: 'https://img.shields.io/crates/v/wickra-gym.svg?logo=rust&color=orange' },
  { slug: 'pypi', src: 'https://img.shields.io/pypi/v/wickra-gym.svg?logo=pypi&color=blue' },
  { slug: 'npm', src: 'https://img.shields.io/npm/v/wickra-gym.svg?logo=npm&color=red' },
  { slug: 'nuget', src: 'https://img.shields.io/nuget/v/Wickra.Gym.svg?logo=nuget&color=blue' },
  { slug: 'maven', src: 'https://img.shields.io/maven-central/v/org.wickra/wickra-gym.svg?logo=apachemaven&color=blue' },
  { slug: 'go', src: 'https://img.shields.io/github/v/tag/wickra-lib/wickra-gym.svg?logo=go&logoColor=white&color=00ADD8&label=go' },
  { slug: 'r-universe', src: 'https://wickra-lib.r-universe.dev/badges/wickragym' },
  { slug: 'license', src: 'https://img.shields.io/badge/license-MIT_OR_Apache--2.0-blue' },
  { slug: 'scorecard', src: 'https://api.securityscorecards.dev/projects/github.com/wickra-lib/wickra-gym/badge' },
  { slug: 'best-practices', src: 'https://img.shields.io/badge/openssf_best_practices-in_progress-lightgrey' },
  { slug: 'provenance', src: 'https://img.shields.io/badge/provenance-attested-brightgreen?logo=github' },
  { slug: 'docs', src: 'https://img.shields.io/badge/docs-wickra.org-0ea5e9?logo=readthedocs&logoColor=white' },
  { slug: 'verified', src: 'https://img.shields.io/badge/verified-10_languages-brightgreen' },
]

const f1 = await snapshot(wickraBadges, resolve(root, 'profile/badges'), {
  releaseRepo: 'wickra-lib/wickra',
  goRepo: 'wickra-lib/wickra-go',
})
const f2 = await snapshot(backtestBadges, resolve(root, 'profile/badges/wickra-backtest'), {
  releaseRepo: 'wickra-lib/wickra-backtest',
  goRepo: 'wickra-lib/wickra-backtest-go',
})
const f3 = await snapshot(terminalBadges, resolve(root, 'profile/badges/wickra-terminal'), {
  releaseRepo: 'wickra-lib/wickra-terminal',
  goRepo: 'wickra-lib/wickra-terminal-go',
})
const f4 = await snapshot(exchangeBadges, resolve(root, 'profile/badges/wickra-exchange'), {
  releaseRepo: 'wickra-lib/wickra-exchange',
  goRepo: 'wickra-lib/wickra-exchange-go',
})
const f5 = await snapshot(screenerBadges, resolve(root, 'profile/badges/wickra-screener'), {
  releaseRepo: 'wickra-lib/wickra-screener',
  goRepo: 'wickra-lib/wickra-screener-go',
})
const f6 = await snapshot(xrayBadges, resolve(root, 'profile/badges/wickra-xray'), {
  releaseRepo: 'wickra-lib/wickra-xray',
  goRepo: 'wickra-lib/wickra-xray-go',
})
const f7 = await snapshot(proofBadges, resolve(root, 'profile/badges/wickra-proof'), {
  releaseRepo: 'wickra-lib/wickra-proof',
  goRepo: 'wickra-lib/wickra-proof-go',
})
const f8 = await snapshot(verifyBadges, resolve(root, 'profile/badges/wickra-verify'), {
  releaseRepo: 'wickra-lib/wickra-verify',
  goRepo: 'wickra-lib/wickra-verify-go',
})
const f9 = await snapshot(benchmarkBadges, resolve(root, 'profile/badges/wickra-benchmark'), {
  releaseRepo: 'wickra-lib/wickra-benchmark',
  goRepo: 'wickra-lib/wickra-benchmark-go',
})
const f10 = await snapshot(gymBadges, resolve(root, 'profile/badges/wickra-gym'), {
  releaseRepo: 'wickra-lib/wickra-gym',
  goRepo: 'wickra-lib/wickra-gym',
})

console.log(`fetch-badges: done (${f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8 + f9 + f10} failure(s) across all rows)`)
