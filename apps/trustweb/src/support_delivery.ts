// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40: how a support ask reaches each person (Jakob 2026-11-10): in the app (always: the encrypted chat text, support_ask.ts), AND
 * on the messenger linked on their card (Signal, WhatsApp, Geb), AND by e-mail when there is no messenger. The app entry is sent
 * first; the messenger and e-mail parts are links the sender taps, one at a time. Pure and DOM-free.
 */
import { Channel } from './model'
import type { Person } from './model'
import { isEmailAddress, waLink } from './channel'
import { EMAIL_FIELD } from './intending_reminder'
import { chatTarget } from './messenger_links'
import type { ServiceId } from './messenger_links'
import { S } from './strings'
import type { SupportAsk } from './support_ask'

/** The channel groups in the order they are offered. */
export const DELIVERY_VIA = ['signal', 'whatsapp', 'geb', 'email'] as const
export type DeliveryVia = (typeof DELIVERY_VIA)[number]
type MessengerVia = Exclude<DeliveryVia, 'email'>

type Reachable = Pick<Person, 'id' | 'name' | 'peerId' | 'channels' | 'links' | 'chatPin' | 'chatLast' | 'fields'>

export interface Delivery { personId: string; peerId: string; name: string; person: Reachable; email?: string }
export interface DeliveryGroup { via: DeliveryVia; items: Delivery[] }
export interface DeliveryPlan { inApp: Delivery[]; groups: DeliveryGroup[] }

const MESSENGERS: readonly MessengerVia[] = ['signal', 'whatsapp', 'geb']

/** The messenger to use for a person: the one pinned for them first, then Signal, WhatsApp, Geb; none when no link is on the card. */
function messengerOf(p: Reachable): MessengerVia | null {
  const order = [...new Set([p.chatPin, ...MESSENGERS])].filter((s): s is MessengerVia => MESSENGERS.includes(s as MessengerVia))
  return order.find((s) => chatTarget(p, s as ServiceId) !== null) ?? null
}

const emailOf = (p: Reachable): string | undefined => {
  const e = p.fields?.[EMAIL_FIELD]?.trim()
  return e && isEmailAddress(e) ? e : undefined
}

export function planDelivery(people: readonly Reachable[]): DeliveryPlan {
  const inApp: Delivery[] = []
  const by = new Map<DeliveryVia, Delivery[]>()
  for (const p of people) {
    if (!p.peerId) continue
    const d: Delivery = { personId: p.id, peerId: p.peerId, name: p.name, person: p }
    inApp.push(d)
    const m = messengerOf(p)
    const e = emailOf(p)
    const via: DeliveryVia | null = m ?? (e ? 'email' : null)
    if (!via) continue
    by.set(via, [...(by.get(via) ?? []), via === 'email' ? { ...d, email: e } : d])
  }
  return { inApp, groups: DELIVERY_VIA.flatMap((via) => (by.has(via) ? [{ via, items: by.get(via) as Delivery[] }] : [])) }
}

/** "12 in the app, 7 via Signal, 3 via WhatsApp, 2 by e-mail" */
export function deliverySummary(plan: DeliveryPlan): string {
  return [
    S.supportViaApp(plan.inApp.length),
    ...plan.groups.map((g) => (g.via === 'email' ? S.supportViaMail(g.items.length) : S.supportViaMsg(g.items.length, S.supportViaLabel[g.via]))),
  ].join(', ')
}

export interface MessengerOpen { href: string; fallback?: string; /** The messenger takes no prefilled text: copy it first. */ copy: boolean }

/** The deep link that opens this person's messenger with the text; null when the card has no such link. */
export function messengerOpen(p: Reachable, via: MessengerVia, text: string): MessengerOpen | null {
  const t = chatTarget(p, via)
  if (!t || !('href' in t)) return null
  const wa = via === 'whatsapp' ? p.channels?.[Channel.WhatsApp] : undefined
  if (wa) return { href: waLink(wa, text), copy: false }
  return { href: t.href, ...(t.fallback ? { fallback: t.fallback } : {}), copy: true }
}

/** One mail to everybody: the addresses go in BCC so nobody learns who else was asked. */
export function emailLink(addresses: readonly string[], subject: string, body: string): string {
  return `mailto:?bcc=${addresses.map(encodeURIComponent).join(',')}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Mail programs cut longer mailto links (Outlook / Windows near 2,000 characters): addresses past the cut would silently get nothing. */
export const MAILTO_MAX = 1900

/** The BCC list split into as few mails as fit under MAILTO_MAX each (one address per mail at least); every address exactly once, with its count. */
export function emailBatches(addresses: readonly string[], subject: string, body: string, max = MAILTO_MAX): { href: string; count: number }[] {
  const out: { href: string; count: number }[] = []
  let batch: string[] = []
  const flush = (): void => { out.push({ href: emailLink(batch, subject, body), count: batch.length }); batch = [] }
  for (const a of addresses) {
    if (batch.length && emailLink([...batch, a], subject, body).length > max) flush()
    batch.push(a)
  }
  if (batch.length) flush()
  return out
}

/** The links of emailBatches. */
export const emailLinks = (addresses: readonly string[], subject: string, body: string, max = MAILTO_MAX): string[] =>
  emailBatches(addresses, subject, body, max).map((b) => b.href)

/** The words sent over a messenger or by e-mail: plain, to one person, no recipient list. */
export function deliveryText(name: string, a: Pick<SupportAsk, 'chips' | 'note'>, when: string, appUrl: string): string {
  return S.supportMessage(name.trim().split(/\s+/)[0], a.chips.map((c) => S.supportChip[c]).join(', '), a.note, when, appUrl)
}

/** Notes that the sender opened this person's messenger or mail; true when this changed anything. Only for somebody the ask went to. */
export function markSent(ask: Pick<SupportAsk, 'to' | 'via'>, peerId: string, via: DeliveryVia, at: number): boolean {
  if (!ask.to.includes(peerId)) return false
  ask.via = { ...ask.via, [peerId]: { via, at } }
  return true
}

/** The marks grouped by channel in plan order, each with its latest time. */
export function sentVia(ask: Pick<SupportAsk, 'via'>): { via: DeliveryVia; at: number; peerIds: string[] }[] {
  const marks = Object.entries(ask.via ?? {})
  return DELIVERY_VIA.flatMap((via) => {
    const m = marks.filter(([, v]) => v.via === via)
    return m.length ? [{ via, at: Math.max(...m.map(([, v]) => v.at)), peerIds: m.map(([id]) => id) }] : []
  })
}
