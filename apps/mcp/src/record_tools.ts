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
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
interface Person extends Obj { id: string; name: string; ring: string; context?: string; fields?: Record<string, unknown>; generalNote?: string; lines?: { text: string; notedAt?: number }[]; deleted_at?: string }
interface Rec extends Obj { v: number; people: Person[] }

export interface RecordToolsOptions {
  file: string
  /** Offer the tools that change the record. */
  write: boolean
  /** Only these tool names (absent: all that the write switch allows). */
  allow?: readonly string[]
  now?: () => Date
}

const MAX_NOTE = 5000
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const needText = (v: unknown, what: string): string => { const s = str(v).trim(); if (!s) throw new Error(`${what} is required`); return s }
/** The same rule as import_tags.ts tagSlug (a person tag is the field `fields[<slug>] = 'true'`), without its 'tag' fallback. */
const slug = (label: string): string => label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
const tagsOf = (p: Person): string[] => Object.entries(p.fields ?? {}).filter(([, v]) => String(v) === 'true').map(([k]) => k).sort()
const alive = (r: Rec): Person[] => r.people.filter((p) => p.deleted_at === undefined)
const limitOf = (v: unknown, dflt: number): number => (typeof v === 'number' && v > 0 ? Math.floor(v) : dflt)

function load(file: string): Rec {
  const r = JSON.parse(readFileSync(file, 'utf8')) as Rec
  if (r?.v !== 1 || !Array.isArray(r.people)) throw new Error(`${file} is not a TrustWeb record`)
  return r
}

function findPerson(r: Rec, who: unknown): Person {
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
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })

/** TW_MCP_TOOLS as an allow list: absent = every tool; set (also empty, i.e. every tool switched off in Settings) = only those named. */
export function toolAllow(v: string | undefined): string[] | undefined {
  return v === undefined ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean)
}

export function recordTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())

  /** Applies `change` to a copy of the record, logs the edit, replaces the file. Returns false when nothing changed. */
  function commit(change: (r: Rec) => void): boolean {
    const prev = load(o.file)
    const next = structuredClone(prev)
    change(next)
    const edits = diffRecords(prev as never, next as never, { at: now().toISOString(), previewId: 'mcp' })
    if (!edits.length) return false
    appendFileSync(path.join(path.dirname(o.file), 'dev-edits.jsonl'), edits.map((e) => JSON.stringify(e) + '\n').join(''))
    const tmp = o.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(next))
    renameSync(tmp, o.file)
    return true
  }

  const read: Tool[] = [
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
  ]

  return [...read, ...(o.write ? write : [])].filter((t) => !o.allow || o.allow.includes(t.name))
}
