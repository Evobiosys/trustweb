/**
 * The one reactive holder: TrustWeb's record (read only), the CRM's own
 * records, where the record came from, and every change to the CRM's records.
 * Each mutator saves through storage.ts; when the browser refuses to store,
 * saveCrm returns false and the app keeps working in memory.
 *
 * Never writes TrustWeb's key (see storage.ts for why).
 */
import type { AppState } from '../../trustweb/src/model'
import { apply } from './import/intake'
import type { Decision, IntakePlan } from './import/intake'
import { ContactPointKind, InteractionKind, Stage } from './model'
import type { CrmState } from './model'
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
  const trustweb = readTrustWeb()
  const imported = trustweb ? null : readImported()
  const source = trustweb ? Source.TrustWeb : imported ? Source.Imported : Source.Sample
  const app = trustweb ?? imported ?? sampleApp(now)
  let crm = loadCrm(persona)
  if (source === Source.Sample && crmIsEmpty(crm)) {
    crm = sampleCrm(now)
    saveCrm(persona, crm)
  }
  return { app, crm, source, persona }
}

export const store: Store = $state(start())

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
