// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 (support_ask.ts): the entry points, the send sheet and the helper's calm card. DOM and words only; main.ts passes the app in. */
import { randomId } from '../../demo/src/crypto'
import { el } from '../../demo/src/ui/dom'
import { Ring } from './model'
import type { AppState, Peer } from './model'
import { askPeers } from './non_responsive'
import { S } from './strings'
import {
  SUPPORT_CHIPS, SUPPORT_IN_MAX, SupportWindow, audiencePeople, buildSupport, emergencyNumber, hereText, isOpen, openAsks, supportText,
} from './support_ask'
import type { SupportIn } from './support_ask'

export interface SupportIo {
  st: () => AppState
  save: () => void
  render: () => void
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (text: string) => void
  send: (peer: Peer, text: string) => Promise<void>
  openChat: (personId: string) => void
  appUrl: string
}

const WIDEST: readonly Ring[] = [Ring.Closest, Ring.Close, Ring.Friend]

/** The people the ask would reach: connected, on the chosen rings, not blocked or silent. */
function recipients(io: SupportIo, widest: Ring): { peer: Peer; name: string }[] {
  const s = io.st()
  const open = new Set(askPeers(s).map((p) => p.id))
  return s.people.filter((p) => p.peerId && open.has(p.peerId) && audiencePeople([p], widest).length)
    .map((p) => ({ peer: s.peers.find((x) => x.id === p.peerId) as Peer, name: p.name }))
}

/** The send form: the sheet and the Ask dock both show it; `sent` runs after a send. */
export function supportForm(io: SupportIo, sent: () => void): HTMLElement {
  let widest: Ring = Ring.Closest
  const chosen = new Set<string>()
  let window: SupportWindow = SupportWindow.Today
  const note = el('textarea', { class: 'field', rows: '2', maxlength: '200', placeholder: S.supportNotePh, 'aria-label': S.supportNotePh, 'data-support-note': '' }) as HTMLTextAreaElement
  const body = el('div', { class: 'support-sheet' })
  const draw = (): void => {
    const to = recipients(io, widest)
    const num = emergencyNumber(navigator.language)
    body.replaceChildren(
      el('p', { class: 'chips-lbl' }, [S.supportWho]),
      el('div', { class: 'chips' }, WIDEST.map((r) => el('button', {
        class: 'chip' + (r === widest ? ' on' : ''), type: 'button', 'data-support-ring': r, 'aria-pressed': String(r === widest),
        onclick: () => { widest = r; draw() },
      }, [S.ringLabel[r]]))),
      el('p', { class: 'hint', 'data-support-count': String(to.length) }, [to.length ? S.supportOnly(to.length) : S.supportNobody]),
      el('p', { class: 'chips-lbl' }, [S.supportWhat]),
      el('div', { class: 'chips' }, SUPPORT_CHIPS.map((c) => el('button', {
        class: 'chip' + (chosen.has(c) ? ' on' : ''), type: 'button', 'data-support-chip': c, 'aria-pressed': String(chosen.has(c)),
        onclick: () => { if (chosen.has(c)) chosen.delete(c); else chosen.add(c); draw() },
      }, [S.supportChip[c]]))),
      note,
      el('p', { class: 'chips-lbl' }, [S.supportWindow]),
      el('div', { class: 'chips' }, [[SupportWindow.Today, S.supportToday], [SupportWindow.Week, S.supportWeek]].map(([w, label]) => el('button', {
        class: 'chip' + (w === window ? ' on' : ''), type: 'button', 'data-support-window': w, 'aria-pressed': String(w === window),
        onclick: () => { window = w as SupportWindow; draw() },
      }, [label]))),
      el('button', { class: 'btn btn-electric wide', type: 'button', 'data-support-send': '', disabled: to.length === 0, onclick: () => send(to) }, [S.supportSend]),
      el('p', { class: 'hint', 'data-support-danger': '' }, [num === '112' ? S.supportDangerEu(num) : S.supportDanger(num)]),
    )
  }
  const send = (to: { peer: Peer }[]): void => {
    const s = io.st()
    const ask = buildSupport({ chips: [...chosen], note: note.value, window, ids: to.map((t) => t.peer.id) }, Date.now(), randomId(12))
    s.supportAsks = [ask, ...openAsks(s.supportAsks, Date.now())]
    io.save()
    const text = supportText(io.appUrl, ask)
    for (const t of to) void io.send(t.peer, text).catch(() => { /* the card shows who answered; nobody else is told */ })
    sent()
    io.toast(S.supportSent(to.length))
    io.render()
  }
  draw()
  return body
}

export function supportSheet(io: SupportIo): void {
  io.openSheet([el('h3', {}, [S.supportTitle]), supportForm(io, io.closeSheet)])
}

/** The small underlined line under the rings, only while the sender has an ask open: until when and who answered. */
export function supportLine(io: SupportIo): HTMLElement | null {
  const s = io.st()
  const now = Date.now()
  const mine = openAsks(s.supportAsks, now)[0]
  const name = (id: string): string => s.people.find((p) => p.peerId === id)?.name ?? s.peers.find((p) => p.id === id)?.displayName ?? ''
  if (!mine) return null
  return el('p', { class: 'hint support-line', 'data-support-line': '', 'data-support-mine': mine.id }, [
    S.supportOpenUntil(new Date(mine.until).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })) + ' ',
    mine.here.length ? S.supportHereNames(mine.here.map(name).filter(Boolean).join(', ')) : S.supportNobodyYet,
  ])
}

/** A received ask, kept (newest first, bounded, open ones only). */
export function addSupportIn(list: SupportIn[] | undefined, a: SupportIn, now: number): SupportIn[] {
  return [a, ...openAsks(list, now).filter((x) => !(x.id === a.id && x.peerId === a.peerId))].slice(0, SUPPORT_IN_MAX)
}

/** The helper's calm cards: "<name> could use support: <chips>" with "I'm here" and "Not now" (silent). */
export function supportCards(io: SupportIo): HTMLElement[] {
  const s = io.st()
  const now = Date.now()
  return (s.supportIn ?? []).filter((a) => isOpen(a, now)).flatMap((a) => {
    const person = s.people.find((p) => p.peerId === a.peerId)
    const peer = s.peers.find((p) => p.id === a.peerId)
    if (!person || !peer) return []
    const drop = (): void => { s.supportIn = (s.supportIn ?? []).filter((x) => x !== a); io.save(); io.render() }
    return [el('div', { class: 'card support-card', 'data-support-card': a.id }, [
      el('p', {}, [S.supportCard(person.name, a.chips.map((c) => S.supportChip[c]).join(', '))]),
      a.note ? el('p', { class: 'hint' }, [a.note]) : null,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-support-here': a.id, onclick: () => {
          void io.send(peer, hereText(io.appUrl, a.id)).catch(() => { /* the chat opens anyway */ })
          drop()
          io.openChat(person.id)
        } }, [S.supportHere]),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-support-notnow': a.id, onclick: drop }, [S.supportNotNow]),
      ]),
    ])]
  })
}
