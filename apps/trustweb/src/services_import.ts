// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * "From other services" (wave 27): files from WhatsApp, LinkedIn and contact exports -> a summary -> a staged batch -> the Curate page.
 * Pure: no DOM, no network, no storage. Nothing reaches the record before the owner accepts a row (I9); message text is never kept (I1).
 * Undo moves people the batch created out of the web (Ring.None) instead of deleting them, and restores rings it changed.
 */
import { findDuplicates, normalizeName } from '../../crm/src/import/dedup'
import { parseFile } from '../../crm/src/import/detect'
import { summariseAll } from '../../crm/src/import/evidence'
import { ContactSource } from '../../crm/src/import/types'
import type { ImportedContact } from '../../crm/src/import/types'
import { isWhatsAppChat, parseWhatsApp } from '../../crm/src/import/whatsapp'
import type { Evidence } from '../../crm/src/import/evidence'
import { Ring } from './model'
import { parsePhoneExport, readPhoneExport } from './phone_export'
import type { PhoneExtras } from './phone_export'
import type { AppState, Person, ServiceBatch, ServiceDone, ServiceRow } from './model'
import { fingerprint } from './safe_text'
import { bulkAcceptable, propose, writeFor } from './zone_proposals'
import type { Choice, Proposal } from './zone_proposals'

type State = Pick<AppState, 'people' | 'serviceImports'>

export interface ServiceFile { name: string; text: string }
export interface ServicePlan {
  files: { name: string; source: ContactSource | null; count: number }[]
  counts: Record<string, number>
  rows: ServiceRow[]
  /** Groups of rows that look like the same person. */
  groups: number
  /** No date had a day above 12: day-first was assumed, the owner may flip it. */
  ambiguous: boolean
  diff: { added: number; changed: number; unchanged: number }
}
export interface PlanOptions { me: string; now: number; dayFirst?: boolean }

const IDS_KEPT = 20
export const SERVICE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp', linkedin: 'LinkedIn', vcard: 'Phone contacts', 'google-csv': 'Google contacts', 'facebook-json': 'Facebook',
}
export const countsLine = (counts: Record<string, number>): string =>
  Object.entries(counts).map(([s, n]) => `${SERVICE_LABEL[s] ?? s} ${n}`).join(', ')

const sigOf = (r: Omit<ServiceRow, 'sig'>, c: ImportedContact): string =>
  fingerprint(JSON.stringify([r.name, c.org, c.title, c.since, c.emails, c.phones, r.n365, r.out, r.in, r.lastTs]))

/** key -> signature of the newest earlier row with that key. */
function knownSigs(s: State): Map<string, string> {
  const known = new Map<string, string>()
  for (const b of [...(s.serviceImports ?? [])].reverse()) for (const r of b.rows) known.set(r.key, r.sig)
  return known
}

/** "WhatsApp Chat with X.txt" / "WhatsApp Chat - X.txt" -> "X". */
const groupName = (file: string): string => file.replace(/\.txt$/i, '').replace(/^WhatsApp Chat( with| -)? ?/i, '').trim() || file

export function planServices(s: State, files: readonly ServiceFile[], o: PlanOptions): ServicePlan {
  const contacts: ImportedContact[] = []
  const evidence: Evidence[] = []
  let ambiguous = false
  const direct = new Set<string>()
  const groupOf = new Map<string, string>()
  const extras = new Map<string, PhoneExtras>()
  const summaries: ServicePlan['files'] = files.map((f) => {
    // Wave 31: the JSON of the phone tool joins the same evidence, group and row logic as a chat .txt.
    const px = parsePhoneExport(f.text)
    if (px) {
      const r = readPhoneExport(px, f.name, o.now)
      r.direct.forEach((x) => direct.add(x))
      r.groupOf.forEach((g, x) => groupOf.set(x, g))
      r.extras.forEach((e, x) => extras.set(x, e))
      contacts.push(...r.contacts)
      evidence.push(...r.evidence)
      return { name: f.name, source: ContactSource.WhatsApp, count: r.contacts.length }
    }
    const parsed = parseFile(f.name, f.text)
    if (!parsed.format && isWhatsAppChat(f.text)) {
      const r = parseWhatsApp(f.text, f.name, { me: o.me, dayFirst: o.dayFirst })
      ambiguous ||= r.dateOrder === 'ambiguous'
      for (const c of r.contacts) (r.group ? groupOf.set(c.sourceRef, groupName(f.name)) : direct.add(c.sourceRef))
      contacts.push(...r.contacts)
      evidence.push(...r.evidence)
      return { name: f.name, source: ContactSource.WhatsApp, count: r.contacts.length }
    }
    contacts.push(...parsed.result.contacts)
    return { name: f.name, source: parsed.format, count: parsed.result.contacts.length }
  })
  const sums = summariseAll(evidence, o.now)
  const have = new Set((s.people ?? []).map((p) => normalizeName(p.name)))
  const grouped = new Set(findDuplicates(contacts).flatMap((g) => g.members))
  const taken = new Set<string>()
  const rows: ServiceRow[] = []
  contacts.forEach((c, i) => {
    // One person in several WhatsApp chats is one row: the evidence of all chats is already summed under the same key.
    if (c.sourceRef.startsWith('wa:') && taken.has(c.sourceRef)) return
    let key = c.sourceRef.startsWith('wa:') ? c.sourceRef : `${c.source}:${normalizeName(c.name)}`
    const first = !taken.has(key)
    if (!first) key += `|${c.sourceRef}`
    taken.add(key)
    const u = sums.get(key)
    const base = {
      key, name: c.name, source: c.source, file: c.file,
      ...(c.since !== undefined ? { since: c.since } : {}), ...(c.org ? { org: c.org } : {}),
      n365: u?.n365 ?? 0, ...(u ? { days: u.days } : {}),
      ...(first && !direct.has(c.sourceRef) && groupOf.has(c.sourceRef) ? { group: groupOf.get(c.sourceRef) } : {}), out: u?.out ?? 0, in: u?.in ?? 0, ...(u?.lastTs !== undefined ? { lastTs: u.lastTs } : {}),
      ids: (u?.ids ?? []).slice(-IDS_KEPT),
      ...(first && extras.has(c.sourceRef) ? { closeness: extras.get(c.sourceRef)!.closeness, ...(extras.get(c.sourceRef)!.items.length ? { items: extras.get(c.sourceRef)!.items } : {}) } : {}),
      ...(grouped.has(i) || have.has(normalizeName(c.name)) ? { dupe: true } : {}),
    }
    rows.push({ ...base, sig: sigOf(base, c) })
  })
  const known = knownSigs(s)
  const diff = { added: 0, changed: 0, unchanged: 0 }
  for (const r of rows) {
    const was = known.get(r.key)
    if (was === undefined) diff.added++
    else if (was === r.sig) diff.unchanged++
    else diff.changed++
  }
  const counts: Record<string, number> = {}
  for (const f of summaries) if (f.source) counts[f.source] = (counts[f.source] ?? 0) + f.count
  return { files: summaries, counts, rows, groups: findDuplicates(contacts).length, ambiguous, diff }
}

/** The yes: the batch is kept for the Curate page. Still nothing in the record. Rows unchanged since an earlier import need no new decision. */
export function commitPlan(s: State, plan: ServicePlan, id: string, now: number): void {
  const known = knownSigs(s)
  const done: Record<string, ServiceDone> = {}
  for (const r of plan.rows) if (known.get(r.key) === r.sig) done[r.key] = { did: 'left' }
  s.serviceImports = [{ id, at: now, counts: plan.counts, rows: plan.rows, done }, ...(s.serviceImports ?? [])]
}

export interface Pending { batchId: string; row: ServiceRow; proposal: Proposal }

/** Rows nobody decided yet, best score first. Each row's own batch is the newest that holds its key. */
export function pendingProposals(s: State, now: number): Pending[] {
  const seen = new Set<string>()
  const list: { batch: ServiceBatch; row: ServiceRow }[] = []
  for (const batch of s.serviceImports ?? []) {
    for (const row of batch.rows) {
      if (seen.has(row.key)) continue
      seen.add(row.key)
      if (!batch.done[row.key]) list.push({ batch, row })
    }
  }
  const byKey = new Map(list.map((x) => [x.row.key, x]))
  return propose(list.map(({ row }) => ({ ...row, personKey: row.key })), now)
    .map((proposal) => ({ batchId: byKey.get(proposal.personKey)!.batch.id, row: byKey.get(proposal.personKey)!.row, proposal }))
}

const contextOf = (r: ServiceRow): string => `Imported from ${SERVICE_LABEL[r.source] ?? r.source}`

/** Accept / Change write the person into the record; Leave only marks the row. An existing person of that name gets the source and keeps their ring unless Change. */
export function decide(s: State, batchId: string, key: string, choice: Choice, now: number, newId: () => string): void {
  const batch = (s.serviceImports ?? []).find((b) => b.id === batchId)
  const row = batch?.rows.find((r) => r.key === key)
  if (!batch || !row || batch.done[key]) return
  if (choice.do === 'leave') { batch.done[key] = { did: 'left' }; return }
  const prop = propose([{ ...row, personKey: key }], now)[0]
  const ring = writeFor(prop, choice, now)!.ring
  const origin = { source: row.source, file: row.file, importedAt: now, key }
  const norm = normalizeName(row.name)
  const mine = s.people.find((p) => p.sources?.some((x) => x.key === key)) ?? s.people.find((p) => normalizeName(p.name) === norm)
  const done: ServiceDone = { did: 'accepted' }
  if (mine) {
    done.personId = mine.id
    done.created = false
    if (!mine.sources?.some((x) => x.key === key)) { mine.sources = [...(mine.sources ?? []), origin]; done.added = true }
    if (choice.do === 'change' && ring !== mine.ring) { done.prevRing = mine.ring; mine.ring = ring; done.wrote = ring }
  } else {
    const p: Person = { id: newId(), name: row.name, context: contextOf(row), ring, metAt: now, lines: [], sources: [origin] }
    s.people.push(p)
    done.personId = p.id
    done.created = true
    done.wrote = ring
  }
  batch.done[key] = done
}

/** Accepts every pending row with no flag; returns how many. */
export function bulkAccept(s: State, now: number, newId: () => string): number {
  const list = pendingProposals(s, now).filter((x) => bulkAcceptable(x.proposal))
  for (const x of list) decide(s, x.batchId, x.row.key, { do: 'accept' }, now, newId)
  return list.length
}

/** Takes the batch away: staged rows go; people it created leave the web (Ring.None, kept); rings it changed come back while they still stand where the decision put them; its source stamps go. */
export function undoBatch(s: State, batchId: string): { restored: number; archived: number; kept: number } {
  const batch = (s.serviceImports ?? []).find((b) => b.id === batchId)
  const out = { restored: 0, archived: 0, kept: 0 }
  if (!batch) return out
  for (const [key, d] of Object.entries(batch.done)) {
    const p = d.personId ? s.people.find((x) => x.id === d.personId) : undefined
    if (!p) continue
    // Only while the person still has the ring the decision wrote; moved or connected since = kept as they are.
    const same = d.wrote === undefined || p.ring === d.wrote
    if (d.created) { if (same) { p.ring = Ring.None; out.archived++ } else out.kept++ }
    else if (d.prevRing !== undefined) { if (same) { p.ring = d.prevRing; out.restored++ } else out.kept++ }
    if (d.created || d.added) p.sources = (p.sources ?? []).filter((x) => x.key !== key)
  }
  s.serviceImports = (s.serviceImports ?? []).filter((b) => b.id !== batchId)
  return out
}
