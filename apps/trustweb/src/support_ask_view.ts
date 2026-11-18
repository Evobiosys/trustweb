// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 (support_ask.ts): the entry points, the send sheet and the helper's calm card. DOM and words only; main.ts passes the app in. */
import { randomId } from '../../demo/src/crypto'
import { el } from '../../demo/src/ui/dom'
import { Ring } from './model'
import type { AppState, Peer, Person } from './model'
import { askPeers } from './non_responsive'
import { loadColourTags } from './colour_tags'
import { DEFAULT_FILTER, audienceFilterView, peopleFor, ringOfZone, zoneOfRing } from './audience_filter'
import type { AudienceFilter, FilterExtras } from './audience_filter'
import { tagTester } from './ask_audience'
import { S } from './strings'
import { deliveryPanel } from './support_delivery_view'
import type { DeliveryIo } from './support_delivery_view'
import { planDelivery, sentVia } from './support_delivery'
import {
  SUPPORT_CHIPS, SUPPORT_IN_MAX, SupportWindow, buildSupport, closeText, emergencyNumber, hereText, isOpen, openAsks, supportText,
} from './support_ask'
import type { SupportIn } from './support_ask'
import { cancelAsk, inboxRows } from './support_inbox'
import { agentAsks, approveAgentAsk, discardAgentAsk } from './support_flush'
import { draftable } from './drafts_dom'

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
  /** How a messenger or mail link opens on this device (messenger_links.ts browserOpenEnv). */
  env: DeliveryIo['env']
}

/** The people the ask would reach: connected, open to asks, in the filter's zone (Closest few always) plus what it adds, minus what it hides. */
function recipients(io: SupportIo, f: AudienceFilter & FilterExtras): { peer: Peer; name: string; person: Person }[] {
  const s = io.st()
  const open = new Set(askPeers(s).map((p) => p.id))
  return peopleFor(f, s.people.filter((p) => p.peerId && open.has(p.peerId)), tagTester(s.people, loadColourTags()))
    .map((p) => ({ peer: s.peers.find((x) => x.id === p.peerId) as Peer, name: p.name, person: p }))
}

/** Wave 42: the community an ask is made in: its tag is the default audience; `remembered` = the last audiences used (keys, newest first); `used` stores one. */
export interface AskScope { tag: string; remembered: readonly string[]; used: (key: string) => void }

/** An audience as one remembered key: "ring:<ring>" or, for a community scope, "tag:<id>" (older keys may carry bundle suffixes after a "+": ignored). */
const audienceKey = (f: AudienceFilter & FilterExtras): string => (f.only ? `tag:${f.only}` : `ring:${ringOfZone(f.zone ?? 'closest')}`)

/** The send form: the sheet and the Ask dock both show it; `sent` runs after a send. */
export function supportForm(io: SupportIo, sent: () => void, scope?: AskScope): HTMLElement {
  // The zone is always one of the three (Closest few by default); a community scope starts as its tag inside the Friends zone.
  const f: AudienceFilter & FilterExtras = { ...DEFAULT_FILTER, zone: scope ? 'friend' : 'closest', add: [], exclude: [], ...(scope ? { only: scope.tag } : {}) }
  const chosen = new Set<string>()
  let window: SupportWindow = SupportWindow.Today
  const note = el('textarea', { class: 'field', rows: '2', maxlength: '200', placeholder: S.supportNotePh, 'aria-label': S.supportNotePh, 'data-support-note': '' }) as HTMLTextAreaElement
  const body = el('div', { class: 'support-sheet' })
  const kept = draftable(body, 'support-note', scope?.tag ?? 'mine')   // wave44c event-autosave
  const zoneName = (zone: string): string => (zone.startsWith('tag:') ? loadColourTags().find((t) => t.id === zone.slice(4))?.label ?? zone.slice(4) : S.ringLabel[zone.slice(5) as Ring] ?? zone)
  const applyKey = (key: string): void => {
    const [zone] = key.split('+')
    if (zone.startsWith('tag:')) { f.zone = 'friend'; f.only = zone.slice(4) } else { f.zone = zoneOfRing(zone.slice(5)) ?? 'closest'; delete f.only }
    draw()
  }
  const draw = (): void => {
    const to = recipients(io, f)
    const num = emergencyNumber(navigator.language)
    body.replaceChildren(...[
      // One filter view for every "who may see it": the zones, Also include / Hide from, Advanced (the Closest-few switch).
      audienceFilterView({
        filter: f, people: () => io.st().people.filter((p) => p.peerId), zoneRequired: true, openSheet: io.openSheet, closeSheet: io.closeSheet,
        changed: () => { io.save(); draw() },
        advanced: [el('label', { class: 'support-not-closest' }, [
          el('input', { type: 'checkbox', 'data-support-not-closest': '', ...(f.notClosest ? { checked: '' } : {}), onchange: (e) => { f.notClosest = (e.target as HTMLInputElement).checked; draw() } }),
          el('span', {}, [S.supportNotClosest]),
        ])],
      }),
      scope?.remembered.length ? el('div', { class: 'chips', 'data-support-remembered': '' }, [
        el('span', { class: 'chips-lbl' }, [S.w42.recent]),
        ...scope.remembered.map((k) => el('button', { class: 'chip', type: 'button', 'data-support-remembered-key': k, onclick: () => applyKey(k) }, [zoneName(k.split('+')[0])])),
      ]) : null,
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
    ].filter((n): n is HTMLElement => n !== null))
  }
  const send = (to: { peer: Peer; person: Person }[]): void => {
    const s = io.st()
    const ask = buildSupport({ chips: [...chosen], note: note.value, window, ids: to.map((t) => t.peer.id) }, Date.now(), randomId(12))
    s.supportAsks = [ask, ...openAsks(s.supportAsks, Date.now())]
    io.save()
    const text = supportText(io.appUrl, ask)
    for (const t of to) void io.send(t.peer, text).catch(() => { /* the card shows who answered; nobody else is told */ })
    scope?.used(audienceKey(f))
    kept.clear()
    sent()
    io.toast(S.supportSent(to.length))
    io.render()
    // Wave 40: the app entry has gone; the linked messengers and the e-mail fallback wait as one tap each.
    const plan = planDelivery(to.map((t) => t.person))
    if (plan.groups.length) io.openSheet([deliveryPanel(io, ask, plan, io.closeSheet)])
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
    // Wave 40: "who saw it" is the app only; the messengers and mail only say when they were opened.
    ...sentVia(mine).map((v) => el('span', { class: 'support-via', 'data-support-via': v.via }, [
      ' ' + S.supportSentVia(S.supportViaLabel[v.via], new Date(v.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), v.peerIds.map(name).filter(Boolean).join(', ')),
    ])),
    ' ',
    el('button', { class: 'lnk', type: 'button', 'data-support-cancel': mine.id, onclick: () => cancelMine(io, mine.id) }, [S.w42.cancelAsk]),
  ])
}

/** Wave 42: closes my own ask and tells the people it went to (their copy goes away). */
export function cancelMine(io: SupportIo, id: string): void {
  const s = io.st()
  const out = cancelAsk(s.supportAsks, id, Date.now())
  if (!out.cancelled) return
  s.supportAsks = out.asks
  io.save()
  for (const peerId of out.cancelled.to) {
    const peer = s.peers.find((p) => p.id === peerId)
    if (peer) void io.send(peer, closeText(io.appUrl, id)).catch(() => { /* their copy ends by itself at its time */ })
  }
  io.toast(S.w42.cancelled)
  io.render()
}

/** Wave 42: every open ask in one list, mine (with Cancel) and the ones sent to me; the empty state says so in words. */
export function supportInbox(io: SupportIo): HTMLElement {
  const s = io.st()
  const rows = inboxRows({ supportAsks: s.supportAsks, supportIn: s.supportIn, people: s.people }, Date.now())
  const until = (ms: number): string => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return el('div', { class: 'support-inbox', 'data-support-inbox': '' }, [
    el('h4', { class: 'eyebrow' }, [S.w42.inboxTitle]),
    ...(rows.length ? rows.map((r) => el('div', { class: 'conn-row support-inbox-row', 'data-support-inbox-row': r.id, 'data-kind': r.kind }, [
      el('b', {}, [r.kind === 'mine' ? S.w42.inboxMine(r.asked ?? 0, r.answered ?? 0) : S.w42.inboxTheirs(r.who ?? '')]),
      el('span', { class: 'meta' }, [' ' + [r.chips.map((c) => S.supportChip[c]).join(', '), r.note, S.w42.inboxUntil(until(r.until))].filter(Boolean).join(' · ')]),
      r.kind === 'mine' ? el('button', { class: 'lnk', type: 'button', 'data-support-inbox-cancel': r.id, onclick: () => { cancelMine(io, r.id); io.render() } }, [S.w42.cancelAsk]) : null,
    ])) : [el('p', { class: 'empty', 'data-support-inbox-none': '' }, [S.w42.inboxNone])]),
  ])
}

/** A received ask, kept (newest first, bounded, open ones only). */
export function addSupportIn(list: SupportIn[] | undefined, a: SupportIn, now: number): SupportIn[] {
  return [a, ...openAsks(list, now).filter((x) => !(x.id === a.id && x.peerId === a.peerId))].slice(0, SUPPORT_IN_MAX)
}

/** Review wave 42 (I9): asks an agent prepared over MCP. Nothing leaves until the person taps Send; Discard drops it unsent. */
export function agentAskCards(io: SupportIo): HTMLElement[] {
  const s = io.st()
  return agentAsks(s.supportAsks, Date.now()).map((a) => el('div', { class: 'card support-card agent-ask-card', 'data-agent-ask': a.id }, [
    el('p', {}, [S.w42.agentAsk(a.note)]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-agent-ask-send': a.id, onclick: () => {
        const out = approveAgentAsk(s.supportAsks, a.id)
        if (!out.ask) return
        s.supportAsks = out.asks
        io.save()
        const sent = out.ask
        for (const peerId of sent.to) { const peer = s.peers.find((p) => p.id === peerId); if (peer) void io.send(peer, supportText(io.appUrl, sent)).catch(() => undefined) }
        io.toast(S.w42.agentSent)
        io.render()
      } }, [S.w42.agentSend]),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-agent-ask-discard': a.id, onclick: () => { s.supportAsks = discardAgentAsk(s.supportAsks, a.id); io.save(); io.toast(S.w42.agentDiscarded); io.render() } }, [S.w42.agentDiscard]),
    ]),
  ]))
}

/** The helper's calm cards: "<name> could use support: <chips>" with "I'm here" and "Not now" (silent). */
export function supportCards(io: SupportIo): HTMLElement[] {
  const s = io.st()
  const now = Date.now()
  return [...agentAskCards(io), ...(s.supportIn ?? []).filter((a) => isOpen(a, now)).flatMap((a) => {
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
  })]
}
