/*
 * Snapshot the community/social badges — GitHub stars, forks, issues — into
 * profile/badges/ so the org READMEs serve them from this repo (like the status
 * badges and the banner) instead of hot-linking shields.io at page load.
 *
 * Hot-linking made the README show shields' transient "unable to select next
 * github token from pool" error live. Serving committed snapshots from this
 * repo fixes that: a broken upstream is rejected here and the last good SVG is
 * kept.
 *
 * Layout mirrors fetch-badges.mjs: the main wickra repo writes to
 * profile/badges/, every other repo to profile/badges/<repo>/. The star-history
 * chart lands in the same directories but is drawn by
 * scripts/render-star-history.mjs rather than fetched, because star-history
 * stopped serving usable charts when GitHub restricted the stargazers API on
 * 2026-06-30.
 *
 * Run by .github/workflows/refresh-social.yml hourly (commit-if-changed) and on
 * demand. Fault-tolerant: a badge that fails to fetch (HTTP error, non-SVG, or
 * an upstream error string) keeps its previous committed snapshot rather than
 * overwriting a good badge with a broken one. These are counts, not versions, so
 * there is no monotonic guard — only validity checks.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { targets } from './repos.mjs'
import { roundCorners } from './svg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')



// The shields style/colours match the previously hot-linked URLs so the
// rendered badges are unchanged. Counts come from the repo object, which the
// stargazers restriction does not touch.
const socialBadges = ({ repo, dir }) => [
  { slug: 'stars', dir, src: `https://img.shields.io/github/stars/${repo}?style=for-the-badge&logo=github&logoColor=white&color=ffd866` },
  { slug: 'forks', dir, src: `https://img.shields.io/github/forks/${repo}?style=for-the-badge&logo=github&logoColor=white&color=78dce8` },
  { slug: 'issues', dir, src: `https://img.shields.io/github/issues/${repo}?style=for-the-badge&logo=github&logoColor=white&color=ff6188` },
]

const items = targets.flatMap(socialBadges)


let failures = 0
for (const it of items) {
  const outDir = resolve(root, it.dir)
  mkdirSync(outDir, { recursive: true })
  const target = resolve(outDir, `${it.slug}.svg`)
  try {
    const res = await fetch(it.src, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const svg = await res.text()
    if (!svg.includes('<svg')) throw new Error('response is not an SVG')
    // A shields badge can answer HTTP 200 with a well-formed SVG whose *text*
    // is an error ("unable to select next github token from pool", ...) rather
    // than a count. Snapshotting that would replace a real value with an error
    // string, so detect it and keep the previous good snapshot below.
    const valueText = ((svg.match(/<text[^>]*>([^<]*)<\/text>/g) || []).pop() || '')
      .replace(/<[^>]+>/g, '')
      .trim()
    const valueLower = valueText.toLowerCase()
    const errorMarkers = ['unable to select', 'token from pool', 'inaccessible', 'invalid', 'no response', 'not found']
    if (errorMarkers.some((m) => valueLower.includes(m))) {
      throw new Error(`badge value is an upstream error: "${valueText}"`)
    }
    writeFileSync(target, roundCorners(svg))
    console.log(`fetch-social: ${it.dir}/${it.slug} ok`)
  } catch (err) {
    failures++
    if (existsSync(target)) {
      // keep the previous snapshot
      readFileSync(target)
      console.warn(`fetch-social: ${it.dir}/${it.slug} failed (${err.message}); kept previous snapshot`)
    } else {
      console.warn(`fetch-social: ${it.dir}/${it.slug} failed (${err.message}); no previous snapshot, skipped`)
    }
  }
}

console.log(`fetch-social: ${items.length - failures} ok, ${failures} failure(s)`)
