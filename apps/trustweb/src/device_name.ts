// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The name of this device as the owner gave it (sync_view.ts sets the source at start). '' = unknown; then no source records a device. Never a did or secret. */
let source: () => string = () => ''

export const setDeviceNameSource = (fn: () => string): void => { source = fn }
export const thisDevice = (): string => source()
