#!/usr/bin/env node
/*
 * Regenerate the org-profile banner shown at the top of profile/README.md.
 *
 * The indicator count is baked into the banner, so it would go stale on every
 * new indicator. This keeps it honest, driven by the SAME count that
 * sync-about.yml (in wickra-lib/wickra) writes into profile/README.md:
 *
 *   1. read the canonical count from profile/README.md,
 *   2. patch it into assets/wickra-banner.svg (idempotent),
 *   3. render profile/wickra-banner.png from the SVG.
 *
 * The CI workflow (.github/workflows/banner.yml) runs this whenever the count
 * in profile/README.md changes and commits the refreshed PNG, so the rendered
 * org profile always shows the current banner. Run locally with:
 *   npm install && npm run gen:banner
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const svgPath = resolve(root, 'assets/wickra-banner.svg')
const readmePath = resolve(root, 'profile/README.md')
const outPath = resolve(root, 'profile/wickra-banner.png')

// 1. Canonical indicator count from the profile README (kept in sync by the
//    wickra repo's sync-about.yml).
const readme = readFileSync(readmePath, 'utf-8')
const match = readme.match(/(\d+)\s+indicators/i)
if (!match) {
  console.error('error: could not find the indicator count in profile/README.md')
  process.exit(1)
}
const count = match[1]

// 2. Patch the count into the SVG master (idempotent).
const before = readFileSync(svgPath, 'utf-8')
const svg = before.replace(/\d+ indicators/g, `${count} indicators`)
if (svg !== before) {
  writeFileSync(svgPath, svg)
  console.log(`patched assets/wickra-banner.svg -> "${count} indicators"`)
} else {
  console.log(`assets/wickra-banner.svg already at "${count} indicators"`)
}

// 3. Render the PNG at 3x the 1280x640 viewBox for a crisp retina banner.
//    The SVG pins 'DejaVu Sans Mono' (present on the CI ubuntu runner), so the
//    committed PNG renders deterministically in CI.
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 3840 },
  font: { loadSystemFonts: true },
})
writeFileSync(outPath, resvg.render().asPng())
console.log(`rendered profile/wickra-banner.png (3840x1920, "${count} indicators")`)
