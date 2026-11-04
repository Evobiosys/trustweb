// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30: archiving a person files them under Ring.None (every view leaves them out, trustzones.isArchived) and remembers the ring they had; Settings lists them with Restore. */
import { Ring } from './model'
import type { Person } from './model'
import { isArchived } from './trustzones'

export function archivePerson(p: Pick<Person, 'ring' | 'prevRing'>): void {
  if (isArchived(p)) return
  p.prevRing = p.ring
  p.ring = Ring.None
}

/** Back on the ring they had; without a remembered ring: Not yet sorted. */
export function restorePerson(p: Pick<Person, 'ring' | 'prevRing'>): void {
  p.ring = p.prevRing && p.prevRing !== Ring.None ? p.prevRing : Ring.Unsorted
  delete p.prevRing
}

export const archivedPeople = <P extends Pick<Person, 'ring'>>(people: readonly P[]): P[] => people.filter(isArchived)
