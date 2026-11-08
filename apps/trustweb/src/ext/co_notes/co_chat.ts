// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 (co-notes-link): the group chat of one co-note. Every participant of the note is a member; a message travels as a relay payload
 * (`k: 'co-chat'`) sealed for each other participant, exactly like the note itself (co_sync.ts). Only people this phone knows send or are read, and a
 * message counts only in its sender's own name from a participant of that note (I8). Pure but for the two relay calls.
 */
import type { Identity } from '../../../../demo/src/did'
import { randomId } from '../../../../demo/src/crypto'
import { pollPayloads, postPayload, type RelayDeps } from '../../notes_relay'
import { stripUnsafe } from '../../safe_text'
import type { CoDoc, CoPerson } from './co_doc'
import { recipients } from './co_sync'

export const CHAT_KEEP = 200
export const CHAT_TEXT_MAX = 500

export interface CoMsg { id: string; note: string; from: CoPerson; text: string; at: number }

export function newMsg(note: string, from: CoPerson, text: string, at: number): CoMsg | null {
  const t = stripUnsafe(text).trim().slice(0, CHAT_TEXT_MAX)
  return t ? { id: randomId(12), note, from, text: t, at } : null
}

export function cleanMsg(raw: unknown): CoMsg | null {
  const o = (raw ?? {}) as Record<string, unknown>
  const f = (o.from ?? {}) as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id || typeof o.note !== 'string' || !o.note || typeof o.text !== 'string' || typeof f.did !== 'string' || !f.did || typeof f.name !== 'string' || !Number.isFinite(o.at)) return null
  const text = stripUnsafe(o.text).trim().slice(0, CHAT_TEXT_MAX)
  return text ? { id: o.id.slice(0, 40), note: o.note.slice(0, 80), from: { did: f.did.slice(0, 512), name: stripUnsafe(f.name).slice(0, 60) }, text, at: o.at as number } : null
}

/** The list with `m` in it once, oldest first, the last CHAT_KEEP kept. */
export const addMsg = (list: readonly CoMsg[], m: CoMsg): CoMsg[] =>
  (list.some((x) => x.id === m.id) ? [...list] : [...list, m]).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(-CHAT_KEEP)

export const wrapMsg = (msg: CoMsg): { k: 'co-chat'; msg: CoMsg } => ({ k: 'co-chat', msg })

export function parseMsg(raw: unknown): CoMsg | null {
  const o = (raw ?? {}) as Record<string, unknown>
  return o.k === 'co-chat' ? cleanMsg(o.msg) : null
}

/** A message is taken when its note is this one, the relay's sender is a participant, and that sender wrote it in their own name. */
export const acceptMsg = (doc: CoDoc | undefined, sender: string, m: CoMsg): boolean => !!doc && m.note === doc.id && m.from.did === sender && doc.people.some((p) => p.did === sender)

/** Seals `m` for every other participant this phone knows; how many it reached. */
export async function sendMsg(d: RelayDeps, doc: CoDoc, m: CoMsg, me: Identity, known: (did: string) => boolean): Promise<number> {
  const done = await Promise.all(recipients(doc, me.did, known).map((did) => postPayload(d, wrapMsg(m), me, did)))
  return done.filter(Boolean).length
}

/** The chat messages waiting for me from known senders; other payloads stay for their own readers. */
export async function pollChat(d: RelayDeps, me: Identity, known: (did: string) => boolean): Promise<{ from: string; msg: CoMsg }[]> {
  return (await pollPayloads(d, me, known, parseMsg)).map(({ from, item }) => ({ from, msg: item }))
}
