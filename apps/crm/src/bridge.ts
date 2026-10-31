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
  /** Leave the Curator and show TrustWeb's rings web ("Trust membranes"). Absent standalone. */
  showRings?(): void
  /** The Curator's current face, so the host can give the Desk the whole window. Absent standalone. */
  viewChanged?(view: 'desk' | 'classic'): void
  /** The host's rings web, built for the Desk's Web page: one live instance (the host's rings keep their geometry in module state), no zoom of its own. Absent standalone. */
  renderRings?(o: { onPick(personId: string): void; onRing?(personId: string, ring: string): void; compact?: boolean }): HTMLElement
  /** The host's profile editor (wave 19), the same element its phone sheet shows; the Desk's profile page slots it in. Absent standalone. */
  renderProfile?(): HTMLElement
  /** The owner's profile picture as an image URL (wave 19), undefined when none is set; the host fires `tw:picture-changed` on window when it changes. Absent standalone. */
  myPicture?(): string | undefined
  /** Close the Desk back to the phone (what the sheet's "× Home" does). Absent standalone. */
  closeDesk?(): void
  /** The host's "Show phone version": this device keeps the phone face from now on. Absent standalone. */
  showPhoneVersion?(): void
  /** Settings "Hide people known only from …": the hidden sources (sources.ts) go to the host's record, so the Web view drops them at once. */
  setHiddenSources(kinds: readonly string[]): void
  /** A bullet written in the vault (notes_sync.svelte.ts) becomes a line in the host's record, local provenance. */
  addLine(personId: string, line: NoteLine): void
  /** My bare TrustWeb connect link (A12), for the person page's Connect panel. Absent standalone. */
  connectLink?(): Promise<string>
  /** A person's messenger links (Person.links) typed on the Curator's person page go to the host's record. Absent standalone. */
  setLinks?(personId: string, links: Person['links']): void
  /** The element the Curator lives in (its theme switch goes there). */
  root: HTMLElement
}

export const host: Partial<Host> = {}
