// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 demo-content-overlay (Jakob 2026-11-19): the desktop "Show demo content" chip floats above the content with an X above it.
 * The X is remembered on this device (localStorage, never synced) for the record it was pressed on: the stored value is the record's
 * `me.id`, so a different record (new identity, another dev record) shows the chip again.
 */
import type { AppState } from './model'

export const DEMO_OVERLAY_KEY = 'trustweb.ui.demo-overlay-dismissed'

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** True when the X was pressed on this device for this very record. Blocked storage: not dismissed. */
export function demoOverlayDismissed(store: Store, s: Pick<AppState, 'me'>): boolean {
  try { return store.getItem(DEMO_OVERLAY_KEY) === s.me.id } catch { return false }
}

/** Remembers the X for this record. Blocked storage: the chip stays until the page reloads. */
export function dismissDemoOverlay(store: Store, s: Pick<AppState, 'me'>): void {
  try { store.setItem(DEMO_OVERLAY_KEY, s.me.id) } catch { /* not remembered */ }
}

/* wave46 answers-45b */
/** Settings "Show the demo-content button again": undoes the X on this device. */
export function restoreDemoOverlay(store: Pick<Storage, 'removeItem'>): void {
  try { store.removeItem(DEMO_OVERLAY_KEY) } catch { /* stays dismissed */ }
}
