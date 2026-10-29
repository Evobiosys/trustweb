// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: a collapsible section remembers open/closed per section on this device. Absent = the section's own default. */
export const foldKey = (section: string): string => `trustweb.ui.fold.${section}`
export const foldOpen = (raw: string | null, defaultOpen: boolean): boolean => (raw === null ? defaultOpen : raw === '1')
export const foldStored = (open: boolean): string => (open ? '1' : '0')
