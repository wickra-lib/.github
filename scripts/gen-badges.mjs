/*
 * Generate the static channel badges (Go module, r-universe) into
 * profile/badges/ WITHOUT fetching from any badge host. The version-tracking
 * badges (crates/pypi/npm/nuget/maven/...) are snapshotted by fetch-badges.mjs;
 * these two channels have no live version source yet, so they are rendered
 * locally as fixed flat-style SVGs (label | message) here instead.
 *
 * Pure string templating — no network, no dependencies. Run on demand:
 *   npm run gen:badges
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'profile/badges')
mkdirSync(outDir, { recursive: true })

// Approximate Verdana 11px advance width per character (px). Good enough to size
// the rounded boxes; <text textLength> then pins the glyph run to the same width
// so the label never overflows regardless of the renderer's font.
function textWidth(str) {
  let w = 0
  for (const ch of str) {
    if ("il.,:;'|!".includes(ch)) w += 3.4
    else if ('fjtrI()[]/ '.includes(ch)) w += 5
    else if ('mwMW'.includes(ch)) w += 10.5
    else if (ch >= 'A' && ch <= 'Z') w += 8.2
    else w += 6.9
  }
  return w
}

// Build one flat badge ("label | message") as a self-contained SVG string.
function badge(label, message, messageColor) {
  const pad = 6
  const labelW = Math.round(textWidth(label) + pad * 2)
  const msgW = Math.round(textWidth(message) + pad * 2)
  const w = labelW + msgW
  const labelTL = Math.round(textWidth(label) * 10)
  const msgTL = Math.round(textWidth(message) * 10)
  const labelX = (labelW / 2) * 10
  const msgX = (labelW + msgW / 2) * 10
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${msgW}" height="20" fill="${messageColor}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelTL}">${label}</text>
    <text x="${labelX}" y="140" transform="scale(.1)" textLength="${labelTL}">${label}</text>
    <text aria-hidden="true" x="${msgX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${msgTL}">${message}</text>
    <text x="${msgX}" y="140" transform="scale(.1)" textLength="${msgTL}">${message}</text>
  </g>
</svg>
`
}

const badges = [
  { slug: 'go', label: 'go', message: 'pkg.go.dev', color: '#00add8' },
  { slug: 'r-universe', label: 'r-universe', message: 'wickra', color: '#2c8ebb' },
]

for (const b of badges) {
  writeFileSync(resolve(outDir, `${b.slug}.svg`), badge(b.label, b.message, b.color))
  console.log(`gen-badges: ${b.slug}.svg`)
}
