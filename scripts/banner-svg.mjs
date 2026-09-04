/*
 * Builds the org-profile banner as SVG.
 *
 * The banner names every library in the org and marks which of them have a
 * release, so it is drawn from the table below rather than kept as hand-edited
 * markup: shipping a library means flipping one boolean here, and the headline
 * count, the footer tally and the dot colours all follow. Editing the same
 * facts in three places inside a 20 KB SVG is how a banner starts lying.
 *
 * gen-banner.mjs passes in the indicator count (canonical source:
 * profile/README.md, kept current by indicator-count.yml) and renders the
 * result to profile/wickra-banner.webp.
 *
 * Text is measured rather than laid out by the renderer: everything is set in
 * DejaVu Sans Mono, whose glyphs all advance 0.60205 em, so a string's width is
 * known before it is drawn. That is what lets a label be centred over a
 * connector without a measuring pass.
 */

const W = 1280
const H = 640
const MONO = 0.60205 // DejaVu Sans Mono advance width, in em

/** Width of `text` at `size` px, with `ls` px of letter-spacing per glyph. */
const tw = (text, size, ls = 0) => text.length * (MONO * size + ls)

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/*
 * The libraries, grouped by where they sit in the stack. `shipped` means the
 * repository has a published release -- flip it when one goes out.
 */
export const LIBRARIES = [
  { name: 'wickra', layer: 'core', shipped: true },

  { name: 'wickra-exchange', layer: 'data', shipped: true },
  { name: 'wickra-synth', layer: 'data' },
  { name: 'wickra-timemachine', layer: 'data' },
  { name: 'wickra-genome', layer: 'data' },
  { name: 'wickra-feature-store', layer: 'data' },

  { name: 'wickra-backtest', layer: 'research', shipped: true },
  { name: 'wickra-screener', layer: 'research', shipped: true },
  { name: 'wickra-darwin', layer: 'research' },
  { name: 'wickra-gym', layer: 'research' },
  { name: 'wickra-impact', layer: 'research' },

  { name: 'wickra-verify', layer: 'trust' },
  { name: 'wickra-proof', layer: 'trust' },
  { name: 'wickra-zk', layer: 'trust' },
  { name: 'wickra-strategy-ci', layer: 'trust' },
  { name: 'wickra-benchmark', layer: 'trust' },

  { name: 'wickra-terminal', layer: 'surface', shipped: true },
  { name: 'wickra-xray', layer: 'surface' },
  { name: 'wickra-radar', layer: 'surface' },
  { name: 'wickra-copilot', layer: 'surface' },
  { name: 'wickra-shazam', layer: 'surface' },

  { name: 'wickra-compile', layer: 'edge' },
  { name: 'wickra-embed', layer: 'edge' },
  { name: 'wickra-pico', layer: 'edge' },
]

// The four columns to the right of the core, and the layers each one draws from.
const COLUMNS = [
  { label: 'DATA & REPLAY', layers: ['data'] },
  { label: 'RESEARCH', layers: ['research'] },
  { label: 'TRUST', layers: ['trust'] },
  { label: 'SURFACE & EDGE', layers: ['surface', 'edge'] },
]

const defs = `
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0.55" y2="1">
      <stop offset="0" stop-color="#fff1c4"/>
      <stop offset="0.3" stop-color="#f8cf63"/>
      <stop offset="0.62" stop-color="#e3a52f"/>
      <stop offset="1" stop-color="#9c6510"/>
    </linearGradient>
    <linearGradient id="goldFlat" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8cf63"/>
      <stop offset="1" stop-color="#e3a52f"/>
    </linearGradient>
    <radialGradient id="bg" cx="0.24" cy="0.18" r="1.1">
      <stop offset="0" stop-color="#1b2330"/>
      <stop offset="1" stop-color="#06080c"/>
    </radialGradient>
  </defs>`

/** The hexagon mark, at (x, y) and `size` px square. */
const mark = (x, y, size) => `
  <svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="-3 -3 106 106">
    <polygon points="27.5,8 72.5,8 95,50 72.5,92 27.5,92 5,50" fill="#0e1219" stroke="url(#gold)" stroke-width="3.8" stroke-linejoin="round"/>
    <polygon points="33,20 67,20 84,50 67,80 33,80 16,50" fill="none" stroke="url(#gold)" stroke-width="1.1" opacity="0.45"/>
    <rect x="47.7" y="24" width="4.6" height="52" rx="2.3" fill="#f4f0e2"/>
    <rect x="42.5" y="41" width="15" height="23" rx="4.5" fill="url(#gold)"/>
    <rect x="44.5" y="43.5" width="11" height="5" rx="2.5" fill="#ffffff" opacity="0.32"/>
  </svg>`

const wordmark = (x, baseline, size, ls) =>
  `<text x="${x}" y="${baseline}" font-size="${size}" font-weight="700" letter-spacing="${ls}"><tspan fill="#f7f3ea">wick</tspan><tspan fill="url(#gold)">ra</tspan></text>`

const t = (x, y, size, fill, text, opts = {}) => {
  const { ls = 0, anchor = 'start', weight = 400 } = opts
  return `<text x="${Number(x).toFixed(1)}" y="${Number(y).toFixed(1)}" font-size="${size}" fill="${fill}" letter-spacing="${ls}"${
    anchor === 'start' ? '' : ` text-anchor="${anchor}"`
  }${weight === 400 ? '' : ` font-weight="${weight}"`}>${esc(text)}</text>`
}

/*
 * The rising candle field behind the columns. Deterministic: the same seed has
 * to give the same picture, or every render would produce a fresh commit.
 */
function candles({ x0, y0, width, height, count, opacity, seed }) {
  let state = seed
  const rnd = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648)
  const step = width / count
  const bodyW = Math.min(26, step * 0.42)
  const parts = []
  for (let i = 0; i < count; i++) {
    const jitter = rnd() * 0.22 - 0.11
    const mid = y0 + height - (0.18 + (i / (count - 1)) * 0.68 + jitter) * height
    const bodyH = bodyW * (1.4 + rnd() * 1.5)
    const wickH = bodyH * (1.7 + rnd() * 0.7)
    const cx = x0 + step * (i + 0.5)
    parts.push(
      `<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${(mid - bodyH / 2).toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}" rx="5"/>`,
      `<rect x="${(cx - 3).toFixed(1)}" y="${(mid - wickH / 2).toFixed(1)}" width="6" height="${wickH.toFixed(1)}" rx="3"/>`,
    )
  }
  return `<g opacity="${opacity}" fill="#f8cf63">${parts.join('')}</g>`
}

/** Gold disc for a shipped library, hollow ring for one still in progress. */
const statusDot = (x, y, shipped) =>
  shipped
    ? `<circle cx="${x}" cy="${y}" r="4.5" fill="url(#goldFlat)"/>`
    : `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="#55647a" stroke-width="1.7"/>`

/**
 * Renders the banner.
 *
 * @param {number|string} indicatorCount indicators the core exports
 * @returns {string} the complete SVG document
 */
export function buildBannerSvg(indicatorCount) {
  const total = LIBRARIES.length
  const shipped = LIBRARIES.filter((l) => l.shipped).length
  const inProgress = total - shipped

  const coreX = 64
  const coreY = 186
  const coreW = 352
  const coreH = 330

  const colX0 = 452
  const colW = 194
  const colGap = 18
  const busY = 166
  const labelSize = 12
  const labelLs = 2

  // Each connector drops from the middle of its column title. Letter-spacing is
  // added after the last glyph too, so the visual centre of a label sits half a
  // space left of its measured middle.
  const tickXs = COLUMNS.map((col, i) => {
    const x = colX0 + i * (colW + colGap)
    return x + (tw(col.label, labelSize, labelLs) - labelLs) / 2
  })

  const columns = COLUMNS.map((col, i) => {
    const x = colX0 + i * (colW + colGap)
    const rows = LIBRARIES.filter((l) => col.layers.includes(l.layer))
      .map(
        (lib, r) =>
          statusDot(x + 6, 249 + r * 27, lib.shipped) +
          t(
            x + 22,
            254 + r * 27,
            13.5,
            lib.shipped ? '#fbf7ef' : '#aab6c3',
            // The prefix is stated once, under the columns, instead of 23 times.
            lib.name.replace('wickra-', ''),
          ),
      )
      .join('')
    const tick = `<path d="M${tickXs[i].toFixed(1)} ${busY} V ${busY + 16}" fill="none" stroke="#3a4757" stroke-width="1.6"/>`
    return tick + t(x, 214, labelSize, '#93a0ae', col.label, { ls: labelLs }) + rows
  }).join('')

  // Out of the top edge of the core card, then right along the columns.
  const connector = `<path d="M${coreX + coreW / 2 - 40} ${coreY} V ${busY} H ${tickXs[tickXs.length - 1].toFixed(1)}" fill="none" stroke="#3a4757" stroke-width="1.6"/>`

  const body =
    mark(56, 34, 92) +
    wordmark(170, 104, 58, -2.4) +
    `<rect x="174" y="122" width="30" height="5" rx="2.5" fill="#f8cf63"/>` +
    t(216, 132, 18, '#f8fbfe', 'the streaming-first trading stack') +
    t(1224, 110, 19, '#ccd6e0', `${total} libraries · ten languages`, { anchor: 'end' }) +
    connector +
    `<rect x="${coreX}" y="${coreY}" width="${coreW}" height="${coreH}" rx="16" fill="#141922" stroke="url(#goldFlat)" stroke-width="1.8"/>` +
    // Drawn after the card so the series runs across it instead of being
    // clipped by it; the card's own text is drawn after the candles.
    candles({ x0: 20, y0: 252, width: 1240, height: 388, count: 19, opacity: 0.075, seed: 21 }) +
    mark(coreX + 24, coreY + 40, 96) +
    t(coreX + 140, coreY + 78, 30, '#f7f3ea', 'wickra', { weight: 700 }) +
    t(coreX + 140, coreY + 106, 13.5, '#f8cf63', 'the core') +
    t(coreX + 26, coreY + 172, 15, '#e7eef5', `${indicatorCount} streaming indicators`) +
    t(coreX + 26, coreY + 198, 15, '#e7eef5', 'O(1) per tick') +
    // Scoped to the core on purpose: the other libraries depend on it, and on
    // serde and friends.
    t(coreX + 26, coreY + 224, 15, '#e7eef5', 'zero dependencies') +
    t(coreX + 26, coreY + 256, 14, '#bcc9d6', 'Rust · Python · Node.js · WASM') +
    t(coreX + 26, coreY + 282, 14, '#bcc9d6', 'C ABI hub → C, C++, C#, Go, Java, R') +
    columns +
    t(colX0, 502, 13, '#93a0ae', 'all names prefixed wickra-') +
    `<line x1="64" y1="546" x2="1216" y2="546" stroke="#2a3440" stroke-width="2"/>` +
    t(64, 582, 17, '#b3bfcc', 'wickra.org · docs.wickra.org · live.wickra.org') +
    t(1216, 582, 17, '#b3bfcc', `${shipped} shipped · ${inProgress} in progress`, {
      anchor: 'end',
    })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'DejaVu Sans Mono', ui-monospace, monospace">${defs}<rect width="${W}" height="${H}" fill="url(#bg)"/>${body}</svg>`
}
