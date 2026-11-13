// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 B11: the text line of a curation row; the zone is named once, by the dropdown beside it, so the line never repeats it. */
export const metaLead = (history: boolean, score: string): string => (history ? `${score} · ` : '')
