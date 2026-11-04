// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Touch: the pencil and archive tools show on the one row last tapped (mouse uses CSS :hover on that row).
export function toolsRowAfterTap(open: string | null, tapped: string | null): string | null {
  return tapped === null || tapped === open ? null : tapped
}
