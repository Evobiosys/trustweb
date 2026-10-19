/**
 * The one reactive holder: TrustWeb's record (rings and family tag are written through the host), the CRM's own
 * records, where the record came from, and every change to the CRM's records.
 * Each mutator saves through storage.ts; when the browser refuses to store,
 * saveCrm returns false and the app keeps working in memory.
 *
 * Never writes TrustWeb's key itself (see storage.ts for why): hosted, the host does, through bridge.ts.
 */
import type { AppState, Person } from '../../trustweb/src/model'
import { host } from './bridge'
import { prefs } from './prefs.svelte'
import { FAMILY_KEY, RING_KEY } from './rings'
import { apply } from './import/intake'
import type { Decision, IntakePlan } from './import/intake'
import { NONRESP_KEY } from './fields'
import type { FieldValue, FieldValues } from './fields'
import { ContactPointKind, deleteArchived, InteractionKind, Stage } from './model'
import type { CrmState, Curation } from './model'
import { emptyCuration } from './curation'
import { joinPoints, linesToAdd, repoint } from './merge'
import { sampleApp, sampleCrm } from './sample'
import {
  Source, clearImported, loadCrm, parseImport, readImported, readTrustWeb, saveCrm, saveImported,
} from './storage'

export interface Store {
  app: AppState
  crm: CrmState
  source: Source
  persona: string
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function crmIsEmpty(crm: CrmState): boolean {
  return crm.interactions.length === 0 && crm.followUps.length === 0
    && Object.keys(crm.stages).length === 0 && Object.keys(crm.contactPoints).length === 0
    && (crm.contacts ?? []).length === 0
}

function start(): Store {
  const persona = 'me'
  const now = Date.now()
  const record = __TW_RECORD__ ? parseImport(__TW_RECORD__) : null
  const trustweb = record ? null : readTrustWeb()
  const imported = record || trustweb ? null : readImported()
  const source = record ? Source.Record : trustweb ? Source.TrustWeb : imported ? Source.Imported : Source.Sample
  const app = record ?? trustweb ?? imported ?? sampleApp(now)
  let crm = loadCrm(persona)
  // Hosted: the ring and the family tag live in the host's record only; edits an older build kept in the Curator's own key are moved over (family) or dropped (ring: the record is newer).
  if (host.record) {
    prefs.filters.hideSources = (app as { hiddenSources?: string[] }).hiddenSources ?? []   // one setting: the record's (Settings "Hide people known only from …")
    for (const [id, edits] of Object.entries(crm.personFields ?? {})) {
      const person = app.people.find((p) => p.id === id)
      if (typeof edits[FAMILY_KEY] === 'boolean' && person && (person.fields as FieldValues | undefined)?.[FAMILY_KEY] !== edits[FAMILY_KEY]) setFamilyIn(person, edits[FAMILY_KEY])
      delete edits[RING_KEY]
      delete edits[FAMILY_KEY]
    }
  }
  if (source === Source.Sample && crmIsEmpty(crm)) {
    crm = sampleCrm(now)
    saveCrm(persona, crm)
  }
  for (const m of crm.merges ?? []) addLines(app.people, m.from, m.into)
  const gone = new Set((crm.hiddenPeople ?? []).map((h) => h.id))
  if (gone.size > 0) {
    for (const p of app.people) if (gone.has(p.id)) hidden.set(p.id, p)
    app.people = app.people.filter((p) => !gone.has(p.id))
  }
  return { app, crm, source, persona }
}

function setFamilyIn(person: Person, on: FieldValue): void {
  person.fields = { ...person.fields, [FAMILY_KEY]: on } as Person['fields']
  if (host.setFamily) host.setFamily(person.id, on === true)
}

/** Adds the note lines of `from` that `into` lacks; returns their ids. */
function addLines(people: Person[], from: string, into: string): string[] {
  const a = people.find((p) => p.id === from)
  const b = people.find((p) => p.id === into)
  if (!a || !b) return []
  const add = linesToAdd(b.lines, a.lines)
  b.lines = [...b.lines, ...add]
  return add.map((l) => l.id)
}

/** People taken out of the in-memory record, so "unhide" can put them back without a reload. */
const hidden = new Map<string, Person>()

export const store: Store = $state(start())

/** Hosted as a tab: the host's record is read again on every visit, and its rings win (every ring set here was lent to it too). */
export function reloadRecord(): void {
  const s = start()
  store.app = s.app
  store.source = s.source
  store.crm = s.crm
}

function persist(): void {
  saveCrm(store.persona, store.crm)
}

/** The record the app would fall back to with no import: TrustWeb's own, else the sample. */
function fallbackApp(): { app: AppState; source: Source } {
  const trustweb = readTrustWeb()
  return trustweb ? { app: trustweb, source: Source.TrustWeb } : { app: sampleApp(Date.now()), source: Source.Sample }
}

export function addInteraction(
  personId: string, kind: InteractionKind, text: string, place?: string, at: number = Date.now(),
): void {
  const trimmedPlace = place?.trim()
  store.crm.interactions.push({
    id: newId(), personId, at, kind, text: text.trim(), ...(trimmedPlace ? { place: trimmedPlace } : {}),
  })
  persist()
}

export function addFollowUp(personId: string, text: string, dueAt: number): void {
  store.crm.followUps.push({ id: newId(), personId, text: text.trim(), dueAt, createdAt: Date.now() })
  persist()
}

export function setFollowUpDone(id: string, done: boolean): void {
  const f = store.crm.followUps.find((x) => x.id === id)
  if (!f) return
  if (done) f.doneAt = Date.now()
  else delete f.doneAt
  persist()
}

export function removeFollowUp(id: string): void {
  store.crm.followUps = store.crm.followUps.filter((f) => f.id !== id)
  persist()
}

export function setStage(lineId: string, stage: Stage): void {
  store.crm.stages[lineId] = stage
  persist()
}

export function addContactPoint(personId: string, kind: ContactPointKind, value: string): void {
  const list = store.crm.contactPoints[personId] ?? []
  store.crm.contactPoints[personId] = [...list, { kind, value: value.trim() }]
  persist()
}

export function removeContactPoint(personId: string, index: number): void {
  const list = store.crm.contactPoints[personId]
  if (!list || index < 0 || index >= list.length) return
  const next = list.filter((_, i) => i !== index)
  if (next.length > 0) store.crm.contactPoints[personId] = next
  else delete store.crm.contactPoints[personId]
  persist()
}

/** Saves one #person field edit in the CRM's own record (never TrustWeb's). */
export function setField(personId: string, key: string, value: FieldValue): void {
  // Hosted, the ring and the family tag are person.ring / person.fields in the host's record (also the Web view's), never in the Curator's key.
  const person = host.setRing ? store.app.people.find((p) => p.id === personId) : undefined
  if (person && key === RING_KEY && typeof value === 'string') {
    person.ring = value as Person['ring']
    delete (person as { ringSuggested?: boolean }).ringSuggested
    host.setRing?.(personId, value)
    return
  }
  if (person && key === FAMILY_KEY && typeof value === 'boolean') {
    setFamilyIn(person, value)
    return
  }
  if (person && key === NONRESP_KEY && typeof value === 'boolean') {
    person.fields = { ...person.fields, [key]: value } as unknown as Person['fields']
    host.setFlag?.(personId, key, value)
    return
  }
  // Assign first, then write through the store: a local taken before the assignment would be the raw object, not the reactive one, and the edit would never be saved.
  store.crm.personFields ??= {}
  store.crm.personFields[personId] = { ...store.crm.personFields[personId], [key]: value }
  persist()
}

/** Takes the person out of every list at once and remembers them for Settings. */
export function hidePerson(personId: string): void {
  const p = store.app.people.find((x) => x.id === personId)
  if (!p) return
  const snapshot = $state.snapshot(p) as Person
  hidden.set(personId, snapshot)
  store.app.people = store.app.people.filter((x) => x.id !== personId)
  store.crm.hiddenPeople = [...(store.crm.hiddenPeople ?? []), { id: personId, name: p.name, person: snapshot }]
  host.removePerson?.(personId)
  persist()
}

export function unhidePerson(personId: string): void {
  const p = hidden.get(personId) ?? store.crm.hiddenPeople?.find((h) => h.id === personId)?.person
  // An archived invitation (trustweb pendingInvite) was never connected: the host reopens its add sheet instead of listing it.
  if (p) { if (!p.pendingInvite) store.app.people.push(p); host.restorePerson?.(p) }
  hidden.delete(personId)
  store.crm.hiddenPeople = (store.crm.hiddenPeople ?? []).filter((h) => h.id !== personId)
  persist()
}

export function deleteHidden(personId: string): void {
  hidden.delete(personId)
  deleteArchived(store.crm, personId)
  persist()
}

/** Saves the person's own wording of a note line (the record's line stays as it was) or the time they said it is still true. */
export function editLine(lineId: string, change: { text?: string; checkedAt?: number }): void {
  const all = store.crm.lineEdits ?? (store.crm.lineEdits = {})
  all[lineId] = { ...all[lineId], ...change }
  persist()
}

/** Changes the curation (networks, who curates when, their placements) in the CRM's own record. */
export function curate(change: (c: Curation) => void): void {
  const c = store.crm.curation ?? (store.crm.curation = emptyCuration())
  change(c)
  persist()
}

/** Folds `from` into `into`: lines, interactions, follow-ups and contact points move over (`from` is hidden by the caller). Returns what puts it back. */
export function mergeRecords(from: string, into: string): () => void {
  const lines = addLines(store.app.people, from, into)
  const interactions = repoint(store.crm.interactions, from, into)
  const followUps = repoint(store.crm.followUps, from, into)
  const points = store.crm.contactPoints
  const before = { from: points[from], into: points[into] }
  const joined = joinPoints(points[into], points[from])
  delete points[from]
  if (joined.length > 0) points[into] = joined
  store.crm.merges = [...(store.crm.merges ?? []), { from, into }]
  persist()
  return () => {
    const keep = store.app.people.find((p) => p.id === into)
    if (keep) keep.lines = keep.lines.filter((l) => !lines.includes(l.id))
    for (const x of store.crm.interactions) if (interactions.includes(x.id)) x.personId = from
    for (const x of store.crm.followUps) if (followUps.includes(x.id)) x.personId = from
    for (const [id, list] of [[from, before.from], [into, before.into]] as const) {
      if (list) points[id] = list
      else delete points[id]
    }
    store.crm.merges = (store.crm.merges ?? []).filter((m) => m.from !== from || m.into !== into)
    persist()
  }
}

/** Takes a TrustWeb export as the record to read. False when the text is not one. */
export function importText(text: string): boolean {
  const app = parseImport(text)
  if (!app) return false
  saveImported(app)
  store.app = app
  store.source = Source.Imported
  return true
}

export function forgetImport(): void {
  clearImported()
  const next = fallbackApp()
  store.app = next.app
  store.source = next.source
}

/** Saves `next` first and swaps it in only when the browser took it; false = storage full, nothing changed. */
function commitCrm(next: CrmState): boolean {
  if (!saveCrm(store.persona, next)) return false
  store.crm = next
  return true
}

/** Writes the reviewed plan into the CRM's own record. False when the browser refuses to store it. */
export function importContacts(plan: IntakePlan, decisions: Readonly<Record<number, Decision>>): boolean {
  const crm = $state.snapshot(store.crm)
  const before = crm.contacts ?? []
  const contacts = apply(before, plan, decisions, () => `local:${newId()}`)
  const files = plan.files.filter((f) => f.format !== null).map((f) => f.name)
  return commitCrm({ ...crm, contacts, lastImport: { at: Date.now(), files, added: contacts.length - before.length, before } })
}

export function undoLastImport(): boolean {
  const { lastImport, ...rest } = $state.snapshot(store.crm)
  return lastImport ? commitCrm({ ...rest, contacts: lastImport.before }) : false
}
