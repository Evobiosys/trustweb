// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39: where the Web's Tools and Filters open: an overlay sheet on a phone, inline (left of the rings) otherwise. Pure. */
export const SHEET_MAX_PX = 600

export const panelMode = (width: number): 'sheet' | 'inline' => (width <= SHEET_MAX_PX ? 'sheet' : 'inline')
