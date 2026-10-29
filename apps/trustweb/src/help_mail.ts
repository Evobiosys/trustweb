// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
const HELP_ADDRESS = 'connect@trustweb.one'
const HELP_SUBJECT = 'TrustWeb help'

/** The "Write to us" link, used by the app and the Desk: address and subject only, nothing from the record (I1). */
export const HELP_MAIL = `mailto:${HELP_ADDRESS}?subject=${encodeURIComponent(HELP_SUBJECT)}`
