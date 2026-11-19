// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 event-back-button: where the in-app Back of a scoped page goes: the screen it was reached from, else the fallback (never the page itself). */
export function backScreen<T>(from: T | null, here: T, fallback: T): T { return from !== null && from !== here ? from : fallback }
