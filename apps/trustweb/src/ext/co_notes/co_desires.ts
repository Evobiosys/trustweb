// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 (event-desires): a co-note per event where each participant writes wishes under their own chip. Only the author edits a line, a line leaves the
 * phone only at 'event' or 'zones', and "Combine with my AI" hands exactly those lines to the owner's own endpoint. Pure and DOM-free.
 */
import { dateLabel, todayIso } from '../../events'
import { askEndpointText, configured, type FetchLike } from '../../llm_endpoint'
import type { AiEndpoint } from '../../model'
import { S } from '../../strings'
import { indent, insertAfter, newDoc, tree, type CoBlock, type CoDoc, type CoPerson, type ShareLevel } from './co_doc'
import { chipToken, parseChips } from './co_links'

export type EventKind = 'desires' | 'memories'
const S_ = S.coDesires
const NEXT: Record<ShareLevel, ShareLevel> = { me: 'event', event: 'zones', zones: 'me' }
const MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/
export const SHARE_LABELS: Record<ShareLevel, string> = S_.share
/** Only these levels leave the phone and reach Combine ('zones' counts like 'event' for now). */
const OUT: readonly (ShareLevel | undefined)[] = ['event', 'zones']

/** Desires and memories: one block per person, lines owned by their author. */
export const isEventDoc = (doc: CoDoc): boolean => doc.kind === 'desires' || doc.kind === 'memories'

export const cycleShare = (s: ShareLevel | undefined): ShareLevel => NEXT[s ?? 'me']

/** One document per event and kind: every participant derives the same id, so their copies merge instead of piling up. */
export function desiresDoc(o: { kind: EventKind; ev: { id: string; name: string }; me: CoPerson; others: CoPerson[]; at: number }): CoDoc {
  const base = newDoc({ id: `${o.kind}-${o.ev.id}`.slice(0, 40), title: (o.kind === 'desires' ? S_.desiresTitle : S_.memoriesTitle)(o.ev.name), me: o.me, at: o.at })
  const seen = new Set([o.me.did])
  return { ...base, kind: o.kind, eventId: o.ev.id, people: [o.me, ...o.others.filter((p) => !seen.has(p.did) && seen.add(p.did))] }
}

/** The id of the top-level block holding my chip; the same on every device of mine. */
export const mineId = (me: CoPerson): string => `h-${me.did.slice(-12)}`

/** The top-level block holding my chip (made on first use, shared with the event); its children are my lines. */
export function ensureMine(doc: CoDoc, me: CoPerson, at: number): { doc: CoDoc; id: string } {
  const id = mineId(me)
  const own = doc.blocks.find((b) => b.id === id && !b.del)
  if (own) return { doc, id }
  return insertAfter(doc, null, chipToken(me.name, me.did), me, at, { id, share: 'event' })
}

/** In a desires or memories note only the author changes a block; a plain note stays open to everyone. */
export function canEdit(doc: CoDoc, block: CoBlock | string, me: CoPerson): boolean {
  const b = typeof block === 'string' ? doc.blocks.find((x) => x.id === block) : block
  return !!b && (!isEventDoc(doc) || b.by.did === me.did)
}

/** A line as plain words: chips become "@Name". */
const plain = (text: string): string => parseChips(text).map((p) => ('chip' in p ? `@${p.chip.name}` : p.text)).join('')

/** The lines others may see, grouped under their top-level block's author: shared at 'event' or 'zones', not deleted, not an AI answer, and no private line above them. */
function sharedLines(doc: CoDoc): { name: string; lines: string[] }[] {
  const groups = new Map<string, string[]>()
  let name = ''
  let skip = -1
  for (const r of tree(doc)) {
    if (skip >= 0 && r.depth > skip) continue
    skip = r.ai || !OUT.includes(r.share) ? r.depth : -1
    if (skip >= 0) continue
    if (r.depth === 0) name = r.by.name
    else if (r.text.trim()) groups.set(name, [...(groups.get(name) ?? []), plain(r.text)])
  }
  return [...groups].map(([n, lines]) => ({ name: n, lines }))
}

/** The request for "Combine with my AI"; null when no line is shared. */
export function combinePrompt(doc: CoDoc): { system: string; user: string } | null {
  const groups = sharedLines(doc)
  return groups.length ? { system: S_.combineSystem, user: groups.map((g) => `${g.name}:\n${g.lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n') } : null
}

/** Writes the AI's answer under one new top-level block, marked AI-made and shared with the event. */
export function applyCombined(doc: CoDoc, me: CoPerson, answer: string, model: string, now: number): CoDoc {
  const head = insertAfter(doc, null, S_.combinedTitle(model, dateLabel(todayIso(new Date(now)))), me, now, { share: 'event', ai: true })
  let out = head.doc
  let last = head.id
  for (const line of answer.split(/\r?\n/).map((l) => l.replace(MARKER, '').trim()).filter(Boolean)) {
    const r = insertAfter(out, last, line, me, now, { share: 'event', ai: true })
    // The first line indents under the head; the next ones follow it on the same level.
    out = last === head.id ? indent(r.doc, r.id, me) : r.doc
    last = r.id
  }
  return out
}

/** Asks the owner's endpoint (never another model) and returns the document with the answer; null when no line is shared. Throws with the endpoint's message. */
export async function combine(doc: CoDoc, me: CoPerson, ai: AiEndpoint | undefined, fetchFn: FetchLike | undefined, now: number): Promise<CoDoc | null> {
  const p = combinePrompt(doc)
  if (!p || !configured(ai)) return null
  return applyCombined(doc, me, await askEndpointText(ai, p.system, p.user, fetchFn), ai.model, now)
}
