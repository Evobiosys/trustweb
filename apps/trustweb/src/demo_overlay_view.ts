// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 answers-45b (review-45 Q1, Jakob 2026-11-22): the X of the demo overlay stays for good; Settings > General offers the undo
 * "Show the demo-content button again", only while the X is in force on this device (demo_overlay.ts).
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { demoOverlayDismissed, restoreDemoOverlay } from './demo_overlay'
import { S } from './strings'

/** The undo row, or nothing when the chip is not dismissed. `after` redraws the overlay and Settings. */
export function demoOverlayRows(s: AppState, after: () => void): HTMLElement[] {
  if (!demoOverlayDismissed(localStorage, s)) return []
  return [el('button', { class: 'conn-row', 'data-demo-overlay-again': '', onclick: () => { restoreDemoOverlay(localStorage); after() } }, [
    el('b', {}, [S.w46b.demoAgain]), el('em', {}, [S.w46b.demoAgainHint]),
  ])]
}
