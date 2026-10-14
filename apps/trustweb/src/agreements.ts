/**
 * Explicit agreements per person (wave 7): lines on a person's card besides the norms we share implicitly. Each has text, a date, a
 * status and an optional expiry. Stored on the Person only (this phone), never matched, relayed, exported or put in a share payload
 * (I1, I8; cascade.ts keeps them out of the ask sources). The other side sees one only when it is PROPOSED through the existing
 * connect channel, a plain chat-envelope text with a marker:
 *     <app url>?agree=1#id=<id>&t=<text>&e=<expiry ms>     (a proposal)
 *     <app url>?agree=1#id=<id>&ok=1                       (the receiver accepted: it is now mutual on both sides)
 * Statuses: mine (only I hold it), proposed (I sent it, waiting), incoming (they sent it, my Accept makes it mutual), mutual.
 * Everything received is untrusted: bounded, stripped of control and bidi characters. Pure and DOM-free.
 */
import { stripUnsafe } from './safe_text'

export enum AgreementStatus { Mine = 'mine', Proposed = 'proposed', Incoming = 'incoming', Mutual = 'mutual' }
export interface Agreement { id: string; text: string; at: number; status: AgreementStatus; expiresAt?: number }
export interface AgreementCarrier { agreements?: Agreement[] }

export const AGREE_PARAM = 'agree'
export const AGREEMENT_MAX = 200
export const AGREEMENTS_PER_PERSON = 30
const ID_MAX = 24
const isStatus = (v: unknown): v is AgreementStatus => Object.values(AgreementStatus).includes(v as AgreementStatus)
const prefix = (appUrl: string): string => `${appUrl}?${AGREE_PARAM}=1#`
const cleanText = (v: unknown): string => (typeof v === 'string' ? [...stripUnsafe(v).replace(/\s+/g, ' ').trim()].slice(0, AGREEMENT_MAX).join('') : '')
const okId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(v) && v.length <= ID_MAX

export const isExpired = (a: Pick<Agreement, 'expiresAt'>, now: number): boolean => a.expiresAt !== undefined && a.expiresAt <= now

/** Adds an agreement of mine; null when the text is empty or the person holds too many. `proposed` marks it as sent for their yes. */
export function addAgreement(person: AgreementCarrier, id: string, text: string, now: number, opts: { proposed?: boolean; expiresAt?: number } = {}): Agreement | null {
  const t = cleanText(text)
  const list = person.agreements ?? []
  if (!t || !okId(id) || list.length >= AGREEMENTS_PER_PERSON || list.some((a) => a.id === id)) return null
  const a: Agreement = { id, text: t, at: now, status: opts.proposed ? AgreementStatus.Proposed : AgreementStatus.Mine }
  if (opts.expiresAt !== undefined && Number.isFinite(opts.expiresAt)) a.expiresAt = opts.expiresAt
  person.agreements = [...list, a]
  return a
}

export function removeAgreement(person: AgreementCarrier, id: string): void {
  person.agreements = (person.agreements ?? []).filter((a) => a.id !== id)
  if (!person.agreements.length) delete person.agreements
}

export function proposalText(appUrl: string, a: Agreement): string {
  const q = new URLSearchParams({ id: a.id, t: a.text })
  if (a.expiresAt !== undefined) q.set('e', String(a.expiresAt))
  return prefix(appUrl) + q.toString()
}

export const acceptText = (appUrl: string, id: string): string => prefix(appUrl) + new URLSearchParams({ id, ok: '1' }).toString()

export const isAgreementText = (appUrl: string, text: string): boolean => typeof text === 'string' && text.startsWith(prefix(appUrl))

export type AgreementMessage = { kind: 'propose'; id: string; text: string; expiresAt?: number } | { kind: 'accept'; id: string }

/** Reads an agreement text; null for anything else. Never throws. */
export function parseAgreementText(appUrl: string, text: string): AgreementMessage | null {
  if (!isAgreementText(appUrl, text) || text.length > 500) return null
  try {
    const q = new URLSearchParams(text.slice(prefix(appUrl).length))
    const id = q.get('id')
    if (!okId(id)) return null
    if (q.get('ok') === '1') return { kind: 'accept', id }
    const t = cleanText(q.get('t'))
    if (!t) return null
    const e = Number(q.get('e'))
    return { kind: 'propose', id, text: t, ...(q.has('e') && Number.isFinite(e) && e > 0 ? { expiresAt: e } : {}) }
  } catch {
    return null
  }
}

/**
 * Applies a message from a connected person. A proposal becomes an "incoming" line (once; the same id again changes nothing); an accept
 * makes MY proposed line with that id mutual. True when the card changed.
 */
export function receiveAgreement(person: AgreementCarrier, msg: AgreementMessage, now: number): boolean {
  const list = person.agreements ?? []
  if (msg.kind === 'accept') {
    const mine = list.find((a) => a.id === msg.id && a.status === AgreementStatus.Proposed)
    if (mine) mine.status = AgreementStatus.Mutual
    return !!mine
  }
  if (list.length >= AGREEMENTS_PER_PERSON || list.some((a) => a.id === msg.id)) return false
  person.agreements = [...list, { id: msg.id, text: msg.text, at: now, status: AgreementStatus.Incoming, ...(msg.expiresAt !== undefined ? { expiresAt: msg.expiresAt } : {}) }]
  return true
}

/** My Accept on an incoming line: it becomes mutual. True when it was incoming. */
export function acceptAgreement(person: AgreementCarrier, id: string): boolean {
  const a = (person.agreements ?? []).find((x) => x.id === id && x.status === AgreementStatus.Incoming)
  if (a) a.status = AgreementStatus.Mutual
  return !!a
}

/** Boot repair: keeps well-formed agreements, drops the rest. True when anything changed. Never throws. */
export function repairAgreements(state: { people?: unknown }): boolean {
  let changed = false
  for (const p of Array.isArray(state.people) ? state.people : []) {
    if (typeof p !== 'object' || p === null || !('agreements' in p)) continue
    const person = p as { agreements?: unknown }
    const raw = Array.isArray(person.agreements) ? person.agreements : []
    const seen = new Set<string>()
    const good = raw.filter((a): a is Agreement => typeof a === 'object' && a !== null && okId(a.id) && !seen.has(a.id) && !!seen.add(a.id)
      && typeof a.text === 'string' && a.text.length > 0 && a.text.length <= AGREEMENT_MAX && typeof a.at === 'number' && isStatus(a.status)
      && (a.expiresAt === undefined || typeof a.expiresAt === 'number')).slice(0, AGREEMENTS_PER_PERSON)
    if (good.length === raw.length && Array.isArray(person.agreements)) continue
    changed = true
    if (good.length) person.agreements = good
    else delete person.agreements
  }
  return changed
}
