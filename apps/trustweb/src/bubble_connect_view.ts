// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-bubble-connect: the progress ring on the held-on bubble, the "Introduce A to B?" sheet and the acceptance gate (bubble_connect.ts holds
 * the rules, bubble_gate.ts the texts). The DRAGGED person (requester) gets the DROPPED-ON person's (acceptor's) code only after the acceptor
 * accepted. main.ts passes `introduce` to the Web view, routes gate texts to `receive` and calls `drain`; the MCP tool introduce_people queues.
 */
import { parseConnectLinkParams } from '../../demo/src/connect_link'
import { el } from '../../demo/src/ui/dom'
import { addOnce, introduceBlock, MERGE_HOLD_MS, takeById, takeIntroQueue, type IntroInbox } from './bubble_connect'
import { cardConnectLink, createIntroLink, type Card } from './bubble_card'
import { gateText, parseGateText } from './bubble_gate'
import { codeText, requestText } from './bubble_links'
import { LogOutcome } from './model'
import { linkEntries } from './person_links'
import type { AppState } from './model'
import { refusalOfError } from './send_notice'
import { S } from './strings'

const SVG = 'http://www.w3.org/2000/svg'

/** The ring that fills around `target` over MERGE_HOLD_MS (CSS animation, so no timer); the returned function takes it away. */
export function holdRing(target: HTMLElement): () => void {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'hold-ring')
  svg.setAttribute('data-hold-ring', '')
  svg.setAttribute('viewBox', '0 0 40 40')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.setProperty('--hold-ms', `${MERGE_HOLD_MS}ms`)
  const c = document.createElementNS(SVG, 'circle')
  for (const [k, v] of Object.entries({ cx: '20', cy: '20', r: '18', pathLength: '100' })) c.setAttribute(k, v)
  svg.appendChild(c)
  target.appendChild(svg)
  return () => svg.remove()
}

export interface BubbleConnectDeps {
  st(): AppState
  save(): void
  render(): void
  openSheet(nodes: Node[]): void
  closeSheet(): void
  toast(msg: string): void
  appUrl: string
  /** Queues the text for the person's chat and sends it when the relay is up (chat_view.ts submitText). */
  send(peerId: string, text: string): Promise<boolean>
  /** Sends a protocol text (not a chat line) to a connected peer; rejects when it could not go out. */
  sendProtocol(peerId: string, text: string): Promise<void>
  /** The acceptor said yes: connects to the requester's link, landing them in Friends (main.ts completePendingConnect). */
  connectVia(link: string): void
  /** My own connect link (starts the relay when needed). */
  myLink(): Promise<string>
  renderQr(target: HTMLElement, payload: string): Promise<void>
  copy(text: string): void
  /** Settings > Advanced "profile in QR" (AppState.qrProfileOption). */
  profileOption(): boolean
}

const linkReads = (link: string): boolean => { try { return parseConnectLinkParams(new URL(link).search) !== null } catch { return false } }

export function createBubbleConnect(d: BubbleConnectDeps): { introduce(requesterId: string, acceptorId: string): void; offerCard(card: Card): void; receive(peerId: string, text: string): void; drain(): void } {
  /** Asks the acceptor; resolves to the toast text. The requester is told it was asked; the code follows after the yes (receive). */
  const send = async (requesterId: string, acceptorId: string): Promise<string> => {
    const s = d.st()
    const a = s.people.find((p) => p.id === requesterId)
    const b = s.people.find((p) => p.id === acceptorId)
    if (!a || !b) return S.introduceBlock.unknown
    const block = introduceBlock(a, b, s.peers)
    if (block) return S.introduceBlock[block]
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const text = requestText(d.appUrl, id, a, s.peers)
    if (!text) return S.introduceBlock['too-long']
    addOnce(s, 'introPending', { id, requester: a.id, acceptor: b.id, at: Date.now() })
    d.save()
    try { await d.sendProtocol(b.peerId!, text) } catch (e) { takeById(s, 'introPending', id); d.save(); return S.sendRefused[refusalOfError(e)] }   // wave47 invite-fits-chat: the real reason, not "No connection"
    void d.send(a.peerId!, S.introduceAskedText(s.me.displayName, b.name))
    s.log.unshift({ id: `intro-${id}`, at: Date.now(), from: s.me.displayName, text: S.introduceLog(a.name, b.name), outcome: LogOutcome.Shared })
    d.save()
    return S.introduceDone(a.name, b.name)
  }
  const connected = (p: { peerId?: string }): boolean => d.st().peers.some((x) => x.id === p.peerId && x.did)
  /** Link + QR for a dragged person I am not connected to: opening it connects them with me and brings the target's card (bubble_card.ts). */
  const linkSheet = async (draggedId: string, targetId: string): Promise<void> => {
    const s = d.st()
    const a = s.people.find((p) => p.id === draggedId)!
    const b = s.people.find((p) => p.id === targetId)!
    const out = createIntroLink(s, draggedId, targetId, await d.myLink(), d.profileOption(), linkEntries(b)[0]?.url)
    if (!out.ok) { d.toast(S.introduceBlock[out.reason] ?? S.introduceBlock.unknown); return }
    const qr = el('div', { class: 'qrwrap', 'data-introduce-qr': '' })
    void d.renderQr(qr, out.link)
    const share = typeof navigator.share === 'function' ? el('button', { class: 'btn btn-ghost', 'data-introduce-share': '', onclick: () => { void navigator.share({ text: out.link }).catch(() => undefined) } }, [S.introduceLinkShare]) : null
    d.openSheet([
      el('div', { 'data-introduce-link-sheet': '' }, [
        el('h3', {}, [S.introduceLinkTitle(a.name, b.name)]),
        el('p', { class: 'meta' }, [S.introduceLinkBody(a.name, b.name)]),
        qr,
        el('input', { class: 'field', readonly: '', value: out.link, 'aria-label': S.introduceLinkTitle(a.name, b.name), 'data-introduce-link': '' }),
        el('button', { class: 'btn btn-electric', 'data-introduce-copy': '', onclick: () => d.copy(out.link) }, [S.introduceLinkCopy]),
        share,
        el('button', { class: 'btn btn-ghost', 'data-introduce-close': '', onclick: d.closeSheet }, [S.introduceLinkClose]),
      ]),
    ])
    s.log.unshift({ id: `intro-link-${Date.now().toString(36)}`, at: Date.now(), from: s.me.displayName, text: S.introduceLinkLog(a.name, b.name), outcome: LogOutcome.Shared })
    d.save()
  }
  /** The opener's sheet (they came by an introduction link): "<name> was introduced to you: connect too?" */
  const offerCard = (card: Card): void => d.openSheet([
    el('div', { 'data-introduce-card': '' }, [
      el('h3', {}, [S.introduceCardTitle(card.n)]),
      card.u ? el('p', { class: 'meta', 'data-introduce-card-username': '' }, [S.introduceCardUsername(card.u)]) : null,
      el('button', { class: 'btn btn-electric', 'data-introduce-card-connect': '', onclick: () => { d.closeSheet(); d.connectVia(cardConnectLink(card)) } }, [S.introduceCardConnect(card.n)]),
      el('button', { class: 'btn btn-ghost', 'data-introduce-card-no': '', onclick: d.closeSheet }, [S.introduceCardNo]),
    ]),
  ])
  const introduce = (requesterId: string, acceptorId: string): void => {
    const s = d.st()
    const a = s.people.find((p) => p.id === requesterId)
    const b = s.people.find((p) => p.id === acceptorId)
    if (!a || !b) return
    if (!connected(a)) { void linkSheet(a.id, b.id); return } // wave 44 steer-bubble-connect-3: the dragged person is not on TrustWeb with me yet
    const block = introduceBlock(a, b, s.peers)
    if (block) { d.toast(S.introduceBlock[block]); return }
    d.openSheet([
      el('div', { 'data-introduce-sheet': '' }, [
        el('h3', {}, [S.introduceTitle(a.name, b.name)]),
        el('p', { class: 'meta' }, [S.introduceBody(a.name, b.name)]),
        el('button', { class: 'btn btn-electric', 'data-introduce-yes': '', onclick: () => { d.closeSheet(); void send(requesterId, acceptorId).then((msg) => { d.toast(msg); d.render() }) } }, [S.introduceYes]),
        el('button', { class: 'btn btn-ghost', 'data-introduce-no': '', onclick: d.closeSheet }, [S.introduceNo]),
      ]),
    ])
  }
  /** The acceptor's sheet: "<requester> would like to connect with you, introduced by <me>". Closing it keeps the request for later. */
  const ask = (item: IntroInbox): void => {
    const s = d.st()
    const who = s.people.find((p) => p.peerId === item.from)?.name ?? s.peers.find((p) => p.id === item.from)?.displayName ?? ''
    const answer = (k: 'ok' | 'no'): void => {
      const text = gateText(d.appUrl, { k, id: item.id })
      if (!text) return
      d.sendProtocol(item.from, text).then(() => {
        takeById(d.st(), 'introInbox', item.id); d.save(); d.closeSheet()
        if (k === 'ok') d.connectVia(item.link)
        else d.render()
      }, (e: unknown) => d.toast(S.sendRefused[refusalOfError(e)]))
    }
    d.openSheet([
      el('div', { 'data-introduce-gate': '' }, [
        el('h3', {}, [S.introduceGateTitle(item.name, who)]),
        el('button', { class: 'btn btn-electric', 'data-introduce-accept': '', onclick: () => answer('ok') }, [S.introduceAccept]),
        el('button', { class: 'btn btn-ghost', 'data-introduce-decline': '', onclick: () => answer('no') }, [S.introduceDecline]),
      ]),
    ])
  }
  /** A gate text from a connected peer: a request (acceptor side), or the yes / no of an acceptor I asked (introducer side). */
  const receive = (peerId: string, text: string): void => {
    const m = parseGateText(d.appUrl, text)
    if (!m) return
    const s = d.st()
    if (m.k === 'req') {
      if (!linkReads(m.link)) return
      const item = { id: m.id, from: peerId, name: m.name, link: m.link, at: Date.now() }
      if (addOnce(s, 'introInbox', item)) { d.save(); ask(item) }
      return
    }
    const pending = s.introPending?.find((i) => i.id === m.id)
    const acceptor = pending && s.people.find((p) => p.id === pending.acceptor)
    const requester = pending && s.people.find((p) => p.id === pending.requester)
    if (!pending || !acceptor || !requester || acceptor.peerId !== peerId) return // only the person I asked can answer
    takeById(s, 'introPending', m.id)
    d.save()
    if (m.k === 'no') { d.toast(S.introduceDeclined(acceptor.name)); return }
    const code = requester.peerId ? codeText(d.appUrl, acceptor, s.peers, s.me.displayName) : null
    if (!code) { d.toast(S.introduceBlock['too-long']); return }
    void d.send(requester.peerId!, code)
    d.toast(S.introduceAccepted(acceptor.name))
    d.render()
  }
  /** Introductions an MCP client queued while the app was closed: sent now, once; and a request still waiting for my answer. */
  const drain = (): void => {
    const q = takeIntroQueue(d.st())
    if (q.length) { d.save(); for (const i of q) void send(i.requester, i.acceptor).then(d.toast) }
    const waiting = d.st().introInbox?.[0]
    if (waiting) ask(waiting)
  }
  return { introduce, offerCard, receive, drain }
}
