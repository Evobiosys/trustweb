// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 google-contacts-sync: after the one-shot import (preview first, nothing saved before the owner accepts), TrustWeb follows the
 * owner's Google contacts through the People API's incremental sync token. Pure: no DOM, no network (google_contacts.ts fetches).
 * A person is linked to a Google contact by the source key `google-api:people/<id>` the import wrote. Mapped: name, e-mails, phones,
 * photo, labels (Google contact groups) as tags. Conflict rule: per field, the value Google last wrote is kept as `base`; a field the owner
 * changed since (or had typed before the link) stays as the owner has it, every other field follows Google. Nothing is ever deleted here:
 * a contact deleted in Google only counts as `gone`. State lives on this device only (sync_core SYNC_EXCLUDED).
 */
import type { GContact } from './google_contacts'
import { snapOf } from './import_tags'
import { EMAIL_FIELD } from './intending_reminder'
import type { AppState, Person } from './model'
import { toE164 } from './channel'
import { rebaseSnaps } from './services_import'

export type { GContact }

/** The switch lives in google_flag.ts (node-safe, read by the MCP server too). */
export { GOOGLE_CONTACTS_SYNC_ENABLED } from './google_flag'
export const AUTO_SYNC_MS = 15 * 60_000

export interface GoogleSyncRun { at: number; updated: number; kept: number; fresh: number; gone: number }
export interface GoogleSync {
  /** The owner's "Keep in sync". */
  on?: boolean
  syncToken?: string
  /** resource name -> Google's latest version of the contact. */
  seen: Record<string, GContact>
  /** resource name -> the values Google last wanted for the linked person (field key, or NAME). */
  base: Record<string, Record<string, string>>
  last?: GoogleSyncRun
}
type State = Pick<AppState, 'people' | 'serviceImports' | 'googleSync'>

const NAME = ':name'
const PREFIX = 'google-api:'
export const googleKey = (resourceName: string): string => PREFIX + resourceName

const syncOf = (s: State): GoogleSync => (s.googleSync ??= { seen: {}, base: {} })
export const setSyncOn = (s: State, on: boolean): void => { syncOf(s).on = on }

export function autoSyncDue(enabled: boolean, gs: GoogleSync | undefined, token: string | null, now: number): boolean {
  return enabled && !!token && !!gs?.on && (!gs.last || now - gs.last.at >= AUTO_SYNC_MS)
}

/** The resource name a person is linked to, if any. */
const linkOf = (p: Person): string | undefined => p.sources?.find((x) => x.key.startsWith(PREFIX + 'people/'))?.key.slice(PREFIX.length)

/** What Google wants the person to carry; same field names as the import writes (services_import fillFrom). Tag ids hold `true`. */
function wanted(g: GContact, tagOf: (label: string) => string): { want: Record<string, string>; tags: Set<string> } {
  const want: Record<string, string> = {}
  const tags = new Set<string>()
  if (g.name.trim()) want[NAME] = g.name.trim()
  g.emails.forEach((e, i) => { want[i ? `email ${i + 1}` : EMAIL_FIELD] = e })
  ;[...new Set(g.phones.map((x) => toE164(x) ?? x))].forEach((x, i) => { want[i ? `phone ${i + 1}` : 'phone'] = x })
  if (g.photo) want.photo = g.photo
  if (g.labels.length) want.labels = g.labels.join(', ')
  for (const l of g.labels) { const id = tagOf(l); tags.add(id); want[id] = 'true' }
  return { want, tags }
}

const read = (p: Person, k: string): string | undefined => (k === NAME ? p.name : p.fields?.[k] === undefined ? undefined : String(p.fields[k]))

function write(p: Person, k: string, v: string | undefined, tag: boolean): void {
  if (k === NAME) { if (v) p.name = v; return }
  if (v === undefined) { if (p.fields) { delete p.fields[k]; if (!Object.keys(p.fields).length) delete p.fields } return }
  // A tag is a boolean field, as the import and the card write it (services_import giveTags).
  p.fields = { ...p.fields, [k]: tag ? (true as unknown as string) : v }
}

/** Applies Google's version to one linked person; returns [changed, fields kept because the owner edited them]. */
function apply(p: Person, g: GContact, base: Record<string, string> | undefined, tagOf: (label: string) => string): { want: Record<string, string>; changed: boolean; kept: number } {
  const { want, tags } = wanted(g, tagOf)
  let changed = false
  let kept = 0
  for (const k of new Set([...Object.keys(want), ...Object.keys(base ?? {})])) {
    const goal = want[k]
    const now = read(p, k)
    if (goal === now) continue
    // Edited by the owner: differs from what Google last wrote; before any base, any value the owner already had counts as theirs.
    if (base ? now !== base[k] : now !== undefined) { if (goal !== undefined) kept++; continue }
    if (k === NAME && goal === undefined) continue
    write(p, k, goal, tags.has(k) || (goal === undefined && now === 'true'))
    changed = true
  }
  return { want, changed, kept }
}

/**
 * One sync run. `changes`: what Google reported (everything when `full`). Unlinked contacts are only remembered and returned as `fresh`
 * for the import preview. Linked people follow Google per the conflict rule when their contact changed, or once right after they were linked.
 */
export function reconcile(s: State, changes: readonly GContact[], o: { now: number; tagOf: (label: string) => string; full?: boolean; syncToken?: string }): { run: GoogleSyncRun; fresh: GContact[]; changed: string[] } {
  const gs = syncOf(s)
  const touched = new Set(changes.map((c) => c.sourceRef))
  if (o.full) for (const [rn, c] of Object.entries(gs.seen)) if (!touched.has(rn) && !c.deleted) { gs.seen[rn] = { ...c, deleted: true }; touched.add(rn) }
  for (const c of changes) gs.seen[c.sourceRef] = c.deleted ? { ...(gs.seen[c.sourceRef] ?? c), deleted: true } : c
  const linked = new Map<string, Person>()
  for (const p of s.people) { const rn = linkOf(p); if (rn) linked.set(rn, p) }
  const run: GoogleSyncRun = { at: o.now, updated: 0, kept: 0, fresh: 0, gone: 0 }
  const changed: string[] = []
  for (const [rn, p] of linked) {
    const g = gs.seen[rn]
    if (!g || !(touched.has(rn) || !gs.base[rn])) continue
    if (g.deleted) { if (touched.has(rn)) run.gone++; continue }
    const before = snapOf(p)
    const r = apply(p, g, gs.base[rn], o.tagOf)
    gs.base[rn] = r.want
    run.kept += r.kept
    if (r.changed) { run.updated++; changed.push(p.id); rebaseSnaps(s, p.id, before, snapOf(p)) }
  }
  const fresh = changes.filter((c) => !c.deleted && !linked.has(c.sourceRef))
  run.fresh = fresh.length
  if (o.syncToken) gs.syncToken = o.syncToken
  gs.last = run
  return { run, fresh, changed }
}

/** Contacts Google has that are in no import yet (neither linked, nor waiting on the Curate page, nor left there): the "Review new" list. */
export function waitingContacts(s: State): GContact[] {
  const linked = new Set(s.people.map(linkOf).filter(Boolean))
  const staged = new Set((s.serviceImports ?? []).flatMap((b) => b.rows.map((r) => r.key)))
  return Object.values(s.googleSync?.seen ?? {}).filter((c) => !c.deleted && !linked.has(c.sourceRef) && !staged.has(googleKey(c.sourceRef)))
}
