/*
 * Render a static badge in shields' flat style without asking shields.
 *
 * The status badges (CI, versions, scorecard, ...) carry values that only the
 * badge hosts know, so fetch-badges.mjs snapshots those and keeps the previous
 * file through an outage. The static ones -- "built on wickra", "status
 * pre-release", "live demo <host>", "built with VitePress" -- carry nothing a
 * host knows better than this repository, yet every README hot-linked them from
 * shields.io, and the day shields answered 520 they were the only broken row on
 * every page. This renders them here, once, deterministically: same geometry
 * as shields' flat style (20px, #555 label, gradient overlay, Verdana 11 at
 * scale(.1)), so they sit level with the snapshotted ones.
 *
 * Text widths use Verdana 11px advances; textLength pins the rendered width to
 * the computed one, so a viewer without Verdana still gets the same layout.
 * Logos are simple-icons (CC0) vendored under assets/logos/ and inlined as a
 * data URI, the way shields embeds them.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// shields' named colours that the family's READMEs used.
export const COLORS = {
  brightgreen: '4c1',
  success: '4c1',
  green: '97ca00',
  yellow: 'dfb317',
  orange: 'fe7d37',
  red: 'e05d44',
  blue: '007ec6',
  informational: '007ec6',
  lightgrey: '9f9f9f',
}

// Verdana 11px advance widths (px) for the characters the badges use; anything
// else takes the width of 'm', which is what shields falls back to.
const WIDTHS = {
  ' ': 3.9, '!': 4.4, '"': 5.1, '#': 8.0, '$': 7.0, '%': 11.7, '&': 8.1, "'": 3.0, '(': 4.9, ')': 4.9,
  '*': 7.0, '+': 8.9, ',': 4.0, '-': 4.9, '.': 4.0, '/': 5.0, ':': 4.4, ';': 4.4, '<': 8.9, '=': 8.9,
  '>': 8.9, '?': 6.0, '@': 11.0, '[': 4.9, '\\': 5.0, ']': 4.9, '_': 6.9, '|': 5.0, '~': 8.9,
  0: 7.0, 1: 7.0, 2: 7.0, 3: 7.0, 4: 7.0, 5: 7.0, 6: 7.0, 7: 7.0, 8: 7.0, 9: 7.0,
  A: 7.5, B: 7.6, C: 7.7, D: 8.4, E: 6.9, F: 6.3, G: 8.5, H: 8.3, I: 4.6, J: 5.0, K: 7.6, L: 6.1, M: 9.3,
  N: 8.3, O: 8.5, P: 6.7, Q: 8.5, R: 7.7, S: 7.5, T: 6.7, U: 8.1, V: 7.5, W: 10.8, X: 7.5, Y: 6.7, Z: 7.5,
  a: 6.6, b: 6.9, c: 5.8, d: 6.9, e: 6.6, f: 3.9, g: 6.9, h: 6.9, i: 3.0, j: 3.9, k: 6.4, l: 3.0, m: 10.7,
  n: 6.9, o: 6.7, p: 6.9, q: 6.9, r: 4.7, s: 5.7, t: 4.3, u: 6.9, v: 6.4, w: 9.0, x: 6.4, y: 6.4, z: 5.7,
}
const textWidth = (s) => [...s].reduce((w, ch) => w + (WIDTHS[ch] ?? WIDTHS.m), 0)

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function logoDataUri(name) {
  const svg = readFileSync(resolve(root, 'assets/logos', `${name}.svg`), 'utf-8')
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

// { label, message, color, logo? } -> SVG text. `color` is a hex triplet or
// sextet without '#', or one of shields' names above.
export function renderStaticBadge({ label, message, color = '007ec6', logo = null }) {
  const fill = `#${COLORS[color] ?? color}`
  const labelText = textWidth(label)
  const messageText = textWidth(message)
  // shields: 5px padding each side of a text run; a logo adds 14px plus 3px of gap.
  const logoSpace = logo ? 14 + 3 : 0
  const labelWidth = Math.round(labelText + 10 + logoSpace)
  const messageWidth = Math.round(messageText + 10)
  const width = labelWidth + messageWidth
  const labelX = (logoSpace + labelWidth) / 2
  const messageX = labelWidth + messageWidth / 2
  const title = escapeXml(`${label}: ${message}`)
  const text = (x, content, length) =>
    `<text aria-hidden="true" x="${(x * 10).toFixed(0)}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(length * 10).toFixed(0)}">${escapeXml(content)}</text>` +
    `<text x="${(x * 10).toFixed(0)}" y="140" transform="scale(.1)" fill="#fff" textLength="${(length * 10).toFixed(0)}">${escapeXml(content)}</text>`
  const image = logo ? `<image x="5" y="3" width="14" height="14" xlink:href="${logoDataUri(logo)}"/>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="20" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="#555"/><rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${fill}"/><rect width="${width}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">` +
    image +
    text(labelX, label, labelText) +
    text(messageX, message, messageText) +
    `</g></svg>\n`
  )
}
