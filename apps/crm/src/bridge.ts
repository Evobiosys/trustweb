/** What the app hosting the Curator as one of its tabs lends it (apps/trustweb); empty when the Curator runs on its own. */
import type { AppState } from '../../trustweb/src/model'

export interface Host {
  /** A copy of the host's live record (the Curator edits its copy: merges, hidden people). */
  record(): AppState | null
  /** The one ring store: a ring set in the Curator is written to the host's record (key trustweb.v1.me), so the Web view moves at once. */
  setRing(personId: string, ring: string): void
  /** Same for the family tag (purple accent on the Web view). */
  setFamily(personId: string, on: boolean): void
  /** The element the Curator lives in (its theme switch goes there). */
  root: HTMLElement
}

export const host: Partial<Host> = {}
