// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b: the one colour per ring, for both views. TrustZones reads it as the `--ring-N` tokens in styles.css (a test keeps the two equal); the Network canvas draws with it. */
import { Ring } from './model'
import { TONE_ORDER, toneIndex } from './trustzones'

/** Five oranges, strongest inside, the outermost grey; same order as TONE_ORDER. */
export const RING_HEX: readonly string[] = ['#A63A00', '#D2570A', '#EE7A1C', '#F6A24F', '#FAC98F', '#9E9E9E']

/** "outside" (not in my web, Network only) is drawn grey like the outermost rung. */
export const ringColor = (ring: Ring | 'outside'): string => RING_HEX[ring === 'outside' ? TONE_ORDER.length - 1 : toneIndex(ring)]
