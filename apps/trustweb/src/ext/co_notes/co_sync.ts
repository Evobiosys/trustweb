// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 (co-notes): a co-created note travels over the notes relay (notes_relay.ts) as the full cleaned document, sealed for each participant. Receiving
 * merges into the local copy (co_doc.merge). Only people this phone knows send or receive (I8). Not live typing: a copy goes out a few seconds after an edit.
 */
import type { Identity } from '../../../../demo/src/did'
import { pollPayloads, postPayload, type RelayDeps } from '../../notes_relay'
import { cleanDoc, merge, type CoBlock, type CoDoc, type Stamp } from './co_doc'
import { forSend } from './co_links'

/** How many co-created notes one phone keeps from others. */
export const CO_DOCS_MAX = 100
export const AUDIT_MAX = 100

/** The relay payload of a document; a plain shared note has no `k`, so old readers never mistake one for the other. */
export const wrapDoc = (doc: CoDoc): { k: 'co'; doc: CoDoc } => ({ k: 'co', doc: forSend(doc) })

export function parseDoc(raw: unknown): CoDoc | null {
  const o = (raw ?? {}) as Record<string, unknown>
  return o.k === 'co' ? cleanDoc(o.doc) : null
}

/** Participants who get my copy: not me, and only people this phone knows (a participant list from outside cannot add recipients). */
export const recipients = (doc: CoDoc, myDid: string, known: (did: string) => boolean): string[] => doc.people.map((p) => p.did).filter((d) => d !== myDid && known(d))

/** Seals the document for each recipient; how many it reached. */
export async function sendDoc(d: RelayDeps, doc: CoDoc, me: Identity, known: (did: string) => boolean): Promise<number> {
  const body = wrapDoc(doc)
  const done = await Promise.all(recipients(doc, me.did, known).map((did) => postPayload(d, body, me, did)))
  return done.filter(Boolean).length
}

/** The co-created notes waiting for me from known senders; plain shared notes stay for their own reader. */
export async function pollDocs(d: RelayDeps, me: Identity, known: (did: string) => boolean): Promise<{ from: string; doc: CoDoc }[]> {
  return (await pollPayloads(d, me, known, parseDoc)).map(({ from, item }) => ({ from, doc: item }))
}

const OWNER_ONLY: readonly (CoDoc['kind'])[] = ['desires', 'memories']
type Group = 'text' | 'place' | 'share' | 'del'
const GROUP_FIELDS: Record<Group, (keyof CoBlock)[]> = { text: ['text'], place: ['parent', 'pos'], share: ['share'], del: ['del'] }

/**
 * What a received copy may change (I8): nobody adds a line in my name or rewrites who wrote a line; in Desires and Memories (each person writes only
 * their own lines) my lines never change from outside, and another person's line changes only under that person's own stamp.
 */
export function guard(local: CoDoc | undefined, incoming: CoDoc, myDid: string): CoDoc {
  const have = new Map((local?.blocks ?? []).map((b) => [b.id, b]))
  const ownerOnly = OWNER_ONLY.includes(local?.kind ?? incoming.kind)
  const byAuthor = (x: CoBlock, g: Group): boolean => (x.st[g]?.[1] ?? x.by.did) === x.by.did
  const blocks = incoming.blocks.flatMap((x): CoBlock[] => {
    const old = have.get(x.id)
    if (!old) return x.by.did === myDid || (ownerOnly && !(['text', 'place', 'share', 'del'] as Group[]).every((g) => byAuthor(x, g))) ? [] : [x]
    if (ownerOnly && old.by.did === myDid) return [old]
    const y: CoBlock = { ...x, by: old.by, at: old.at, st: { ...x.st } }
    if (ownerOnly) {
      for (const g of Object.keys(GROUP_FIELDS) as Group[]) {
        if (byAuthor({ ...x, by: old.by }, g)) continue
        for (const f of GROUP_FIELDS[g]) { if (old[f] === undefined) delete y[f]; else Object.assign(y, { [f]: old[f] }) }
        if (old.st[g]) y.st[g] = old.st[g] as Stamp; else delete y.st[g]
      }
    }
    return [y]
  })
  return { ...incoming, blocks }
}

/** The documents after taking `incoming` from `from`, with a log line; null when ignored (unknown sender, too many) or nothing changed. */
export function receive(local: readonly CoDoc[], from: string, raw: CoDoc, known: (did: string) => boolean, myDid: string): { docs: CoDoc[]; line: string } | null {
  const mine = local.find((d) => d.id === raw.id)
  const incoming = guard(mine, raw, myDid)
  const name = incoming.people.find((p) => p.did === from)?.name ?? from.slice(-8)
  if (mine) {
    if (!known(from) && !mine.people.some((p) => p.did === from)) return null
    const merged = merge(mine, incoming)
    if (JSON.stringify({ ...merged, mode: 0 }) === JSON.stringify({ ...merge(mine, mine), mode: 0 })) return null
    return { docs: local.map((d) => (d.id === mine.id ? merged : d)), line: `Merged "${mine.title}" from ${name}` }
  }
  if (!known(from) || local.length >= CO_DOCS_MAX) return null
  return { docs: [...local, { ...incoming, mode: 'outline' }], line: `Received "${incoming.title}" from ${name}` }
}

/** Appends one human-readable line to the local log (I6), keeping the last AUDIT_MAX. */
export const audit = (log: readonly string[] | undefined, line: string, now: number): string[] => [...(log ?? []), `${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} ${line}`].slice(-AUDIT_MAX)

/** Own-device sync (sync_core SETTING_MERGERS): the lists of two of my devices, document by document; what the other device sent is cleaned first. */
export function mergeCoNotes(mine: unknown, theirs: unknown): CoDoc[] {
  const docs = new Map<string, CoDoc>()
  for (const raw of [...(Array.isArray(mine) ? mine : []), ...(Array.isArray(theirs) ? theirs : [])].slice(0, CO_DOCS_MAX * 2)) {
    const d = cleanDoc(raw)
    if (d) docs.set(d.id, docs.has(d.id) ? merge(docs.get(d.id) as CoDoc, d) : d)
  }
  return [...docs.values()].slice(0, CO_DOCS_MAX)
}
