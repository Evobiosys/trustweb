/**
 * Per-declaration opt-in consent for the central index.
 *
 * Demo-debrief requirement 1 (handover section 0): publishing to the
 * central index is opt-in PER DECLARATION, never per account, never
 * inherited from any account-level or global setting. There is no function
 * in this file that reads a device-wide or account-wide flag -- every
 * lookup here is keyed by `declarationId`, and a declaration with no
 * recorded consent reads as not-consented, full stop.
 *
 * Kept as a standalone, in-memory module rather than reaching into
 * `../db.ts`'s IndexedDB store: this unit ships the adapter as a library
 * with tests, not wired into the app (see the handover's U4 note --
 * "nothing self-mounts"). Persisting consent records is the follow-up
 * wiring step, same as mounting the panel into the demo UI.
 */

export interface ConsentRecord {
  declarationId: string
  /** Whether the holder opted this declaration in. Default, for any
   *  declaration with no record at all, is `false` -- see `isConsented`. */
  consented: boolean
  /**
   * D27/F-07 single-author acknowledgement (see
   * `@resource-web/wot-policy`'s `requiresSoleAuthorAck`). Recorded per
   * declaration, alongside `consented`, because it is a separate explicit
   * choice the holder makes for THIS declaration -- not implied by
   * `consented` alone, and never inherited from any other declaration.
   */
  soleAuthorAck: boolean
  recordedAt: number
}

const consents = new Map<string, ConsentRecord>()

/**
 * Record (or overwrite) the consent decision for one declaration.
 * `soleAuthorAck` defaults to `false`: a caller must explicitly pass `true`,
 * it is never assumed from `consented` alone.
 */
export function recordConsent(
  declarationId: string,
  consented: boolean,
  soleAuthorAck = false,
): ConsentRecord {
  const record: ConsentRecord = { declarationId, consented, soleAuthorAck, recordedAt: Date.now() }
  consents.set(declarationId, record)
  return record
}

/** The raw record for one declaration, or `undefined` if none was ever recorded. */
export function readConsent(declarationId: string): ConsentRecord | undefined {
  return consents.get(declarationId)
}

/**
 * Whether one declaration is currently opted in. Default is NOT-consented:
 * a declaration with no recorded consent -- new, withdrawn, or never
 * touched -- reads `false` here, never `true`.
 */
export function isConsented(declarationId: string): boolean {
  return consents.get(declarationId)?.consented === true
}

/** Drop the consent record for one declaration (e.g. after withdrawal). */
export function clearConsent(declarationId: string): void {
  consents.delete(declarationId)
}

/** Wipe every recorded consent. Part of `clearAll()`'s local-state wipe
 *  (demo-debrief requirement 4, handover section 0), mirroring `state.ts`'s
 *  existing `resetAll()` for this module's own slice of state. */
export function clearAllConsents(): void {
  consents.clear()
}
