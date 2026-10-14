/**
 * The Web Curator tab (apps/crm, Svelte 5). Its code is a lazy chunk: nothing of it loads until the tab is first opened.
 * The element lives as long as the page, so the Curator keeps its place (open person, scroll) between visits.
 * It reads a copy of this app's record on every visit; rings and the family tag are this record's (one store): set there, set here.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState, Person, Ring } from './model'
import { S } from './strings'

export interface Curator {
  el: HTMLElement
  open(): void
  /** One person's Curator page, in a new element for the person sheet (same component and CSS as the tab). */
  person(personId: string, onclose: () => void): HTMLElement
  /** Hide in trustweb (Tana checkbox through the Curator's sync, removed from this record) and its Undo. */
  hide(personId: string): Promise<void>
  unhide(personId: string): Promise<void>
}

export function createCurator(opts: { record(): AppState | null; setRing(personId: string, ring: Ring): void; setFamily(personId: string, on: boolean): void; removePerson(personId: string): void; restorePerson(person: Person): void }): Curator {
  const root = el('div', { class: 'curator', 'data-view': 'curator' }, [S.curatorLoading])
  let mounted = false
  const lent = { record: opts.record, setRing: (id: string, ring: string): void => opts.setRing(id, ring as Ring), setFamily: opts.setFamily, removePerson: opts.removePerson, restorePerson: opts.restorePerson }
  return {
    el: root,
    open() {
      void import('@web-curator').then(async (m) => {
        if (mounted) { await m.refreshCurator(); return }
        mounted = true
        root.replaceChildren()
        await m.mountCurator(root, lent)
      })
    },
    person(personId, onclose) {
      const page = el('div', { class: 'curator-person' }, [S.curatorLoading])
      void import('@web-curator').then(async (m) => { page.replaceChildren(); await m.mountCuratorPerson(page, lent, personId, onclose) })
      return page
    },
    hide: async (personId) => { await (await import('@web-curator')).hideFromRings(lent, personId) },
    unhide: async (personId) => { await (await import('@web-curator')).unhideFromRings(lent, personId) },
  }
}
