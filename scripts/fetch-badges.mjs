/*
 * Snapshot the repo-status badge SVGs into profile/badges/ so both the org
 * profile README (./badges/<slug>.svg) and the main wickra README
 * (raw.githubusercontent.com/wickra-lib/.github/main/profile/badges/<slug>.svg,
 * like the banner) serve them from this repo instead of hot-linking the badge
 * hosts. This survives a badge-host (shields.io/codecov/...) outage: the last
 * committed snapshot is always used.
 *
 * Run by .github/workflows/refresh-badges.yml on a schedule (commit-if-changed)
 * and on demand. Fault-tolerant: if a single badge can't be fetched, the
 * previous committed snapshot is kept rather than dropped.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// Source of truth for the badge row shared by the profile + main wickra README.
const badges = [
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
]

const outDir = resolve(root, 'profile/badges')
mkdirSync(outDir, { recursive: true })

// Two badges read a version from the GitHub API. shields.io's hosted
// github/v/* endpoints share one GitHub token pool that frequently answers
// "Unable to select next GitHub token from pool" instead of a value, which then
// freezes the snapshot at the last good version (release stuck at 0.8.6 while
// 0.8.8 was live). Resolve those two ourselves with the workflow's
// authenticated token and point the badge at a static shields render, so they
// never depend on shields' pool. On any failure we keep the shields URL already
// in the array as a fallback and let the fetch loop's guards handle it.
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
// shields static-badge message escaping: '-' -> '--', '_' -> '__', ' ' -> '_'.
const escBadge = (s) => String(s).replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_')

for (const b of badges) {
  try {
    if (b.slug === 'release') {
      const v = (await ghJson('repos/wickra-lib/wickra/releases/latest')).tag_name
      b.src = `https://img.shields.io/badge/release-${escBadge(v)}-green?logo=github`
    } else if (b.slug === 'go') {
      const v = (await ghJson('repos/wickra-lib/wickra-go/tags'))[0]?.name
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
    if (['release', 'crates', 'pypi', 'npm', 'nuget', 'maven', 'go', 'r-universe'].includes(b.slug) && !/^v?\d/.test(valueText)) {
      throw new Error(`version badge value is not a version: "${valueText}"`)
    }
    // Version badges are monotonic: a value lower than the committed snapshot is
    // a stale badge-host cache, not a real downgrade — reject it so the badge can
    // never move backwards (e.g. shields serving 0.8.4 over a committed 0.8.5).
    if (['release', 'crates', 'pypi', 'npm', 'nuget', 'maven', 'go', 'r-universe'].includes(b.slug) && existsSync(target)) {
      const toTuple = (t) => { const m = String(t).match(/(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : null }
      const next = toTuple(valueText)
      const prevText = ((readFileSync(target, 'utf-8').match(/<text[^>]*>([^<]*)<\/text>/g) || []).pop() || '').replace(/<[^>]+>/g, '').trim()
      const prev = toTuple(prevText)
      if (next && prev && (next[0] < prev[0] || (next[0] === prev[0] && (next[1] < prev[1] || (next[1] === prev[1] && next[2] < prev[2]))))) {
        throw new Error(`version went backwards: "${valueText}" < committed "${prev.join('.')}" (stale cache)`)
      }
    }
    writeFileSync(target, svg)
    console.log(`fetch-badges: ${b.slug} ok`)
  } catch (err) {
    failures++
    if (existsSync(target)) {
      // keep the previous snapshot
      readFileSync(target)
      console.warn(`fetch-badges: ${b.slug} failed (${err.message}); kept previous snapshot`)
    } else {
      console.warn(`fetch-badges: ${b.slug} failed (${err.message}); no previous snapshot, skipped`)
    }
  }
}

console.log(`fetch-badges: ${badges.length - failures} ok, ${failures} failure(s)`)
