// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b notify-center (A1, A3): the bell in the header of Web and Chat, and the notifications PAGE it opens (never an overlay) with four sections:
 * New messages, People who want to connect, Connected (with "Send a message") and Events. The count on the bell is the unread items; a long press (or right
 * click, P1) marks all read. The lists come from notify_center.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { contextPress } from './context_press'
import { ICONS } from './icons'
import type { AppState } from './model'
import { ageLabel } from './model'
import { SECTIONS, centerItems, dismissNotification, markAllRead, unreadCount, type CenterItem } from './notify_center'
import { S } from './strings'

export interface CenterHooks {
  state: () => AppState
  save: () => void
  /** Opens a page above the screen (main.ts pages). */
  page: (title: string, body: Node[], mark: string) => void
  openChat: (personId: string) => void
  /** The Add sheet of a "wants to connect" row (main.ts addWantSheet). */
  addWant: (peerId: string, name: string) => void
  openCard: (personId: string) => void
  openEvents: () => void
  toast: (msg: string) => void
  /** The screen draws again (the bell's count changed). */
  changed: () => void
}

/** The screens that carry the bell. */
export const hasBell = (screen: string): boolean => screen === 'web' || screen === 'chat'

export function createNotifyCenter(h: CenterHooks): { bell: () => HTMLElement; open: () => void } {
  const now = (): number => Date.now()

  function rowOf(i: CenterItem): HTMLElement {
    const go: Record<CenterItem['action'], () => void> = {
      'open-chat': () => i.personId && h.openChat(i.personId),
      add: () => i.peerId && h.addWant(i.peerId, i.title),
      'open-card': () => i.personId && h.openCard(i.personId),
      message: () => i.personId && h.openChat(i.personId),
      'open-event': h.openEvents,
    }
    /** Wave 44: acting on the row dismisses it (stored, bell redrawn) and opens what it points at. */
    const run = (): void => {
      dismissNotification(h.state(), i.id, now()); h.save()
      const sec = row.closest('[data-notify-section]')
      row.remove()
      if (sec && !sec.querySelector('[data-notify-item]')) sec.append(el('p', { class: 'meta' }, [S.w43b.sectionEmpty]))
      h.changed(); go[i.action]()
    }
    const label = i.action === 'message' ? S.w43b.sendMessage : i.action === 'add' ? S.w43b.add : i.action === 'open-chat' ? S.w43b.openChat : S.w43b.openCard
    const row = el('div', { class: 'prow notify-row' + (i.read ? '' : ' unread'), 'data-notify-item': i.id }, [
      el('div', { class: 'who' }, [el('b', {}, [i.title]), i.body ? el('i', {}, [i.body]) : null]),
      el('span', { class: 'when' }, [ageLabel(i.at, now())]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-notify-action': i.action, onclick: run }, [label]),
    ])
    return row
  }

  function open(): void {
    const items = centerItems(h.state(), now())
    const body = SECTIONS.map((sec) => {
      const of = items.filter((i) => i.section === sec)
      return el('section', { class: 'notify-section', 'data-notify-section': sec }, [
        el('h3', {}, [S.w43b.sections[sec]]),
        ...(of.length ? of.map(rowOf) : [el('p', { class: 'meta' }, [S.w43b.sectionEmpty])]),
      ])
    })
    h.page(S.w43b.centerTitle, [el('div', { class: 'scroll notify-center' }, body)], 'notify-center')
  }

  function markRead(): void {
    markAllRead(h.state(), now())
    h.save()
    h.toast(S.w43b.markedRead)
    h.changed()
  }

  function bell(): HTMLElement {
    const n = unreadCount(h.state(), now())
    const b = el('button', { class: 'hdr-btn icon-only notify-bell', 'data-notify-bell': String(n), 'aria-label': S.w43b.bellAria(n), title: S.w43b.centerTitle, onclick: open })
    b.innerHTML = ICONS.bell
    if (n > 0) b.append(el('span', { class: 'notify-count', 'aria-hidden': 'true' }, [n > 99 ? '99+' : String(n)]))
    contextPress(b, markRead)
    return b
  }

  return { bell, open }
}
