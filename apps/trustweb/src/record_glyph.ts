// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { recordGlyph } from './icons/ask_web'

/** Which Record tab glyph: 'pulse' (default, Jakob 2026-10-31) or the wave-26 person with a microphone 'solo-mic'. */
export const RECORD_TAB_GLYPH: 'pulse' | 'solo-mic' = 'pulse'

export function recordTabGlyph(mode: 'pulse' | 'solo-mic', s: { live: boolean; solo: boolean; onRecord: boolean }): { glyph: 'mic' | 'solo'; pulse: boolean } {
  if (mode === 'solo-mic') return { glyph: recordGlyph(s.live, s.solo), pulse: false }
  return { glyph: 'mic', pulse: !s.live && s.solo && s.onRecord }
}
