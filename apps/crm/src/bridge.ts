/** What the app hosting the Curator as one of its tabs lends it (apps/trustweb); empty when the Curator runs on its own. */
import type { AppState } from '../../trustweb/src/model'

export interface Host {
  /** A copy of the host's live record (the Curator edits its copy: merges, hidden people). */
  record(): AppState | null
  /** A ring set in the Curator also lands in the host's record, so the Web view moves at once. */
  setRing(personId: string, ring: string): void
  /** The element the Curator lives in (its theme switch goes there). */
  root: HTMLElement
}

export const host: Partial<Host> = {}
