/*
 * Render the star-history chart for each org repo from GitHub's own stargazers
 * API and commit it next to the other badge snapshots.
 *
 * This used to be a snapshot of api.star-history.com. GitHub restricted the
 * stargazers API on 2026-06-30, so that service now answers with a data-less
 * placeholder for every repository it is not a collaborator on -- which is all
 * of them. Its documented workaround is to hand it a token and carry that token
 * in the public README. Reading our own stargazers directly avoids both: no
 * third party is involved and no token leaves the workflow.
 *
 * The token needs read access to the repos in `targets`, which the default
 * repo-scoped GITHUB_TOKEN does not have for siblings; STAR_HISTORY_TOKEN
 * overrides it when set. A repo whose data cannot be read keeps its previous
 * committed snapshot rather than losing a good chart, matching fetch-social.mjs.
 *
 * Run by .github/workflows/refresh-social.yml. See also scripts/fetch-social.mjs.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { targets } from './repos.mjs'
import { roundCorners } from './svg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')



const token = process.env.STAR_HISTORY_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('render-star-history: no token in STAR_HISTORY_TOKEN / GH_TOKEN / GITHUB_TOKEN')
  process.exit(1)
}

// The org-wide aggregate lives beside the per-repo directories under the org
// name, which is not a repo, so it cannot collide with one.
const ORG_DIR = 'profile/badges/wickra-lib'
const ORG_LABEL = 'wickra-lib · all repositories'

const W = 800, H = 400
const PAD = { top: 46, right: 28, bottom: 44, left: 62 }
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }

const BG = '#1f2430', GRID = '#333a48', AXIS = '#8a93a6', INK = '#e6e9ef', LINE = '#ffd866'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function stargazerDates(repo) {
  const dates = []
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github.star+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'wickra-lib-badges',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} reading stargazers`)
    const batch = await res.json()
    if (!Array.isArray(batch)) throw new Error('unexpected stargazers payload')
    for (const entry of batch) {
      if (entry && entry.starred_at) dates.push(Date.parse(entry.starred_at))
    }
    if (batch.length < 100) break
  }
  return dates.filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
}

// Round a count axis up to a readable maximum and pick a tick step for it.
function yAxis(total) {
  const targetTicks = 4
  const raw = Math.max(1, total) / targetTicks
  const mag = 10 ** Math.floor(Math.log10(raw))
  // Star counts are integers, so never step by a fraction: below three stars
  // that rounded to duplicate axis labels ([0, 1, 1, 2, 2, 3]).
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag)
  let max = Math.ceil(Math.max(1, total) / step) * step
  if (max <= total) max += step // keep the curve off the top border
  const ticks = []
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v))
  return { max, ticks }
}

function monthTicks(from, to) {
  const ticks = []
  const d = new Date(from)
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  while (d.getTime() <= to) {
    if (d.getTime() >= from) ticks.push(d.getTime())
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  // Thin the labels out so they never collide on a narrow plot.
  const keep = Math.ceil(ticks.length / 6)
  return ticks.filter((_, i) => i % keep === 0)
}

// Monotone cubic interpolation (Fritsch-Carlson). A cumulative star count only
// ever rises, and an ordinary spline through those points overshoots between
// them -- it would draw the chart dipping back below a count already reached.
// The limiter below clamps the tangents so the curve is smooth and still never
// goes backwards. Input is screen coordinates, where the sequence descends.
function smoothPath(points) {
  const n = points.length
  if (n < 2) return `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`
  const dx = [], slope = [], tangent = new Array(n)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0]
    slope[i] = (points[i + 1][1] - points[i][1]) / dx[i]
  }
  tangent[0] = slope[0]
  tangent[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0
      tangent[i + 1] = 0
      continue
    }
    const a = tangent[i] / slope[i]
    const b = tangent[i + 1] / slope[i]
    const sum = a * a + b * b
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum)
      tangent[i] = tau * a * slope[i]
      tangent[i + 1] = tau * b * slope[i]
    }
  }
  let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    const c1x = points[i][0] + h
    const c1y = points[i][1] + tangent[i] * h
    const c2x = points[i + 1][0] - h
    const c2y = points[i + 1][1] - tangent[i + 1] * h
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${points[i + 1][0].toFixed(1)} ${points[i + 1][1].toFixed(1)}`
  }
  return d
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (t) => {
  const d = new Date(t)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function render(repo, dates, now) {
  const total = dates.length
  // A margin before the first star, so the curve has somewhere to rise from.
  const first = total ? dates[0] : now - 30 * 864e5
  const last = Math.max(now, total ? dates[total - 1] : now)
  const from = first - Math.max(last - first, 864e5) * 0.04
  const to = last
  const span = Math.max(to - from, 864e5)
  const { max, ticks } = yAxis(total)

  const x = (t) => PAD.left + ((t - from) / span) * PLOT.w
  const y = (v) => PAD.top + PLOT.h - (v / max) * PLOT.h

  // Cumulative step path: each star is a vertical jump at the moment it landed.
  // One point per star at the moment it landed, flat to the left of the first
  // and to the right of the last. Stars sharing a timestamp collapse to the
  // later count, so the interpolation never divides by a zero-width step.
  const points = [[x(from), y(0)]]
  dates.forEach((stamp, i) => {
    const px = x(stamp)
    if (points.length && Math.abs(px - points[points.length - 1][0]) < 0.05) points.pop()
    points.push([px, y(i + 1)])
  })
  if (Math.abs(x(to) - points[points.length - 1][0]) >= 0.05) points.push([x(to), y(total)])
  const path = smoothPath(points)
  const area = `${path} L ${x(to).toFixed(1)} ${y(0).toFixed(1)} L ${x(from).toFixed(1)} ${y(0).toFixed(1)} Z`

  const gridRows = ticks
    .map((v) => `<line x1="${PAD.left}" y1="${y(v).toFixed(1)}" x2="${PAD.left + PLOT.w}" y2="${y(v).toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`)
    .join('\n  ')
  const yLabels = ticks
    .map((v) => `<text x="${PAD.left - 12}" y="${(y(v) + 6).toFixed(1)}" fill="${AXIS}" font-size="17" text-anchor="end">${v}</text>`)
    .join('\n  ')
  const xLabels = monthTicks(from, to)
    .map((t) => `<text x="${x(t).toFixed(1)}" y="${PAD.top + PLOT.h + 24}" fill="${AXIS}" font-size="15" text-anchor="middle">${label(t)}</text>`)
    .join('\n  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(repo)} star history">
  <title>${esc(repo)} star history</title>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="12" ry="12"/></clipPath>
  <g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <text x="${PAD.left}" y="26" fill="${INK}" font-family="system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="18" font-weight="600">${esc(repo)}</text>
  <text x="${W - PAD.right}" y="26" fill="${AXIS}" font-family="system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="16" text-anchor="end">${total} star${total === 1 ? '' : 's'}</text>
  <g font-family="system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  ${gridRows}
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + PLOT.h}" stroke="${AXIS}" stroke-width="1"/>
  <line x1="${PAD.left}" y1="${PAD.top + PLOT.h}" x2="${PAD.left + PLOT.w}" y2="${PAD.top + PLOT.h}" stroke="${AXIS}" stroke-width="1"/>
  <path d="${area}" fill="${LINE}" fill-opacity="0.12"/>
  <path d="${path}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>
  ${yLabels}
  ${xLabels}
  </g>
  </g>
</svg>
`
}

const now = Date.parse(process.env.STAR_HISTORY_NOW || new Date().toISOString())
let failures = 0
const everyStar = []
let covered = 0

for (const { repo, dir } of targets) {
  const outDir = resolve(root, dir)
  mkdirSync(outDir, { recursive: true })
  const target = resolve(outDir, 'star-history.svg')
  try {
    const dates = await stargazerDates(repo)
    writeFileSync(target, render(repo, dates, now))
    everyStar.push(...dates)
    covered++
    console.log(`render-star-history: ${dir}/star-history ok (${dates.length} stars)`)
  } catch (err) {
    failures++
    const kept = existsSync(target) ? 'kept previous snapshot' : 'no previous snapshot, skipped'
    console.warn(`render-star-history: ${repo} failed (${err.message}); ${kept}`)
  }
}

// The org-wide curve: every repo's stars on one timeline, merged in the order
// they were actually given rather than concatenated per repo, so the shape is
// the org's real growth. Written only when every repo was readable -- a partial
// total would be a wrong number rather than a stale one, and the previous
// snapshot is the better answer.
if (failures === 0 && everyStar.length) {
  const orgDir = resolve(root, ORG_DIR)
  mkdirSync(orgDir, { recursive: true })
  const merged = everyStar.slice().sort((a, b) => a - b)
  writeFileSync(resolve(orgDir, 'star-history.svg'), render(ORG_LABEL, merged, now))
  console.log(`render-star-history: ${ORG_DIR}/star-history ok (${merged.length} stars across ${covered} repos)`)
  try {
    const badge = `https://img.shields.io/badge/total%20stars-${merged.length}-ffd866?style=for-the-badge&logo=github&logoColor=white`
    const res = await fetch(badge, { redirect: 'follow' })
    const svg = await res.text()
    if (!res.ok || !svg.includes('<svg')) throw new Error(`HTTP ${res.status}`)
    writeFileSync(resolve(orgDir, 'stars.svg'), roundCorners(svg))
    console.log(`render-star-history: ${ORG_DIR}/stars ok (${merged.length})`)
  } catch (err) {
    console.warn(`render-star-history: org total badge failed (${err.message}); kept previous snapshot`)
  }
} else if (failures) {
  console.warn(`render-star-history: ${failures} repo(s) unreadable, org total left at its previous snapshot`)
}

console.log(`render-star-history: ${covered} ok, ${failures} failure(s)`)
