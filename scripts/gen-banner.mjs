#!/usr/bin/env node
/*
 * Regenerate the org-profile banner shown at the top of profile/README.md.
 *
 * The banner states the indicator count, so it would go stale on every new
 * indicator. This keeps it honest, driven by the SAME count that
 * indicator-count.yml writes into profile/README.md:
 *
 *   1. read the canonical count from profile/README.md,
 *   2. build assets/wickra-banner.svg from it (banner-svg.mjs owns the layout
 *      and the library table),
 *   3. render profile/wickra-banner.webp from that SVG.
 *
 * The SVG is a build product, committed so the picture stays reviewable as a
 * diff; edit banner-svg.mjs, never the SVG.
 *
 * resvg renders the SVG to a PNG buffer (deterministic font handling); sharp
 * then encodes it as WebP, which is markedly smaller than PNG.
 *
 * indicator-count.yml runs this hourly after correcting the count, and
 * banner.yml runs it whenever the layout or the library table changes, so the
 * rendered org profile always shows the current banner. Run locally with:
 *   npm install && npm run gen:banner
 * (the SVG pins 'DejaVu Sans Mono', present on the CI runner; a machine without
 * it renders the image in a substitute face -- regenerate in CI before trusting
 * a local WebP.)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import { buildBannerSvg } from './banner-svg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const svgPath = resolve(root, 'assets/wickra-banner.svg')
const readmePath = resolve(root, 'profile/README.md')
const outPath = resolve(root, 'profile/wickra-banner.webp')

// 1. Canonical indicator count from the profile README (kept in sync by
//    indicator-count.yml, which reads it out of wickra-lib/wickra).
const readme = readFileSync(readmePath, 'utf-8')
const match = readme.match(/(\d+)\s+indicators/i)
if (!match) {
  console.error('error: could not find the indicator count in profile/README.md')
  process.exit(1)
}
const count = match[1]

// 2. Build the SVG and write it only when it actually changed, so a no-op run
//    leaves the working tree clean and commits nothing.
const svg = buildBannerSvg(count)
const before = readFileSync(svgPath, 'utf-8')
if (svg !== before) {
  writeFileSync(svgPath, svg)
  console.log(`rebuilt assets/wickra-banner.svg ("${count} indicators")`)
} else {
  console.log(`assets/wickra-banner.svg already current ("${count} indicators")`)
}

// 3. Render at 3x the 1280x640 viewBox for a crisp 4K banner. The SVG pins
//    'DejaVu Sans Mono' (present on the CI ubuntu runner), so it renders
//    deterministically in CI. resvg -> PNG buffer, sharp -> WebP.
const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 3840 },
  font: { loadSystemFonts: true },
})
  .render()
  .asPng()

// Soften the corners. A README cannot round a raster image, so it is baked in
// here: composite a rounded-rect mask with 'dest-in', which keeps the pixels
// under the mask and makes the four corners transparent, and keep the alpha
// channel through the WebP encode. The radius is small relative to the 3840px
// width -- about 12px once GitHub scales the banner into the README column.
const RADIUS = 56
const cornerMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="1920"><rect width="3840" height="1920" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`,
)

const webp = await sharp(png)
  .composite([{ input: cornerMask, blend: 'dest-in' }])
  .webp({ quality: 90, alphaQuality: 100 })
  .toBuffer()
writeFileSync(outPath, webp)
console.log(`rendered profile/wickra-banner.webp (3840x1920, "${count} indicators")`)
