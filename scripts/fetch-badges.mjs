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
