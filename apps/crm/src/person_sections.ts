// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 25: the order of a person's notes: newest on top.
export const newestFirst = <T extends { notedAt: number }>(lines: readonly T[]): T[] => [...lines].sort((a, b) => b.notedAt - a.notedAt)
