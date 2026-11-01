// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The ask sheet's example question with the owner's city (wave 25): AppState.city, absent = Vienna. */
export const DEFAULT_CITY = 'Vienna'
export const CITY_MAX = 40

export const askCity = (city: string | undefined): string => city?.trim().slice(0, CITY_MAX) || DEFAULT_CITY

export const spareRoomExample = (city: string | undefined): string => `Who has a spare room in ${askCity(city)}?`
