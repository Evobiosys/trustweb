// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32: how the "TrustWeb" skin draws a person in the Network: the Web rings' dot (web_view.ts, styles.css .ava) on the canvas. Pure, no DOM. */
import type { Ring } from './model'
import { ringColor } from './ring_palette'
import { TONE_ORDER, toneIndex } from './trustzones'

/** Rings dot: 42 px across (rings_layout FULL_DOT), the `you` dot 40 px. */
const DOT_RADIUS = 21
const YOU_RADIUS = 20
/** Initials in white; dark on the two palest rungs (styles.css .rings-wrap .node[data-tone="3"|"4"]). */
const DARK_INK = '#3a1d00'
const DARK_TONES = [3, 4]

export interface DotLook { fill: string | null; ink: string; initial: string; radius: number; you: boolean }

/** `tier` absent = the centre (me): gradient face, white halo, no ring colour (`fill` null). */
export function dotLook(name: string, tier: Ring | 'outside' | undefined): DotLook {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  if (tier === undefined) return { fill: null, ink: '#fff', initial, radius: YOU_RADIUS, you: true }
  const idx = tier === 'outside' ? TONE_ORDER.length - 1 : toneIndex(tier)
  return { fill: ringColor(tier), ink: DARK_TONES.includes(idx) ? DARK_INK : '#fff', initial, radius: DOT_RADIUS, you: false }
}
