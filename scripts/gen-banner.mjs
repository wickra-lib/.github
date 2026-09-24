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
 *   3. write profile/wickra-banner.svg, the banner the profile shows: the same
 *      picture as vectors, every glyph converted to a path,
 *   4. render profile/wickra-banner.webp, a raster copy for places that take
 *      no SVG.
 *
 * Both SVGs are build products, committed so the picture stays reviewable as a
 * diff; edit banner-svg.mjs, never an SVG.
 *
 * Why the profile shows vectors: the README scales the banner to its column,
 * roughly 900 CSS px, so a raster of any size is resampled by the browser, and
 * the 12-15 px labels came out soft however many pixels the source had. A
 * vector banner is rasterised by the browser at the screen's own resolution,
 * so the text is as sharp as the display allows at every width and zoom. The
 * glyphs become paths because an <img> SVG cannot load fonts: live text would
 * fall back to whatever monospace face the viewer has and break the measured
 * layout banner-svg.mjs relies on.
 *
 * resvg does both conversions (deterministic font handling); sharp encodes the
 * raster as lossless WebP.
 *
 * indicator-count.yml runs this hourly after correcting the count, and
 * banner.yml runs it whenever the layout or the library table changes, so the
 * rendered org profile always shows the current banner. Run locally with:
 *   npm install && npm run gen:banner
 * (the SVG pins 'DejaVu Sans Mono', present on the CI runner; a machine without
 * it renders the banner in a substitute face -- point BANNER_FONT_DIR at a
 * directory holding DejaVuSansMono.ttf and DejaVuSansMono-Bold.ttf, or
 * regenerate in CI before trusting a local render.)
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
const vectorPath = resolve(root, 'profile/wickra-banner.svg')
const outPath = resolve(root, 'profile/wickra-banner.webp')

const font = {
  loadSystemFonts: true,
  fontDirs: process.env.BANNER_FONT_DIR ? [process.env.BANNER_FONT_DIR] : [],
}

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

// Soften the corners. A README cannot round an image, so it is baked in: about
// 12px once GitHub scales the banner into the README column. In viewBox units
// (1280x640) that is a radius of 56/3.
const RADIUS = 56 / 3

// 3. The vector banner. resvg resolves the text against 'DejaVu Sans Mono'
//    (present on the CI ubuntu runner) and writes every glyph out as a path.
let vector = new Resvg(svg, { font }).toString()
if (/<text[\s>]/.test(vector)) {
  console.error('error: text survived the conversion to paths')
  process.exit(1)
}
// resvg writes the gradient of a <tspan fill="url(#gold)"> -- the "ra" of the
// wordmark -- as a copy with an empty id, referenced as url(#): left alone, the
// word renders black. Name it. More than one such copy could not be matched to
// its reference by position, so that stops the run instead of guessing.
const unnamed = vector.split('id=""').length - 1
const refs = vector.split('url(#)').length - 1
if (unnamed !== refs || unnamed > 1) {
  console.error(`error: ${unnamed} unnamed gradients against ${refs} url(#) references`)
  process.exit(1)
}
vector = vector.replace('id=""', 'id="goldText"').replace('url(#)', 'url(#goldText)')
// Clip the corners: wrap everything after <defs> in a rounded-rect clip.
const defsEnd = vector.indexOf('</defs>') + '</defs>'.length
const close = vector.lastIndexOf('</svg>')
vector =
  vector.slice(0, defsEnd - '</defs>'.length) +
  `<clipPath id="corners"><rect width="1280" height="640" rx="${RADIUS.toFixed(3)}" ry="${RADIUS.toFixed(3)}"/></clipPath></defs>` +
  `<g clip-path="url(#corners)">${vector.slice(defsEnd, close)}</g></svg>\n`
writeFileSync(vectorPath, vector)
console.log(`wrote profile/wickra-banner.svg (${vector.length} bytes, "${count} indicators")`)

// 4. The raster copy, from the vector banner so both show the same pixels'
//    worth of picture: 8K (6x the viewBox), lossless, alpha kept for the
//    rounded corners.
const png = new Resvg(vector, { fitTo: { mode: 'width', value: 7680 }, font })
  .render()
  .asPng()
const webp = await sharp(png).webp({ lossless: true }).toBuffer()
writeFileSync(outPath, webp)
console.log(`rendered profile/wickra-banner.webp (7680x3840 lossless, "${count} indicators")`)
