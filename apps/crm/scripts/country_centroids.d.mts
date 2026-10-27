// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
export function centroidsOf(fc: { features: { properties: { NAME: string }; geometry: { type: string; coordinates: unknown } }[] }): Record<string, [number, number]>
