// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 ops-fix-in-pi: what the panel's "Fix it in a pi session" button shows (Jakob: "nothing happens when I press it"). Pure; dev_preview.ts draws it. */
import { S } from './strings'

/** The launcher route waits up to 120 s for pi_new_session.sh (vite.config.mjs); the panel waits a little longer, so a slow start is never a false timeout. */
export const FIX_TIMEOUT_MS = 150000

/** The press as it goes: starting at once (optimistic), then the launched window, or the launcher's error. */
export type FixState = { state: 'starting' } | { state: 'launched'; id: string } | { state: 'failed'; error: string }

export function fixButtonView(s: FixState | undefined): { label: string; disabled: boolean; line: string; bad: boolean } {
  if (s?.state === 'starting') return { label: S.w44fold.fixStarting, disabled: true, line: '', bad: false }
  if (s?.state === 'launched') return { label: S.panelFixSession, disabled: true, line: S.panelFixLaunched(s.id), bad: false }
  if (s?.state === 'failed') return { label: S.panelFixSession, disabled: false, line: s.error, bad: true }
  return { label: S.panelFixSession, disabled: false, line: '', bad: false }
}

/** The line the fix session writes into the registry when done (brief step 7: `preview_lib.mjs patch <id> {"fixStatus":…}`); '' when there is none. */
export function fixStatusLine(p: { fixStatus?: { key?: string; text?: string; at?: string } | null }): string {
  const f = p.fixStatus
  if (!f?.key || !f.text) return ''
  const at = f.at ? new Date(f.at) : null
  return S.w44fold.fixStatus(f.key, f.text, at && !isNaN(at.getTime()) ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '')
}
