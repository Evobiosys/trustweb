// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * "From other services" (wave 27): files from WhatsApp, LinkedIn and contact exports -> a summary -> a staged batch -> the Curate page.
 * Pure: no DOM, no network, no storage. Nothing reaches the record before the owner accepts a row (I9); message text is never kept (I1).
 * Undo moves people the batch created out of the web (Ring.None) instead of deleting them, and restores rings it changed.
 */
import { findDuplicates, normalizeName, normalizePhone } from '../../crm/src/import/dedup'
import { parseFile } from '../../crm/src/import/detect'
import { autoMap, csvHeaders } from '../../crm/src/import/generic_csv'
import type { CsvMapping } from '../../crm/src/import/generic_csv'
import { summariseAll } from '../../crm/src/import/evidence'
import { ContactSource } from '../../crm/src/import/types'
import type { ImportedContact } from '../../crm/src/import/types'
import { isWhatsAppChat, parseWhatsApp } from '../../crm/src/import/whatsapp'
import type { Evidence } from '../../crm/src/import/evidence'
import { toE164 } from './channel'
import { EMAIL_FIELD } from './intending_reminder'
import { Channel, Ring } from './model'
import { parsePhoneExport, readPhoneExport } from './phone_export'
import type { PhoneExtras } from './phone_export'
import type { AppState, Person, ServiceBatch, ServiceDone, ServiceRow } from './model'
import { DEFAULT_IMPORT_NOTE, importTagId, rowTags, snapOf, tagSlug } from './import_tags'
import { fingerprint } from './safe_text'
import { bulkAcceptable, propose, writeFor } from './zone_proposals'
import type { Choice, Proposal } from './zone_proposals'

type State = Pick<AppState, 'people' | 'serviceImports'>

/** `mapping`: the owner's fixed column mapping, generic CSV only. `contacts`: already parsed (Connect Google). */
export interface ServiceFile { name: string; text: string; mapping?: CsvMapping; contacts?: ImportedContact[] }
export interface ServicePlan {
  /** `headers`/`mapping`: generic CSV only, for the column picker. */
  files: { name: string; source: ContactSource | null; count: number; headers?: string[]; mapping?: CsvMapping }[]
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
  'dex-csv': 'Dex', 'generic-csv': 'Spreadsheet (CSV)', 'google-api': 'Google contacts', mcp: 'MCP server',
}
export const countsLine = (counts: Record<string, number>): string =>
  Object.entries(counts).map(([s, n]) => `${SERVICE_LABEL[s] ?? s} ${n}`).join(', ')

/** WhatsApp ids carry the number without its plus ("436605550401"): write it as a number. Any other number keeps its digits (a leading 0 is a national number, country unknown); "00" is the international prefix. */
const withPlus = (v: string, source: ContactSource): string =>
  toE164(v) ?? (source === ContactSource.WhatsApp && /^[1-9]\d{6,14}$/.test(v) ? `+${v}` : v)
const phoneKey = (v: string): string => toE164(v) ?? normalizePhone(v)
/** The e-mails and phone numbers a person already has (typed or from an earlier import), in comparable form. */
const reachOf = (p: Person): string[] => [
  ...Object.entries(p.fields ?? {}).filter(([k]) => k === EMAIL_FIELD || /^email \d+$/.test(k)).map(([, v]) => v.trim().toLowerCase()),
  ...Object.entries(p.fields ?? {}).filter(([k]) => /^phone( \d+)?$/.test(k)).map(([, v]) => phoneKey(v)),
  ...[p.channels?.[Channel.WhatsApp], p.channels?.[Channel.Signal]].flatMap((v) => (v ? [phoneKey(v)] : [])),
].filter(Boolean)

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
    if (f.contacts) { contacts.push(...f.contacts); return { name: f.name, source: f.contacts[0]?.source ?? ContactSource.GoogleApi, count: f.contacts.length } }
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
    const parsed = parseFile(f.name, f.text, f.mapping)
    if (!parsed.format && isWhatsAppChat(f.text)) {
      const r = parseWhatsApp(f.text, f.name, { me: o.me, dayFirst: o.dayFirst })
      ambiguous ||= r.dateOrder === 'ambiguous'
      for (const c of r.contacts) (r.group ? groupOf.set(c.sourceRef, groupName(f.name)) : direct.add(c.sourceRef))
      contacts.push(...r.contacts)
      evidence.push(...r.evidence)
      return { name: f.name, source: ContactSource.WhatsApp, count: r.contacts.length }
    }
    contacts.push(...parsed.result.contacts)
    const generic = parsed.format === ContactSource.GenericCsv ? { headers: csvHeaders(f.text), mapping: f.mapping ?? autoMap(csvHeaders(f.text)) } : {}
    return { name: f.name, source: parsed.format, count: parsed.result.contacts.length, ...generic }
  })
  const sums = summariseAll(evidence, o.now)
  const have = new Set((s.people ?? []).map((p) => normalizeName(p.name)))
  const reach = new Set((s.people ?? []).flatMap(reachOf))
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
      ...(c.emails.length ? { emails: c.emails } : {}), ...(c.phones.length ? { phones: c.phones.map((x) => withPlus(x, c.source)) } : {}),
      ...(c.title ? { title: c.title } : {}), ...(c.birthday ? { birthday: c.birthday } : {}), ...(c.note ? { note: c.note } : {}), ...(c.labels.length ? { labels: c.labels } : {}),
      ...(grouped.has(i) || have.has(normalizeName(c.name)) || [...c.emails, ...c.phones.map(phoneKey)].some((x) => x && reach.has(x)) ? { dupe: true } : {}),
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
  const chats = Boolean(plan.counts[ContactSource.WhatsApp])
  s.serviceImports = [{ id, at: now, counts: plan.counts, rows: plan.rows, done, tag: importTagId(now, Object.keys(plan.counts)), ...(chats ? {} : { note: DEFAULT_IMPORT_NOTE }) }, ...(s.serviceImports ?? [])]
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

/**
 * What the file knows is written only into empty slots: typed values stay as they are. Extra e-mails and phones go to 'email 2', 'phone 2', ...
 * `reach` false (a same-name person the owner has not confirmed): no e-mail or phone is written. Returns the fields it wrote, for undo.
 */
function fillFrom(p: Person, r: ServiceRow, reach: boolean): Record<string, string> {
  const f = (p.fields ??= {})
  const wrote: Record<string, string> = {}
  const put = (key: string, v: string | undefined): void => { if (v && !f[key]) { f[key] = v; wrote[key] = v } }
  const have = new Set(Object.entries(f).filter(([k]) => k === EMAIL_FIELD || /^email \d+$/.test(k)).map(([, v]) => v.toLowerCase()))
  const nextFree = (base: string, n: number): string => { while (f[n === 1 ? base : `${base} ${n}`]) n++; return n === 1 ? base : `${base} ${n}` }
  for (const e of reach ? r.emails ?? [] : []) {
    if (have.has(e)) continue
    have.add(e)
    put(f[EMAIL_FIELD] ? nextFree('email', 2) : EMAIL_FIELD, e)
  }
  const hasPhone = new Set(Object.entries(f).filter(([k]) => /^phone( \d+)?$/.test(k)).map(([, v]) => phoneKey(v)))
  for (const ph of reach ? r.phones ?? [] : []) {
    if (hasPhone.has(phoneKey(ph))) continue
    hasPhone.add(phoneKey(ph))
    put(nextFree('phone', 1), ph)
  }
  put('organization', r.org)
  put('job title', r.title)
  put('birthday', r.birthday)
  put('note', r.note)
  if (r.labels?.length) put('labels', r.labels.join(', '))
  if (!Object.keys(f).length) delete p.fields
  return wrote
}

/** Gives the person each tag id as a boolean field (as card_small.ts addTagTo does); returns the ids that were new. */
function giveTags(p: Person, ids: readonly string[]): string[] {
  const added = ids.filter((id, i) => ids.indexOf(id) === i && String(p.fields?.[id]) !== 'true')
  if (added.length) p.fields = { ...p.fields, ...Object.fromEntries(added.map((id) => [id, true as unknown as string])) }
  return added
}

/** `connected` chips of a row: people go to `knows` (edges in the Network view), tags to `affiliated` (no membership). Returns what was new. */
function connect(p: Person, chips: readonly string[]): { knows: string[]; affiliated: string[] } {
  const ids = (kind: string): string[] => chips.filter((c) => c.startsWith(`${kind}:`)).map((c) => c.slice(kind.length + 1))
  const knows = ids('person').filter((id) => id !== p.id && !p.knows?.includes(id))
  const affiliated = ids('tag').filter((id) => !p.affiliated?.includes(id))
  if (knows.length) p.knows = [...(p.knows ?? []), ...knows]
  if (affiliated.length) p.affiliated = [...(p.affiliated ?? []), ...affiliated]
  return { knows, affiliated }
}

const rowReach = (r: ServiceRow): string[] => [...(r.emails ?? []).map((e) => e.trim().toLowerCase()), ...(r.phones ?? []).map(phoneKey)].filter(Boolean)

/** Who a row is: the person it was imported as, else the one sharing an e-mail or number (whatever the name's spelling), else a same-name person (`by: 'name'`, unconfirmed). */
export function personFor(s: Pick<AppState, 'people'>, r: ServiceRow): { person: Person; by: 'key' | 'reach' | 'name' } | undefined {
  const byKey = s.people.find((p) => p.sources?.some((x) => x.key === r.key))
  if (byKey) return { person: byKey, by: 'key' }
  const mine = new Set(rowReach(r))
  const byReach = mine.size ? s.people.find((p) => reachOf(p).some((x) => mine.has(x))) : undefined
  if (byReach) return { person: byReach, by: 'reach' }
  const norm = normalizeName(r.name)
  const byName = s.people.find((p) => normalizeName(p.name) === norm)
  return byName ? { person: byName, by: 'name' } : undefined
}

const contextOf = (r: ServiceRow): string => `Imported from ${SERVICE_LABEL[r.source] ?? r.source}`

/** Accept / Change write the person into the record; Leave only marks the row. An existing person of that name gets the source and keeps their ring unless Change. */
export function decide(s: State, batchId: string, key: string, choice: Choice, now: number, newId: () => string, tagOf: (label: string) => string = tagSlug): void {
  const batch = (s.serviceImports ?? []).find((b) => b.id === batchId)
  const row = batch?.rows.find((r) => r.key === key)
  if (!batch || !row || batch.done[key]) return
  if (choice.do === 'leave') { batch.done[key] = { did: 'left' }; return }
  const prop = propose([{ ...row, personKey: key }], now)[0]
  // Wave 39: a ring the owner picked on the Curate page (one row or a bulk step) is what Accept writes.
  const ring = choice.do === 'accept' && row.ring ? row.ring : writeFor(prop, choice, now)!.ring
  const origin = { source: row.source, file: row.file, importedAt: now, key }
  const match = personFor(s, row)
  const mine = match?.person
  const before = mine ? snapOf(mine) : undefined
  const done: ServiceDone = { did: 'accepted' }
  if (mine) {
    done.personId = mine.id
    done.created = false
    if (!mine.sources?.some((x) => x.key === key)) { mine.sources = [...(mine.sources ?? []), origin]; done.added = true }
    const filled = fillFrom(mine, row, match!.by !== 'name' || choice.confirm === true)
    if (Object.keys(filled).length) done.filled = filled
    if ((choice.do === 'change' || row.ring) && ring !== mine.ring) { done.prevRing = mine.ring; mine.ring = ring; done.wrote = ring }
  } else {
    const p: Person = { id: newId(), name: row.name, context: contextOf(row), ring, metAt: now, lines: [], sources: [origin] }
    fillFrom(p, row, true)
    s.people.push(p)
    done.personId = p.id
    done.created = true
    done.wrote = ring
  }
  const who = s.people.find((p) => p.id === done.personId)!
  const tags = giveTags(who, [...rowTags(row).map(tagOf), ...(batch.tag ? [batch.tag] : [])])
  if (tags.length) done.tags = tags
  const links = connect(who, row.connected ?? [])
  if (links.knows.length) done.knows = links.knows
  if (links.affiliated.length) done.affiliated = links.affiliated
  done.snap = snapOf(who)
  if (before !== undefined) rebaseSnaps(s, who.id, before, done.snap)
  batch.done[key] = done
}

/**
 * Wave 39 review: an import or an undo is no edit by the owner. When one changes a person, the other imports' fingerprints of that person
 * that still matched (the owner had not touched them) move along, so "edited since" keeps meaning the owner's own changes.
 */
function rebaseSnaps(s: State, personId: string, from: string, to: string): void {
  if (from === to) return
  for (const b of s.serviceImports ?? []) for (const d of Object.values(b.done)) if (d.personId === personId && d.snap === from) d.snap = to
}

/** Accepts every pending row with no flag; returns how many. */
export function bulkAccept(s: State, now: number, newId: () => string, tagOf?: (label: string) => string): number {
  const list = pendingProposals(s, now).filter((x) => bulkAcceptable(x.proposal))
  for (const x of list) decide(s, x.batchId, x.row.key, { do: 'accept' }, now, newId, tagOf)
  return list.length
}

/**
 * Takes the batch away: staged rows go; people it created leave the web (Ring.None, kept); rings it changed come back; the tags and fields it wrote go; its source stamps go.
 * Wave 39: a person the owner edited since the Accept (`snap` differs) stays exactly as they are, unless `undoEdits`. `keptIds` names them, so the list can highlight them.
 */
export function undoBatch(s: State, batchId: string, opts: { undoEdits?: boolean } = {}): { restored: number; archived: number; kept: number; keptIds: string[] } {
  const batch = (s.serviceImports ?? []).find((b) => b.id === batchId)
  const out = { restored: 0, archived: 0, kept: 0, keptIds: [] as string[] }
  if (!batch) return out
  for (const [key, d] of Object.entries(batch.done)) {
    const p = d.personId ? s.people.find((x) => x.id === d.personId) : undefined
    if (!p) continue
    // Edited since (or, for a batch from before snapshots, moved off the ring the decision wrote) = kept as they are.
    const edited = d.snap !== undefined ? snapOf(p) !== d.snap : d.wrote !== undefined && p.ring !== d.wrote
    if (edited && !opts.undoEdits) { out.kept++; out.keptIds.push(p.id); continue }
    const before = snapOf(p)
    if (d.created) { p.ring = Ring.None; out.archived++ }
    else if (d.prevRing !== undefined) { p.ring = d.prevRing; out.restored++ }
    if (d.created || d.added) p.sources = (p.sources ?? []).filter((x) => x.key !== key)
    if (!d.created && d.filled) {
      for (const [k, v] of Object.entries(d.filled)) if (p.fields?.[k] === v) delete p.fields[k]
      if (p.fields && !Object.keys(p.fields).length) delete p.fields
    }
    for (const id of d.tags ?? []) if (p.fields) delete p.fields[id]
    if (d.knows?.length) p.knows = (p.knows ?? []).filter((x) => !d.knows!.includes(x))
    if (d.affiliated?.length) p.affiliated = (p.affiliated ?? []).filter((x) => !d.affiliated!.includes(x))
    if (p.knows && !p.knows.length) delete p.knows
    if (p.affiliated && !p.affiliated.length) delete p.affiliated
    if (p.fields && !Object.keys(p.fields).length) delete p.fields
    rebaseSnaps(s, p.id, before, snapOf(p))
  }
  s.serviceImports = (s.serviceImports ?? []).filter((b) => b.id !== batchId)
  return out
}
