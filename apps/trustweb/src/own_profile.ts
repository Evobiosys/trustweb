// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b: the own profile page: which profile sections each trust zone sees. Pure, DOM-free; the check is the one the preview and the sends use. */
import { SECTION_KEYS, sectionOpen } from './profile'
import type { MyProfile, SectionKey, Zone } from './profile'
import type { Basis } from './share_page'
import { VIEWER_ZONES } from './scope_summary'

export function sectionsByZone(p: MyProfile | undefined, basis: Basis, now: Date): Record<Zone, SectionKey[]> {
  return Object.fromEntries(VIEWER_ZONES.map((zone) => [zone, SECTION_KEYS.filter((k) => sectionOpen(p, k, { kind: 'zone', zone }, basis, now))])) as Record<Zone, SectionKey[]>
}
