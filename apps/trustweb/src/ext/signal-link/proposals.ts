// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Signal / Molly import (wave 27): from imported conversation metadata to zone PROPOSALS, and the accept step. Pure, no DOM.
 * Scoring is zone_infer.ts (copied byte-identical from wave27/import-curate). Nothing is written to people before Accept / Change (I9).
 */
import { channelLink, toE164 } from '../../channel'
import { Channel, Ring, type AppState, type Person, type SignalConv, type SignalImport } from '../../model'
import type { ThreadSummary } from '../registry'
import { INFER, score, type Interaction } from '../../zone_infer'

/** The counts a conversation is scored on (zone_infer's Interaction without the optional parts). */
export type Counts = Pick<SignalConv, 'n365' | 'out' | 'in' | 'lastTs'>

/**
 * Friend (>= .6) and Community (>= .35) both map to Ring.Friend, whose label is "Friends and community members": the app's Ring enum has
 * no separate Community ring (a guess that this is the intended landing). Below that: Acquaintance. Never Closest or Close.
 */
export function ringFor(c: Counts, now: number): Ring {
  const i: Interaction = { n365: c.n365, out: c.out, in: c.in, ...(c.lastTs > 0 ? { lastTs: c.lastTs } : {}) }
  return score(i, now).score >= INFER.communityAt ? Ring.Friend : Ring.Acquaintance
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** What the companion sent, reduced to the metadata fields: the word histogram and anything unknown is dropped here, before storing. */
export function stripWords(raw: unknown): SignalConv[] {
  const out: SignalConv[] = []
  for (const r of Array.isArray(raw) ? raw : []) {
    const e164 = typeof r?.e164 === 'string' ? toE164(r.e164) : null
    if (!e164) continue
    out.push({ e164, name: typeof r.name === 'string' ? r.name.slice(0, 80) : '', n365: num(r.n365), out: num(r.out), in: num(r.in), firstTs: num(r.firstTs), lastTs: num(r.lastTs) })
  }
  return out
}

export interface Proposal { e164: string; name: string; ring: Ring; score: number; /** An existing person with this number (no duplicate is made). */ personId?: string }

const signalOf = (p: Pick<Person, 'channels'>): string | null => {
  const v = p.channels?.[Channel.Signal]
  return v ? toE164(v) : null
}

export function findByE164(people: readonly Person[], e164: string): Person | undefined {
  return people.find((p) => signalOf(p) === e164)
}

/** One proposal per conversation, best score first. */
export function proposals(convs: readonly SignalConv[], people: readonly Person[], now: number): Proposal[] {
  return convs.map((c) => {
    const have = findByE164(people, c.e164)
    const sc = score({ n365: c.n365, out: c.out, in: c.in, ...(c.lastTs > 0 ? { lastTs: c.lastTs } : {}) }, now).score
    return { e164: c.e164, name: c.name || c.e164, ring: ringFor(c, now), score: sc, ...(have ? { personId: have.id } : {}) }
  }).sort((a, b) => b.score - a.score)
}

/** Accept / Change: adds the person (with Channel.Signal) or re-rings the one that has this number. Returns the person's id. */
export function acceptProposal(s: Pick<AppState, 'people'>, p: Pick<Proposal, 'e164' | 'name' | 'personId'>, ring: Ring, newId: () => string, now: number): string {
  const have = (p.personId ? s.people.find((x) => x.id === p.personId) : undefined) ?? findByE164(s.people, p.e164)
  if (have) { have.ring = ring; return have.id }
  const id = newId()
  s.people.push({ id, name: p.name || p.e164, context: '', ring, metAt: now, lines: [], channels: { [Channel.Signal]: p.e164 } })
  return id
}

/** The imported conversations as Chat rows, newest first. */
export function threadsOf(imp: SignalImport | undefined, people: readonly Person[]): ThreadSummary[] {
  return [...(imp?.conversations ?? [])].sort((a, b) => b.lastTs - a.lastTs).map((c) => {
    const p = findByE164(people, c.e164)
    return { id: c.e164, title: p?.name || c.name || c.e164, lastAt: c.lastTs, unread: 0, ...(p ? { peerId: p.id } : {}) }
  })
}

/** sgnl:// opens the app where installed (Molly handles it too); the https link is the fallback (messenger_links.ts does the same). */
export function deepLink(e164: string): { href: string; fallback: string } {
  const fallback = channelLink(Channel.Signal, e164)
  return { href: fallback.replace(/^https:/, 'sgnl:'), fallback }
}
