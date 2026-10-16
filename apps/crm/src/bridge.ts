/** What the app hosting the Curator as one of its tabs lends it (apps/trustweb); empty when the Curator runs on its own. */
import type { AppState, NoteLine, Person } from '../../trustweb/src/model'

export interface Host {
  /** A copy of the host's live record (the Curator edits its copy: merges, hidden people). */
  record(): AppState | null
  /** The one ring store: a ring set in the Curator is written to the host's record (key trustweb.v1.me), so the Web view moves at once. */
  setRing(personId: string, ring: string): void
  /** Same for the family tag (purple accent on the Web view). */
  setFamily(personId: string, on: boolean): void
  /** Sets a TrustWeb-only checkbox field (tw-non-responsive) in the host's record, so its dots and asks follow at once. */
  setFlag(personId: string, key: string, on: boolean): void
  /** A person hidden in the Curator leaves the host's record too (and comes back with `restorePerson`), so the Web view drops them at once. */
  removePerson(personId: string): void
  restorePerson(person: Person): void
  /** Settings "Hide people known only from …": the hidden sources (sources.ts) go to the host's record, so the Web view drops them at once. */
  setHiddenSources(kinds: readonly string[]): void
  /** A bullet written in the vault (notes_sync.svelte.ts) becomes a line in the host's record, local provenance. */
  addLine(personId: string, line: NoteLine): void
  /** The element the Curator lives in (its theme switch goes there). */
  root: HTMLElement
}

export const host: Partial<Host> = {}
