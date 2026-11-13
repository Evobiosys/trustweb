// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 push-popup: the popup for notifications the person did not see. One modal over every page, listing the unseen inbox
 * items newest first; only its X closes it (no tap outside, no Escape, no timer) and that marks all listed items seen. Opening one
 * item marks only that one and goes to its screen. Rows are text first: the X sits in the panel's top padding, never over a row.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { inboxAll, inboxReplace, markSeen, popupRows, reconcileInbox, type InboxItem, type PopupRow } from './notify_inbox'
import type { NotifyHome } from './notify_route'
import { S } from './strings'

export interface MissedHooks {
  state: () => AppState | null
  save: () => void
  /** Go to the screen that owns the item (main.ts HOME_SCREEN). */
  open: (home: NotifyHome) => void
}

/** The clock time or day of an item, short. */
const when = (at: number): string => new Date(at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })

export function createMissedPopup(h: MissedHooks): { check: () => Promise<void> } {
  let box: HTMLElement | null = null

  /** Store and the record's mirror (what MCP reads and writes) become one list; both hold it afterwards. */
  async function sync(): Promise<InboxItem[]> {
    const s = h.state()
    const merged = reconcileInbox(await inboxAll(), s?.notifInbox ?? [])
    if (s && JSON.stringify(s.notifInbox ?? []) !== JSON.stringify(merged)) { s.notifInbox = merged; h.save() }
    await inboxReplace(merged)
    return merged
  }

  async function mark(ids: string[]): Promise<void> {
    const s = h.state()
    const next = markSeen(await sync(), ids, Date.now())
    if (s) { s.notifInbox = next; h.save() }
    await inboxReplace(next)
  }

  function close(ids: string[]): void {
    box?.remove()
    box = null
    void mark(ids)
  }

  function rowEl(r: PopupRow, ids: string[]): HTMLElement {
    return el('li', { 'data-missed-row': r.id }, [
      el('button', { class: 'missed-open', type: 'button', onclick: () => { box?.remove(); box = null; void mark([r.id]); h.open(r.home); void ids } }, [
        el('b', {}, [r.body]),
        el('small', {}, [when(r.at)]),
      ]),
    ])
  }

  function show(rows: PopupRow[]): void {
    const ids = rows.map((r) => r.id)
    box = el('div', { class: 'wt-modal missed-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'missed-title', 'data-missed-popup': '' }, [
      el('div', { class: 'wt-panel missed-panel' }, [
        el('button', { class: 'missed-x', type: 'button', 'aria-label': S.missedClose, 'data-missed-close': '', onclick: () => close(ids) }, ['×']),
        el('h3', { id: 'missed-title' }, [S.missedTitle]),
        el('ul', { class: 'missed-list' }, rows.map((r) => rowEl(r, ids))),
      ]),
    ])
    document.body.appendChild(box)
  }

  return {
    async check() {
      if (box) return
      const s = h.state()
      if (!s) return
      const rows = popupRows(await sync(), s.missedPopupOff === true)
      if (rows.length && !box) show(rows)
    },
  }
}
