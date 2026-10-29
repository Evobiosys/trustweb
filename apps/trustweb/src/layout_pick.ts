// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25 (Jakob 2026-10-29): TrustWeb = the responsive layout, default everywhere; TrustWeb mobile = the phone frame, default on a phone. Stored on the device only, never synced. */
export const LAYOUT_KEY = 'trustweb.ui.layout'
export type Layout = 'trustweb' | 'mobile'

export const isPhone = (coarse: boolean, width: number): boolean => coarse && width < 700

export function pickLayout(stored: string | null, phone: boolean): Layout {
  return stored === 'trustweb' || stored === 'mobile' ? stored : phone ? 'mobile' : 'trustweb'
}
