// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 25 (Jakob 2026-10-29): list, curator, QR and card tools open as a NEW PAGE with a Back control, never as a sheet over the web.
 * Each page is one history entry, so the browser's and the phone's Back close the top page. DOM only.
 */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'

export interface Pages {
  /** Opens a page above everything in `layer`; `mark` is its data-page attribute (preview panel selector). */
  open(title: string, body: Node[], mark: string): void
  /** Closes every page at once (the sheet below was closed or replaced). */
  closeAll(): void
}

export function createPages(layer: HTMLElement): Pages {
  const stack: HTMLElement[] = []
  const drop = (keep: number): void => { while (stack.length > keep) stack.pop()?.remove() }
  window.addEventListener('popstate', (e) => drop((e.state as { twPage?: number } | null)?.twPage ?? 0))
  return {
    open(title, body, mark) {
      history.pushState({ twPage: stack.length + 1 }, '')
      const page = el('div', { class: 'page-layer', role: 'region', 'aria-label': title, 'data-page': mark }, [
        el('div', { class: 'page-bar' }, [
          el('button', { class: 'btn btn-ghost btn-sm', 'data-page-back': '', onclick: () => history.back() }, ['← ' + S.back]),
          el('h2', {}, [title]),
        ]),
        ...body,
      ])
      stack.push(page)
      layer.append(page)
    },
    closeAll() {
      const n = stack.length
      if (n) { drop(0); history.go(-n) }
    },
  }
}
