// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b event-qr-join (A2): the person page lists the asks from that person nobody has decided yet; each can be answered late. DOM only; the rule is event_join.ts pastAsksOf. */
import { el } from '../../demo/src/ui/dom'
import { pastAsksOf } from './event_join'
import type { AppState, Person } from './model'
import { S } from './strings'

const DAY_MS = 86_400_000

export interface PastAsksDeps {
  state: () => AppState
  /** Shows the ask's prompt again (net.presentHeld). */
  answer: (qid: string) => void
}

export function pastAsksRow(d: PastAsksDeps, p: Person, now: number = Date.now()): HTMLElement | null {
  const asks = p.peerId ? pastAsksOf(d.state().heldAsks, p.peerId, now) : []
  if (!asks.length) return null
  return el('div', { class: 'past-asks', 'data-past-asks': p.id }, [
    el('h3', {}, [S.pastAsksTitle(p.name)]),
    ...asks.map((a) => el('div', { class: 'past-ask', 'data-past-ask': a.qid }, [
      el('p', {}, [a.text]),
      el('p', { class: 'meta' }, [S.pastAskWhen(Math.floor((now - a.receivedAt) / DAY_MS))]),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-past-ask-answer': a.qid, onclick: () => d.answer(a.qid) }, [S.pastAskAnswer]),
    ])),
  ])
}
