// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { recordGlyph } from './icons/ask_web'

/** Which Record tab glyph: 'pulse' (default again, Jakob 2026-11-01: person-with-waves "should not be the icon"; plain mic), 'person-waves' (wave 28, stays selectable) or the wave-26 person with a microphone 'solo-mic'. */
export const RECORD_TAB_GLYPH: 'pulse' | 'person-waves' | 'solo-mic' = 'pulse'

export function recordTabGlyph(mode: 'person-waves' | 'pulse' | 'solo-mic', s: { live: boolean; solo: boolean; onRecord: boolean }): { glyph: 'mic' | 'solo' | 'waves'; pulse: boolean } {
  if (mode === 'person-waves') return { glyph: s.solo ? 'waves' : 'mic', pulse: !s.live && s.solo && s.onRecord }
  if (mode === 'solo-mic') return { glyph: recordGlyph(s.live, s.solo), pulse: false }
  return { glyph: 'mic', pulse: !s.live && s.solo && s.onRecord }
}
