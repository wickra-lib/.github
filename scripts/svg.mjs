/*
 * Small SVG helpers shared by the badge snapshotters.
 */

// shields renders the for-the-badge style with square corners and offers no
// option to change it. These badges are snapshotted rather than hot-linked, so
// the corners are rounded on the way in: clip the whole badge to a rounded rect
// of its own size. Every README points at the same files, so one pass here
// rounds them everywhere.
export function roundCorners(svg, radius = 6) {
  const open = svg.match(/<svg[^>]*>/)
  if (!open) return svg
  const width = open[0].match(/width="([\d.]+)"/)
  const height = open[0].match(/height="([\d.]+)"/)
  if (!width || !height) return svg
  if (svg.includes('id="wkr-round"')) return svg
  const head = open[0]
  const body = svg.slice(open.index + head.length).replace(/<\/svg>\s*$/, '')
  const clip = `<clipPath id="wkr-round"><rect width="${width[1]}" height="${height[1]}" rx="${radius}"/></clipPath>`
  return `${head}${clip}<g clip-path="url(#wkr-round)">${body}</g></svg>`
}
