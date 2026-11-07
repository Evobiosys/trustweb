// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// WCAG 2.x contrast ratio over hex / rgba colours.
function parse(c) {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c)
  if (rgba) return { rgb: [+rgba[1], +rgba[2], +rgba[3]], a: rgba[4] === undefined ? 1 : +rgba[4] }
  let h = c.replace('#', '')
  if (h.length === 3) h = [...h].map((x) => x + x).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`contrast: unsupported colour ${c}`)
  return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), a: 1 }
}
function flatten(c, under) {
  const { rgb, a } = parse(c)
  if (a === 1) return rgb
  const back = parse(under).rgb
  return rgb.map((v, i) => v * a + back[i] * (1 - a))
}
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(fg, bg, { under = '#FFFFFF' } = {}) {
  const base = flatten(bg, under)
  const l1 = luminance(flatten(fg, rgbHex(base)))
  const l2 = luminance(base)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
function rgbHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}
