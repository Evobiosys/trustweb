// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// The record's schema version and the one ordered chain of its stored-data repairs (wave 21).
import type { AppState } from './model'
import { repairAgreements } from './agreements'
import { migrateChats } from './chat'
import { repairConnectRecord } from './connect_code'
import { repairGeneralNotes } from './general_notes'
import { normaliseNoteFields } from './note_fields'
import { repairProfile } from './profile'
import { repairPinned } from './membranes_five'
import { migrateSources } from './provenance'
import { repairShareFields } from './share_modes'
import { repairOtherCodes } from './sync_code'

/** 1 = every record from before this field existed. Raise it when a change older builds could misread is made. */
export const SCHEMA_VERSION = 2

/** A record or bundle written by a newer build: this one must not read it half (a downgrade never loses fields). */
export class SchemaNewerError extends Error {
  constructor(readonly found: number, readonly reads: number = SCHEMA_VERSION) {
    super(`Schema version ${found} is newer than this build reads (${reads})`)
  }
}

/** Throws SchemaNewerError for a version above this build's; anything else passes. */
export function assertReadable(version: unknown): void {
  if (typeof version === 'number' && version > SCHEMA_VERSION) throw new SchemaNewerError(version)
}

/** Runs the per-store repairs in order, then stamps the version. Idempotent; true when the record changed. */
export function migrate(s: AppState): boolean {
  assertReadable(s.schemaVersion)
  const ran = [
    migrateSources(s), normaliseNoteFields(s), migrateChats(s),
    repairConnectRecord(s), repairOtherCodes(s), repairShareFields(s), repairGeneralNotes(s), repairProfile(s), repairAgreements(s), repairPinned(s),
  ]
  const stamped = s.schemaVersion !== SCHEMA_VERSION
  s.schemaVersion = SCHEMA_VERSION
  return stamped || ran.some(Boolean)
}
