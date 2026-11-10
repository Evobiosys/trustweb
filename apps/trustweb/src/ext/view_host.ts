// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39: where a module's view lives while it is shown. The app redraws its screen often; the view is mounted once into one kept
 * element (so its own state survives a redraw; the host leaves that element in place, see main.ts render) and unmounted when the
 * screen leaves it or another view takes its place.
 */
import type { TwCtx, TwView } from './tw_registry'

export function createViewHost(ctx: () => TwCtx) {
  let cur: { id: string; el: HTMLElement; off: () => void } | null = null
  const release = (): void => {
    if (!cur) return
    const c = cur
    cur = null
    try { c.off() } catch (e) { console.error(`view ${c.id}: unmount failed`, e) }
  }
  return {
    show(view: TwView): HTMLElement {
      if (cur?.id === view.id) return cur.el
      release()
      const el = document.createElement('div')
      el.className = 'scroll mod-view'
      el.dataset.modView = view.id
      cur = { id: view.id, el, off: view.mount(el, ctx()) }
      return el
    },
    release,
  }
}
