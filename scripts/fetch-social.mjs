/*
 * Snapshot the community/social badges — GitHub stars, forks, issues — and the
 * star-history chart into profile/badges/ so the main wickra README serves them
 * from this repo (like the status badges and the banner) instead of hot-linking
 * shields.io / star-history at page load.
 *
 * Hot-linking made the README show shields' transient "unable to select next
 * github token from pool" error live, and froze the star-history chart behind
 * GitHub's Camo image cache (the embedded <img> is proxied + cached, while the
 * linked page renders fresh). Serving committed snapshots from this repo fixes
 * both: a broken upstream is rejected here and the last good SVG is kept.
 *
 * Run by .github/workflows/refresh-social.yml hourly (commit-if-changed) and on
 * demand. Fault-tolerant: a badge that fails to fetch (HTTP error, non-SVG, or
 * an upstream error string) keeps its previous committed snapshot rather than
 * overwriting a good badge with a broken one. These are counts/charts, not
 * versions, so there is no monotonic guard — only validity checks.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// Mirrors the footer of the main wickra README. The shields style/colours match
// the previously hot-linked URLs so the rendered badges are unchanged.
const items = [
  { slug: 'stars', src: 'https://img.shields.io/github/stars/wickra-lib/wickra?style=for-the-badge&logo=github&logoColor=white&color=ffd866' },
  { slug: 'forks', src: 'https://img.shields.io/github/forks/wickra-lib/wickra?style=for-the-badge&logo=github&logoColor=white&color=78dce8' },
  { slug: 'issues', src: 'https://img.shields.io/github/issues/wickra-lib/wickra?style=for-the-badge&logo=github&logoColor=white&color=ff6188' },
  { slug: 'star-history', src: 'https://api.star-history.com/svg?repos=wickra-lib/wickra&type=Date&theme=dark', chart: true },
]

const outDir = resolve(root, 'profile/badges')
mkdirSync(outDir, { recursive: true })

let failures = 0
for (const it of items) {
  const target = resolve(outDir, `${it.slug}.svg`)
  try {
    const res = await fetch(it.src, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const svg = await res.text()
    if (!svg.includes('<svg')) throw new Error('response is not an SVG')
    if (it.chart) {
      // The star-history chart is a real plot: require the data line and a
      // non-trivial size so an error/placeholder SVG never replaces a good one.
      if (svg.length < 800 || !/<(path|polyline)\b/.test(svg)) {
        throw new Error('chart SVG looks empty or malformed')
      }
    } else {
      // A shields badge can answer HTTP 200 with a well-formed SVG whose *text*
      // is an error ("unable to select next github token from pool", ...) rather
      // than a count. Snapshotting that would replace a real value with an
      // error string, so detect it and keep the previous good snapshot below.
      const valueText = ((svg.match(/<text[^>]*>([^<]*)<\/text>/g) || []).pop() || '')
        .replace(/<[^>]+>/g, '')
        .trim()
      const valueLower = valueText.toLowerCase()
      const errorMarkers = ['unable to select', 'token from pool', 'inaccessible', 'invalid', 'no response', 'not found']
      if (errorMarkers.some((m) => valueLower.includes(m))) {
        throw new Error(`badge value is an upstream error: "${valueText}"`)
      }
    }
    writeFileSync(target, svg)
    console.log(`fetch-social: ${it.slug} ok`)
  } catch (err) {
    failures++
    if (existsSync(target)) {
      // keep the previous snapshot
      readFileSync(target)
      console.warn(`fetch-social: ${it.slug} failed (${err.message}); kept previous snapshot`)
    } else {
      console.warn(`fetch-social: ${it.slug} failed (${err.message}); no previous snapshot, skipped`)
    }
  }
}

console.log(`fetch-social: ${items.length - failures} ok, ${failures} failure(s)`)
