// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: the TrustWeb tools over the local record file (the JSON the device sync and the dev server keep, `{ v: 1, people, ... }`).
 * The file is read afresh on every call. Reads leave it untouched. A write (only when `write` is on) first appends its edit to the edit stream
 * beside the file (dev-edits.jsonl, apps/trustweb/scripts/EDIT-STREAM.txt) and then replaces the record atomically; the record is never reset.
 * Contact channels, images and keys are never returned.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { diffRecords } from '../../trustweb/src/record_diff.ts'
import type { AssistantCfg } from '../../trustweb/src/ext/assistant/providers.ts'
import { barTools } from './bar_tools.ts'
import { communityTools } from './community_tools.ts'
import { eventTools } from './event_tools.ts'
import type { Tool } from './protocol.ts'
import { settingsTools } from './settings_tools.ts'

type Obj = Record<string, unknown>
export interface Person extends Obj { id: string; name: string; ring: string; prevRing?: string; context?: string; fields?: Record<string, unknown>; generalNote?: string; lines?: { text: string; notedAt?: number }[]; deleted_at?: string }
export interface InboxRow extends Obj { id: string; at: number; seenAt: number | null }
export interface Rec extends Obj { v: number; people: Person[]; advanced?: { assistant?: AssistantCfg } & Obj; notifInbox?: InboxRow[]; missedPopupOff?: true }

export interface RecordToolsOptions {
  file: string
  /** Offer the tools that change the record. */
  write: boolean
  /** Only these tool names (absent: all that the write switch allows). */
  allow?: readonly string[]
  now?: () => Date
}

const MAX_NOTE = 5000
/** The connect code (connect_code.ts CONNECT_CODE_RE) and the app origins that serve /c/<code> (short_link.ts SHORT_LINK_ORIGINS): repeated here because this file runs under plain node, which cannot load the app's extension-less imports. */
const CODE_RE = /^[A-Za-z0-9_-]{22}$/
const CODE_ORIGIN = 'https://app.trustweb.one'
const CODE_HOSTS = ['app.trustintheweb.org', 'app.trustweb.one']
const heldCode = (r: Rec): string | null => { const c = (r.connectCode as { code?: unknown } | undefined)?.code; return typeof c === 'string' && CODE_RE.test(c) ? c : null }
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
export const needText = (v: unknown, what: string): string => { const s = str(v).trim(); if (!s) throw new Error(`${what} is required`); return s }
/** The same rule as import_tags.ts tagSlug (a person tag is the field `fields[<slug>] = 'true'`), without its 'tag' fallback. */
export const slug = (label: string): string => label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
const tagsOf = (p: Person): string[] => Object.entries(p.fields ?? {}).filter(([, v]) => String(v) === 'true').map(([k]) => k).sort()
const alive = (r: Rec): Person[] => r.people.filter((p) => p.deleted_at === undefined)
const limitOf = (v: unknown, dflt: number): number => (typeof v === 'number' && v > 0 ? Math.floor(v) : dflt)

export function load(file: string): Rec {
  const r = JSON.parse(readFileSync(file, 'utf8')) as Rec
  if (r?.v !== 1 || !Array.isArray(r.people)) throw new Error(`${file} is not a TrustWeb record`)
  return r
}

export function findPerson(r: Rec, who: unknown): Person {
  const key = needText(who, 'person')
  const live = alive(r)
  const byId = live.find((p) => p.id === key)
  if (byId) return byId
  const named = live.filter((p) => p.name.trim().toLowerCase() === key.toLowerCase())
  if (named.length > 1) throw new Error(`more than one person is named "${key}": use the id (${named.map((p) => p.id).join(', ')})`)
  if (!named[0]) throw new Error(`no person "${key}"`)
  return named[0]
}

const row = (p: Person): Obj => ({ id: p.id, name: p.name, zone: p.ring, tags: tagsOf(p) })
export const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
export const S = (description: string): Obj => ({ type: 'string', description })

/** TW_MCP_TOOLS as an allow list: absent = every tool; set (also empty, i.e. every tool switched off in Settings) = only those named. */
export function toolAllow(v: string | undefined): string[] | undefined {
  return v === undefined ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Applies `change` to a copy of the record, logs the edit, replaces the file. Returns false when nothing changed. */
export function commitTo(file: string, now: () => Date, change: (r: Rec) => void): boolean {
  const prev = load(file)
  const next = structuredClone(prev)
  change(next)
  const edits = diffRecords(prev as never, next as never, { at: now().toISOString(), previewId: 'mcp' })
  // Wave 42: a change outside the people (communities, asks for support) has no edit line but is written all the same.
  if (!edits.length && JSON.stringify(prev) === JSON.stringify(next)) return false
  if (edits.length) appendFileSync(path.join(path.dirname(file), 'dev-edits.jsonl'), edits.map((e) => JSON.stringify(e) + '\n').join(''))
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(next))
  renameSync(tmp, file)
  return true
}

export function recordTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())

  const commit = (change: (r: Rec) => void): boolean => commitTo(o.file, now, change)

  /** A setting or the notification inbox: the record file is replaced, nothing goes to the edit stream (it logs people only). */
  function commitSetting(change: (r: Rec) => void): void {
    const next = load(o.file)
    change(next)
    const tmp = o.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(next))
    renameSync(tmp, o.file)
  }

  const read: Tool[] = [
    {
      name: 'connect_code', description: 'This phone\'s connect code and the link it makes (https://<app>/c/<code>): show it as a QR or read it out; the other person types it under Add person. Never returns the secret.',
      inputSchema: schema({}),
      run: () => {
        const r = load(o.file)
        const code = heldCode(r)
        if (!code) return { code: null, note: 'No code yet: open Meet on the phone once, it makes one.' }
        const name = (r.connectCode as { name?: unknown }).name
        return { code, link: `${CODE_ORIGIN}/c/${code}`, ...(typeof name === 'string' && name ? { name } : {}) }
      },
    },
    {
      name: 'connect_redeem', description: 'Checks a code someone gave you (bare, or their /c/ link) and returns the link to open on the phone, where the add sheet connects after your tap. Connecting needs the phone (relay handshake); this changes nothing in the record.',
      inputSchema: schema({ code: S('the 22-character code or the https://<app>/c/<code> link') }, ['code']),
      run: (a) => {
        const raw = str(a.code).trim()
        let code = raw
        const link = /^https:\/\/([^/]+)\/c\/([^/?#]+)/.exec(raw)
        if (link) code = CODE_HOSTS.includes(link[1]) ? link[2] : ''
        if (!CODE_RE.test(code)) return { ok: false, error: 'That is not a TrustWeb code: it has 22 letters and digits, or is a link like https://app.trustweb.one/c/<code>.' }
        if (code === heldCode(load(o.file))) return { ok: false, error: 'That is your own code: give it to the other person instead.' }
        return { ok: true, code, link: `${CODE_ORIGIN}/c/${code}` }
      },
    },
    {
      name: 'list_people', description: 'People in the web (not deleted): id, name, zone (trust ring) and tags. Filter by tag and/or zone.',
      inputSchema: schema({ tag: S('tag name or id'), zone: S('trust zone, e.g. closest, close, friend, acquaintance, intending, none'), limit: { type: 'number', description: 'default 500' } }),
      run: (a) => {
        const tag = a.tag === undefined ? '' : slug(str(a.tag))
        const zone = str(a.zone).trim().toLowerCase()
        return alive(load(o.file)).filter((p) => (!tag || tagsOf(p).includes(tag)) && (!zone || p.ring === zone)).slice(0, limitOf(a.limit, 500)).map(row)
      },
    },
    {
      name: 'get_person', description: 'One person by id or exact name: zone, context, tags, general note and note lines. No contact details.',
      inputSchema: schema({ person: S('id or exact name') }, ['person']),
      run: (a) => {
        const p = findPerson(load(o.file), a.person)
        return { ...row(p), context: p.context ?? '', generalNote: p.generalNote ?? '', notes: (p.lines ?? []).map((l) => ({ text: l.text, at: l.notedAt })) }
      },
    },
    {
      name: 'list_tags', description: 'Every tag with the number of people who hold it.',
      inputSchema: schema({}),
      run: () => {
        const n = new Map<string, number>()
        for (const p of alive(load(o.file))) for (const t of tagsOf(p)) n.set(t, (n.get(t) ?? 0) + 1)
        return [...n].sort(([a], [b]) => a.localeCompare(b)).map(([tag, people]) => ({ tag, people }))
      },
    },
    {
      name: 'list_notes', description: 'The general note and the note lines, of one person or of everyone.',
      inputSchema: schema({ person: S('id or exact name; absent: everyone'), limit: { type: 'number', description: 'default 200' } }),
      run: (a) => {
        const r = load(o.file)
        const people = a.person === undefined ? alive(r) : [findPerson(r, a.person)]
        return people.flatMap((p) => [
          ...(p.generalNote ? [{ person: p.id, name: p.name, kind: 'general', text: p.generalNote }] : []),
          ...(p.lines ?? []).map((l) => ({ person: p.id, name: p.name, kind: 'line', text: l.text, at: l.notedAt })),
        ]).slice(0, limitOf(a.limit, 200))
      },
    },
    {
      name: 'search', description: 'Case-insensitive text search over names, context and notes; says where it matched.',
      inputSchema: schema({ query: S('text to find'), limit: { type: 'number', description: 'default 50' } }, ['query']),
      run: (a) => {
        const q = needText(a.query, 'query').toLowerCase()
        const has = (t: string | undefined): boolean => (t ?? '').toLowerCase().includes(q)
        const hits: Obj[] = []
        for (const p of alive(load(o.file))) {
          const where = [has(p.name) && 'name', has(p.context) && 'context', (has(p.generalNote) || (p.lines ?? []).some((l) => has(l.text))) && 'notes'].filter(Boolean)
          if (where.length) hits.push({ id: p.id, name: p.name, zone: p.ring, in: where })
        }
        return hits.slice(0, limitOf(a.limit, 50))
      },
    },
    {
      name: 'notifications_inbox_list', description: 'The notifications this phone showed (newest first) with seenAt (null: not seen yet), and whether the "Popup for missed notifications" setting is on.',
      inputSchema: schema({ unseenOnly: { type: 'boolean', description: 'only items not seen yet' } }),
      run: (a) => {
        const r = load(o.file)
        const items = [...(r.notifInbox ?? [])].sort((x, y) => y.at - x.at).filter((i) => a.unseenOnly !== true || i.seenAt === null)
        return { popup: r.missedPopupOff !== true, items }
      },
    },
  ]

  const write: Tool[] = [
    {
      name: 'add_note', description: 'Append a dated line to a person\'s general note (logged in the edit stream).',
      inputSchema: schema({ person: S('id or exact name'), text: S(`the note, up to ${MAX_NOTE} characters`) }, ['person', 'text']),
      run: (a) => {
        const text = needText(a.text, 'text')
        if (text.length > MAX_NOTE) throw new Error(`text is too long (${text.length} > ${MAX_NOTE})`)
        let who: Person | undefined
        commit((r) => {
          who = findPerson(r, a.person)
          const line = `${now().toISOString().slice(0, 10)}: ${text}`
          who.generalNote = who.generalNote ? `${who.generalNote}\n${line}` : line
        })
        return { id: who!.id, name: who!.name, added: true }
      },
    },
    {
      name: 'add_tag', description: 'Give a person a tag (created when new); a tag they already hold is left as it is.',
      inputSchema: schema({ person: S('id or exact name'), tag: S('tag name') }, ['person', 'tag']),
      run: (a) => {
        const tag = slug(needText(a.tag, 'tag'))
        if (!tag) throw new Error('tag needs letters or digits')
        let who: Person | undefined
        const added = commit((r) => {
          who = findPerson(r, a.person)
          who.fields = { ...who.fields, [tag]: 'true' }
        })
        return { id: who!.id, name: who!.name, tag, added }
      },
    },
    {
      name: 'remove_person', description: 'Remove a person from the web: a 30-day tombstone (Settings > Recently deleted), never a hard delete. restore_person takes it back.',
      inputSchema: schema({ person: S('id or exact name') }, ['person']),
      run: (a) => {
        let who: Person | undefined
        commit((r) => {
          who = findPerson(r, a.person)
          // The same tombstone as src/deleted_people.ts deletePersonSoft (that file imports the app's model, which node cannot load).
          if (who.ring !== 'none') who.prevRing = who.ring
          who.ring = 'none'
          who.deleted_at = now().toISOString()
        })
        return { id: who!.id, name: who!.name, removed: true }
      },
    },
    {
      name: 'restore_person', description: 'Put a removed person back (within their 30 days) on the ring they had.',
      inputSchema: schema({ person: S('id or exact name of the removed person') }, ['person']),
      run: (a) => {
        const key = needText(a.person, 'person')
        let who: Person | undefined
        commit((r) => {
          const gone = r.people.filter((p) => p.deleted_at !== undefined && (p.id === key || p.name.trim().toLowerCase() === key.toLowerCase()))
          if (gone.length > 1) throw new Error(`more than one removed person is named "${key}": use the id (${gone.map((p) => p.id).join(', ')})`)
          who = gone[0]
          if (!who) throw new Error(`no removed person "${key}"`)
          who.ring = typeof who.prevRing === 'string' && who.prevRing !== 'none' ? who.prevRing : 'unsorted'
          delete who.prevRing
          delete who.deleted_at
        })
        return { id: who!.id, name: who!.name, restored: true }
      },
    },
    {
      name: 'notifications_inbox_mark_seen', description: 'Mark notifications as seen: the named ids, or all of them. Returns how many changed.',
      inputSchema: schema({ ids: { type: 'array', items: { type: 'string' }, description: 'notification ids' }, all: { type: 'boolean', description: 'every unseen one' } }),
      run: (a) => {
        const ids = Array.isArray(a.ids) ? a.ids.map(String) : []
        if (a.all !== true && !ids.length) throw new Error('ids or all is required')
        let marked = 0
        commitSetting((r) => {
          for (const i of r.notifInbox ?? []) if (i.seenAt === null && (a.all === true || ids.includes(i.id))) { i.seenAt = now().getTime(); marked++ }
        })
        return { marked }
      },
    },
    {
      name: 'notifications_popup_set', description: 'Switch "Popup for missed notifications" on or off (on by default).',
      inputSchema: schema({ on: { type: 'boolean', description: 'true: show the popup' } }, ['on']),
      run: (a) => {
        if (typeof a.on !== 'boolean') throw new Error('on must be true or false')
        commitSetting((r) => { if (a.on) delete r.missedPopupOff; else r.missedPopupOff = true })
        return { popup: a.on }
      },
    },
  ]

  const community = communityTools({ load: () => load(o.file) as never, commit: commit as never, write: o.write, now })
  const events = eventTools({ load: () => load(o.file) as never, commit: commit as never, now })
  return [...read, ...community.read, ...(o.write ? [...write, ...community.write, ...events.write] : []), ...barTools(o), ...settingsTools(o)].filter((t) => !o.allow || o.allow.includes(t.name))
}
