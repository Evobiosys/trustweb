// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-bubble-connect-2: the acceptance gate of an introduction, as three protocol texts inside the encrypted chat envelope
 * (the pattern of hello.ts). The person DRAGGED is the requester, the person dropped ONTO is the acceptor:
 *     <app url>?introduce=1#k=req&i=<id>&n=<requester name>&c=<requester's connect link>   introducer -> acceptor
 *     <app url>?introduce=1#k=ok&i=<id>                                                    acceptor -> introducer (accepted)
 *     <app url>?introduce=1#k=no&i=<id>                                                    acceptor -> introducer (declined)
 * The requester gets the acceptor's code only after an `ok` (bubble_connect_view.ts). Everything received is untrusted: id, name and
 * link are bounded and cleaned. Pure and DOM-free; chat.ts imports it, so it imports nothing from chat.ts.
 */
import { cleanHelloName } from './hello'

export const GATE_PARAM = 'introduce'
/** A chat text's cap (chat.ts CHAT_TEXT_MAX; not imported, chat.ts imports this module). */
export const GATE_TEXT_MAX = 500
const ID_RE = /^[a-z0-9-]{1,32}$/

export type GateMsg = { k: 'req'; id: string; name: string; link: string } | { k: 'ok' | 'no'; id: string }

const prefix = (appUrl: string): string => `${appUrl}?${GATE_PARAM}=1#`

/** The text for one gate message; null when it would not fit one chat message or carries no usable name. */
export function gateText(appUrl: string, m: GateMsg): string | null {
  const body = m.k === 'req'
    ? (cleanHelloName(m.name) ? `k=req&i=${encodeURIComponent(m.id)}&n=${encodeURIComponent(cleanHelloName(m.name))}&c=${encodeURIComponent(m.link)}` : null)
    : `k=${m.k}&i=${encodeURIComponent(m.id)}`
  const text = body && `${prefix(appUrl)}${body}`
  return text && text.length <= GATE_TEXT_MAX ? text : null
}

export const isGateText = (appUrl: string, text: string): boolean => typeof text === 'string' && text.startsWith(`${appUrl}?${GATE_PARAM}=`)

/** The message in a gate text; null for anything malformed. Never throws. */
export function parseGateText(appUrl: string, text: string): GateMsg | null {
  if (typeof text !== 'string' || !text.startsWith(prefix(appUrl)) || text.length > GATE_TEXT_MAX) return null
  try {
    const q = new URLSearchParams(text.slice(prefix(appUrl).length))
    const k = q.get('k')
    const id = q.get('i') ?? ''
    if (!ID_RE.test(id)) return null
    if (k === 'ok' || k === 'no') return { k, id }
    const name = cleanHelloName(q.get('n') ?? '')
    const link = q.get('c') ?? ''
    return k === 'req' && name && link.startsWith(appUrl) ? { k, id, name, link } : null
  } catch {
    return null
  }
}
