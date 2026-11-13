// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 (support_ask.ts): the entry points, the send sheet and the helper's calm card. DOM and words only; main.ts passes the app in. */
import { randomId } from '../../demo/src/crypto'
import { el } from '../../demo/src/ui/dom'
import { Ring } from './model'
import type { AppState, Peer, Person } from './model'
import { askPeers } from './non_responsive'
import { loadColourTags, memberIds, type ColourTag } from './colour_tags'
import { tagPill } from './components/tag_pill'
import { foldText } from './settings_search'
import { S } from './strings'
import { deliveryPanel } from './support_delivery_view'
import type { DeliveryIo } from './support_delivery_view'
import { planDelivery, sentVia } from './support_delivery'
import {
  BUNDLES, SUPPORT_CHIPS, SUPPORT_IN_MAX, SupportWindow, audience, buildSupport, bundlePeople, closeText, emergencyNumber, hereText, isOpen, openAsks, supportText,
} from './support_ask'
import type { AudienceChoice, Bundle, SupportIn } from './support_ask'
import { cancelAsk, inboxRows } from './support_inbox'
import { agentAsks, approveAgentAsk, discardAgentAsk } from './support_flush'

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

/** The zones the dropdown offers, narrowest first (the ask is never wider than Friends); tags follow. */
const ZONES: readonly Ring[] = [Ring.Closest, Ring.Close, Ring.Friend]

/** The people the ask would reach: connected, in the chosen zone or tag, Closest few always (unless left out), filtered in and out; not blocked or silent. */
function recipients(io: SupportIo, a: AudienceChoice): { peer: Peer; name: string; person: Person }[] {
  const s = io.st()
  const open = new Set(askPeers(s).map((p) => p.id))
  // Wave 40: a tag means its resolved members (a group holds its children's people).
  const tags = loadColourTags()
  const members = new Map<string, Set<string>>()
  const hasTag = (p: { id: string }, id: string): boolean => {
    if (!members.has(id)) members.set(id, new Set(memberIds(s.people, tags, id)))
    return members.get(id)?.has(p.id) === true
  }
  return audience(s.people.filter((p) => p.peerId && open.has(p.peerId)), a, hasTag)
    .map((p) => ({ peer: s.peers.find((x) => x.id === p.peerId) as Peer, name: p.name, person: p }))
}

/** Review wave 40: how many members of a tag an ask to it really reaches (connected, open to asks, Friends and closer), for its dropdown line. */
function tagReach(io: SupportIo, tags: readonly ColourTag[], id: string): number {
  const members = new Set(memberIds(io.st().people, tags, id))
  return recipients(io, { zone: `tag:${id}` }).filter((r) => members.has(r.person.id)).length
}

/** Wave 42: the community an ask is made in: its tag is the default audience; `remembered` = the last audiences used (keys, newest first); `used` stores one. */
export interface AskScope { tag: string; remembered: readonly string[]; used: (key: string) => void }

/** An audience as one remembered key: the zone, then the bundles pressed ("tag:iyg+closest-allies"). */
const audienceKey = (zone: string, bundles: ReadonlySet<Bundle>): string => [zone, ...BUNDLES.filter((b) => bundles.has(b))].join('+')

/** The send form: the sheet and the Ask dock both show it; `sent` runs after a send. */
export function supportForm(io: SupportIo, sent: () => void, scope?: AskScope): HTMLElement {
  const pick: AudienceChoice = { zone: scope ? `tag:${scope.tag}` : `ring:${Ring.Closest}` }
  const bundles = new Set<Bundle>()
  const bundleLabel = (b: Bundle): string => (b === 'closest-few' ? S.w42.bundleFew : S.w42.bundleAllies)
  const include = new Set<string>()
  const exclude = new Set<string>()
  const chosen = new Set<string>()
  let window: SupportWindow = SupportWindow.Today
  const note = el('textarea', { class: 'field', rows: '2', maxlength: '200', placeholder: S.supportNotePh, 'aria-label': S.supportNotePh, 'data-support-note': '' }) as HTMLTextAreaElement
  const body = el('div', { class: 'support-sheet' })
  const found = el('div', { class: 'support-found', 'data-support-found': '' })
  const find = el('input', {
    class: 'field', type: 'search', placeholder: S.supportFind, 'aria-label': S.supportFind, autocomplete: 'off', 'data-support-find': '',
    oninput: () => drawFound(),
  }) as HTMLInputElement
  const nameOf = (id: string): string => io.st().people.find((p) => p.id === id)?.name ?? ''
  const mark = (id: string, into: Set<string>, from: Set<string>): void => { from.delete(id); into.add(id); find.value = ''; draw() }
  /** Matches of the find field, each to include or leave out. */
  const drawFound = (): void => {
    const q = foldText(find.value)
    const hits = q ? io.st().people.filter((p) => p.peerId && !include.has(p.id) && !exclude.has(p.id) && foldText(p.name).includes(q)).slice(0, 5) : []
    found.replaceChildren(...hits.flatMap((p) => [
      el('span', {}, [p.name]),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-support-include': p.id, onclick: () => mark(p.id, include, exclude) }, [S.supportInclude]),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-support-exclude': p.id, onclick: () => mark(p.id, exclude, include) }, [S.supportLeaveOut]),
    ]))
  }
  const chips = (label: string, ids: Set<string>, attr: string): HTMLElement | null => ids.size === 0 ? null : el('div', { class: 'chips', [attr]: '' }, [
    el('span', { class: 'chips-lbl' }, [label]),
    ...[...ids].map((id) => el('button', { class: 'chip on', type: 'button', 'aria-label': S.supportRemove(nameOf(id)), onclick: () => { ids.delete(id); draw() } }, [nameOf(id) + ' ×'])),
  ])
  const zoneName = (zone: string): string => (zone.startsWith('tag:') ? loadColourTags().find((t) => t.id === zone.slice(4))?.label ?? zone.slice(4) : S.ringLabel[zone.slice(5) as Ring] ?? zone)
  const keyLabel = (key: string): string => key.split('+').map((k, i) => (i === 0 ? zoneName(k) : bundleLabel(k as Bundle))).join(' + ')
  const applyKey = (key: string): void => {
    const [zone, ...rest] = key.split('+')
    pick.zone = zone
    bundles.clear()
    for (const b of rest) if ((BUNDLES as readonly string[]).includes(b)) bundles.add(b as Bundle)
    draw()
  }
  const draw = (): void => {
    pick.include = [...new Set([...include, ...[...bundles].flatMap((b) => bundlePeople(io.st().people, b).map((p) => p.id))])]
    pick.exclude = [...exclude]
    const to = recipients(io, pick)
    const tags = loadColourTags()
    const chosenTag = pick.zone.startsWith('tag:') ? tags.find((t) => t.id === pick.zone.slice(4)) : undefined
    const num = emergencyNumber(navigator.language)
    body.replaceChildren(...[
      el('p', { class: 'chips-lbl' }, [S.supportWho]),
      // One audience control: a zone or a tag; Closest few are always in unless the advanced switch says otherwise.
      el('select', { class: 'field', 'aria-label': S.supportZoneAria, 'data-support-zone': '', onchange: (e) => { pick.zone = (e.target as HTMLSelectElement).value; draw() } }, [
        ...ZONES.map((r) => el('option', { value: `ring:${r}`, ...(pick.zone === `ring:${r}` ? { selected: '' } : {}) }, [S.ringLabel[r]])),
        ...tags.map((t) => el('option', { value: `tag:${t.id}`, ...(pick.zone === `tag:${t.id}` ? { selected: '' } : {}) }, [t.kind && t.kind !== 'personal' ? S.supportGroupTag(t.label ?? t.id, tagReach(io, tags, t.id)) : S.supportTag(t.label ?? t.id)])),
      ]),
      chosenTag ? el('div', { class: 'chips', 'data-support-zone-pill': '' }, [tagPill(chosenTag)]) : null,
      // Wave 42: the trust-zone bundles are always there; they add their people on top of any audience.
      el('div', { class: 'chips', 'data-support-bundles': '', role: 'group', 'aria-label': S.w42.bundles }, BUNDLES.map((b) => el('button', {
        class: 'chip' + (bundles.has(b) ? ' on' : ''), type: 'button', 'data-support-bundle': b, 'aria-pressed': String(bundles.has(b)),
        onclick: () => { if (bundles.has(b)) bundles.delete(b); else bundles.add(b); draw() },
      }, [bundleLabel(b)]))),
      scope?.remembered.length ? el('div', { class: 'chips', 'data-support-remembered': '' }, [
        el('span', { class: 'chips-lbl' }, [S.w42.recent]),
        ...scope.remembered.map((k) => el('button', { class: 'chip', type: 'button', 'data-support-remembered-key': k, onclick: () => applyKey(k) }, [keyLabel(k)])),
      ]) : null,
      pick.notClosest ? null : el('div', { class: 'chips' }, [el('span', { class: 'chip on support-closest', 'data-support-closest-always': '' }, [S.supportClosestAlways])]),
      find,
      found,
      chips(S.supportAlso, include, 'data-support-included'),
      chips(S.supportLeaveOut, exclude, 'data-support-excluded'),
      el('details', { class: 'support-adv', 'data-support-advanced': '', ...(pick.notClosest ? { open: '' } : {}) }, [
        el('summary', {}, [S.supportAdvanced]),
        el('label', { class: 'support-not-closest' }, [
          el('input', { type: 'checkbox', 'data-support-not-closest': '', ...(pick.notClosest ? { checked: '' } : {}), onchange: (e) => { pick.notClosest = (e.target as HTMLInputElement).checked; draw() } }),
          el('span', {}, [S.supportNotClosest]),
        ]),
      ]),
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
    scope?.used(audienceKey(pick.zone, bundles))
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
