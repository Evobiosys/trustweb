/**
 * The Web Curator tab (apps/crm, Svelte 5). Its code is a lazy chunk: nothing of it loads until the tab is first opened.
 * The element lives as long as the page, so the Curator keeps its place (open person, scroll) between visits.
 * It reads a copy of this app's record on every visit, and a ring set there is set here too.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState, Ring } from './model'
import { S } from './strings'

export interface Curator {
  el: HTMLElement
  open(): void
}

export function createCurator(opts: { record(): AppState | null; setRing(personId: string, ring: Ring): void }): Curator {
  const root = el('div', { class: 'curator', 'data-view': 'curator' }, [S.curatorLoading])
  let mounted = false
  const lent = { record: opts.record, setRing: (id: string, ring: string): void => opts.setRing(id, ring as Ring) }
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
  }
}
