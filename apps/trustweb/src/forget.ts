// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): "Be forgotten: TrustWeb". The owner sends every connected phone a forget request; that phone removes what
 * the SENDER shared with it (the sender owns that data, so "my terms" accepts it as is) and answers with an ack. Only what they shared:
 * shares they sent, their answers in my finds, their links and profile on my card for them; my own notes about them stay mine.
 * The texts travel sealed, like every chat text (net.ts sendText). Pure, no DOM.
 */
import type { AppState } from './model'

const PARAM = 'forget'

export type ForgetMsg = { op: 'forget'; scope: 'all'; ts: number } | { op: 'forget-ack'; ts: number }

export function forgetText(appUrl: string, m: ForgetMsg): string {
  const q = new URLSearchParams({ op: m.op, ...(m.op === 'forget' ? { scope: m.scope } : {}), ts: String(m.ts) })
  return `${appUrl}?${PARAM}=1#${q.toString()}`
}

export const isForgetText = (appUrl: string, text: string): boolean => typeof text === 'string' && text.startsWith(`${appUrl}?${PARAM}=1#`)

/** Null for anything that is not exactly a request or an ack. Never throws. */
export function parseForgetText(appUrl: string, text: string): ForgetMsg | null {
  if (!isForgetText(appUrl, text) || text.length > appUrl.length + 80) return null
  const q = new URLSearchParams(text.slice(text.indexOf('#') + 1))
  const ts = Number(q.get('ts'))
  if (!Number.isSafeInteger(ts) || ts < 0) return null
  if (q.get('op') === 'forget' && q.get('scope') === 'all') return { op: 'forget', scope: 'all', ts }
  if (q.get('op') === 'forget-ack' && !q.has('scope')) return { op: 'forget-ack', ts }
  return null
}

type Held = Pick<AppState, 'people' | 'received' | 'found'>

/** Removes what `peerId` shared with this phone; returns how many pieces went. A second call removes nothing more. */
export function applyForget(s: Held, peerId: string): number {
  let n = 0
  if (s.received) { const keep = s.received.filter((r) => r.fromPeerId !== peerId); n += s.received.length - keep.length; s.received = keep }
  if (s.found) {
    s.found = s.found.flatMap((f) => {
      const shared = f.shared.filter((x) => x.peerId !== peerId)
      n += f.shared.length - shared.length
      return shared.length ? [{ ...f, shared }] : []
    })
  }
  for (const p of s.people) {
    if (p.peerId !== peerId) continue
    for (const k of ['theirChannels', 'theirChannelsAt', 'theirSignalProvider', 'theirProfile'] as const) if (p[k] !== undefined) { delete p[k]; n++ }
  }
  return n
}

type Sov = Pick<AppState, 'sovereign'>
const peers = (s: Sov): Record<string, { sentAt?: number; ackAt?: number }> => {
  s.sovereign ??= {}
  s.sovereign.forget ??= { peers: {} }
  return s.sovereign.forget.peers
}

export function noteForgetSent(s: Sov, peerId: string, at: number): void { peers(s)[peerId] = { ...peers(s)[peerId], sentAt: at } }

/** False for an ack from a phone that was never asked. */
export function noteForgetAck(s: Sov, peerId: string, at: number): boolean {
  const p = s.sovereign?.forget?.peers[peerId]
  if (!p?.sentAt) return false
  p.ackAt = at
  return true
}

export function forgetStatus(s: Sov, peerId: string): 'not-sent' | 'sent' | 'acked' {
  const p = s.sovereign?.forget?.peers[peerId]
  return p?.ackAt ? 'acked' : p?.sentAt ? 'sent' : 'not-sent'
}

/** My own shared lines stop answering; returns how many. Share again undoes exactly these. */
export function retractOwn(s: Pick<AppState, 'inventory'>, at: number): number {
  let n = 0
  for (const i of s.inventory) if (i.included) { i.included = false; i.retractedAt = at; n++ }
  return n
}

export function shareAgain(s: Pick<AppState, 'inventory'>): number {
  let n = 0
  for (const i of s.inventory) if (i.retractedAt !== undefined) { i.included = true; delete i.retractedAt; n++ }
  return n
}
