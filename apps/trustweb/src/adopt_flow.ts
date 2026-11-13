// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 B17: taking another device's state in two steps. "Preview" shows the read-only difference (device_adopt.ts previewChanges); only
 * "Adopt" archives the current state (30 days) and replaces it. `adoptStep` refuses Adopt before the preview, and `mayArchive` is true only
 * while adopting, so nothing is archived or replaced earlier. Pure, DOM-free.
 */
export type AdoptPhase = 'idle' | 'previewed' | 'adopting' | 'adopted' | 'failed' | 'declined'
export type AdoptEvent = 'preview' | 'adopt' | 'done' | 'fail' | 'decline'

export const adoptIdle: AdoptPhase = 'idle'

export function adoptStep(s: AdoptPhase, e: AdoptEvent): AdoptPhase {
  switch (e) {
    case 'preview': return s === 'idle' || s === 'previewed' || s === 'failed' ? 'previewed' : s
    case 'adopt': return s === 'previewed' ? 'adopting' : s
    case 'done': return s === 'adopting' ? 'adopted' : s
    case 'fail': return s === 'adopting' ? 'failed' : s
    case 'decline': return s === 'idle' || s === 'previewed' || s === 'failed' ? 'declined' : s
  }
}

/** The only phase in which the current state may be archived and replaced. */
export const mayArchive = (s: AdoptPhase): boolean => s === 'adopting'
