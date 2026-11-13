// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-support (POLICY P02, MCP parity): everything the Community view and the support ask offer a person, as tools over the
 * record file: communities (list, create, kind, members, left-column settings) and asks for support (ask, cancel, inbox).
 * The record has no network: support_ask writes the ask marked `queued`, and the app shows a card; the person's tap on Send sends it (support_flush.ts, I9);
 * support_cancel marks `cancelled`, and the app tells the people it went to. Counts come back, never names of recipients.
 */
import { NAV, addMember, canEditSettings, metaOf, parseCommunity, setKind, setSettings } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import type { CommunityData, CommunityKind } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
interface Person extends Obj { id: string; name: string; ring: string; peerId?: string; fields?: Record<string, unknown>; deleted_at?: string }
interface Ask extends Obj { id: string; chips: string[]; note: string; until: number; to: string[]; here: string[]; queued?: true; agent?: true; cancelled?: true }
interface In extends Obj { id: string; peerId: string; chips: string[]; note: string; until: number }
interface Rec extends Obj { people: Person[]; extData?: Record<string, unknown>; supportAsks?: Ask[]; supportIn?: In[] }

export interface CommunityToolsEnv { load: () => Rec; commit: (change: (r: Rec) => void) => boolean; write: boolean; now: () => Date }

const MODULE = 'community-mighty'
const NOTE_MAX = 200
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })
const slug = (s: string): string => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
const alive = (r: Rec): Person[] => r.people.filter((p) => p.deleted_at === undefined)
const holds = (p: Person, tag: string): boolean => String(p.fields?.[tag]) === 'true'
const dataOf = (r: Rec): CommunityData => parseCommunity(r.extData?.[MODULE])
const put = (r: Rec, d: CommunityData): void => { r.extData = { ...r.extData, [MODULE]: d } }
const FRIENDS = ['closest', 'close', 'friend']

function need(r: Rec, v: unknown): string {
  const id = str(v).trim()
  if (!dataOf(r).meta?.[id]) throw new Error(`no community "${id}"`)
  return id
}

function kindOf(v: unknown): CommunityKind {
  if (v !== 'managed' && v !== 'informal') throw new Error('kind must be managed or informal')
  return v
}

function person(r: Rec, who: unknown): Person {
  const key = str(who).trim()
  const hits = alive(r).filter((p) => p.id === key || p.name.trim().toLowerCase() === key.toLowerCase())
  if (hits.length !== 1) throw new Error(hits.length ? `more than one person is named "${key}": use the id` : `no person "${key}"`)
  return hits[0]
}

/** Audience tokens: community:<id> (its members who are Friends or closer, Closest few always), closest-few, closest-allies, or a person (id or exact name). Connected people only. */
function resolve(r: Rec, tokens: readonly unknown[]): string[] {
  const out = new Set<string>()
  for (const t of tokens.map(str)) {
    const live = alive(r).filter((p) => p.peerId)
    if (t.startsWith('community:')) { const id = need(r, t.slice(10)); live.filter((p) => p.ring === 'closest' || (FRIENDS.includes(p.ring) && holds(p, id))).forEach((p) => out.add(p.peerId!)) }
    else if (t === 'closest-few') live.filter((p) => p.ring === 'closest').forEach((p) => out.add(p.peerId!))
    else if (t === 'closest-allies') live.filter((p) => p.ring === 'closest' || p.ring === 'close').forEach((p) => out.add(p.peerId!))
    else { const p = person(r, t); if (p.peerId) out.add(p.peerId) }
  }
  return [...out]
}

export function communityTools(e: CommunityToolsEnv): { read: Tool[]; write: Tool[] } {
  const read: Tool[] = [
    {
      name: 'community_list', description: 'The communities I have: id, name, kind (managed = has organizers; informal = my own representation of a group) and member count.',
      inputSchema: schema({}),
      run: () => { const r = e.load(); return Object.entries(dataOf(r).meta ?? {}).map(([id, m]) => ({ id, name: m.name ?? id, kind: m.kind, members: alive(r).filter((p) => holds(p, id)).length })) },
    },
    {
      name: 'community_settings_get', description: 'Settings of one community: kind, organizers, left-column sections (nav), the Ask for support button (ask) and the last audiences used.',
      inputSchema: schema({ community: S('community id') }, ['community']),
      run: (a) => { const r = e.load(); const id = need(r, a.community); const d = dataOf(r); const m = metaOf(d, id); return { id, kind: m.kind, organizers: m.organizers.length, nav: m.nav ?? NAV.filter((n) => !d.navOff?.includes(n)), ask: m.ask, audiences: m.audiences ?? [], canEdit: canEditSettings(d, id) } },
    },
    {
      name: 'support_inbox', description: 'Every open ask for support in one list: mine (with how many I asked and how many said they are here) and the ones sent to me.',
      inputSchema: schema({}),
      run: () => {
        const r = e.load()
        const now = e.now().getTime()
        const mine = (r.supportAsks ?? []).filter((x) => x.until > now && !x.cancelled).map((x) => ({ kind: 'mine', id: x.id, note: x.note, chips: x.chips, until: x.until, asked: x.to.length, answered: x.here.length }))
        const theirs = (r.supportIn ?? []).filter((x) => x.until > now).map((x) => ({ kind: 'theirs', id: x.id, who: alive(r).find((p) => p.peerId === x.peerId)?.name ?? '', note: x.note, chips: x.chips, until: x.until }))
        return [...mine, ...theirs].sort((a, b) => a.until - b.until)
      },
    },
  ]
  const write: Tool[] = [
    {
      name: 'community_create', description: 'Make a community of that name (managed or informal, default informal); the app defines its tag on its next start. A name that exists changes nothing.',
      inputSchema: schema({ name: S('community name'), kind: S('managed | informal') }, ['name']),
      run: (a) => {
        const name = str(a.name).trim()
        const id = slug(name)
        if (!id) throw new Error('name is required')
        const kind = a.kind === undefined ? 'informal' : kindOf(a.kind)
        let created = false
        e.commit((r) => {
          const d = dataOf(r)
          if (d.meta?.[id]) return
          created = true
          put(r, { ...d, meta: { ...d.meta, [id]: { kind, organizers: kind === 'managed' ? ['me'] : [], name } } })
        })
        return { id, kind: created ? kind : metaOf(dataOf(e.load()), id).kind, created }
      },
    },
    {
      name: 'community_set_kind', description: 'Set a community managed or informal (managed: only its organizers may).',
      inputSchema: schema({ community: S('community id'), kind: S('managed | informal') }, ['community', 'kind']),
      run: (a) => {
        const kind = kindOf(a.kind)
        let id = ''
        e.commit((r) => {
          id = need(r, a.community)
          const d = dataOf(r)
          if (!canEditSettings(d, id)) throw new Error('only an organizer may change this community')
          put(r, setKind(d, id, kind))
        })
        return { id, kind }
      },
    },
    {
      name: 'community_add_member', description: 'Give a person (id or exact name) the membership of a community.',
      inputSchema: schema({ community: S('community id'), person: S('id or exact name') }, ['community', 'person']),
      run: (a) => {
        let out = { id: '', added: false }
        e.commit((r) => { const id = need(r, a.community); const p = person(r, a.person); out = { id: p.id, added: addMember(r.people, p.id, id) } })
        return out
      },
    },
    {
      name: 'community_settings_set', description: 'Change a community\'s left-column sections (nav: home, spaces, events, members, docs, chat) and/or the Ask for support button (ask). Informal: its owner; managed: its organizers.',
      inputSchema: schema({ community: S('community id'), nav: { type: 'array', items: { type: 'string' }, description: 'sections to show' }, ask: { type: 'boolean', description: 'show the Ask for support button' } }, ['community']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const id = need(r, a.community)
          const d = dataOf(r)
          if (!canEditSettings(d, id)) throw new Error('only an organizer may change this community')
          const next = setSettings(d, id, { ...(Array.isArray(a.nav) ? { nav: a.nav as never } : {}), ...(typeof a.ask === 'boolean' ? { ask: a.ask } : {}) })
          put(r, next)
          const m = metaOf(next, id)
          out = { id, ask: m.ask, ...(m.nav ? { nav: m.nav } : {}) }
        })
        return out
      },
    },
    {
      name: 'support_ask', description: 'Ask for support. audience = tokens: community:<id> (its members who are Friends or closer; Closest few always), closest-few, closest-allies, or a person (id or exact name). Connected people only. Queued: the app shows it as a card (Send | Discard) and sends it only when the person taps Send. Returns the count asked.',
      inputSchema: schema({ text: S(`what would help, up to ${NOTE_MAX} characters`), audience: { type: 'array', items: { type: 'string' }, description: 'audience tokens' }, window: S('today (default) | week') }, ['text', 'audience']),
      run: (a) => {
        const text = str(a.text).trim()
        if (!text) throw new Error('text is required')
        const now = e.now()
        const d = new Date(now)
        const until = a.window === 'week' ? now.getTime() + 7 * 86_400_000 : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
        let out: Obj = {}
        e.commit((r) => {
          const to = resolve(r, Array.isArray(a.audience) ? a.audience : [])
          if (!to.length) throw new Error('nobody to ask: no connected person in that audience')
          const id = `mcp${now.getTime().toString(36)}${(r.supportAsks?.length ?? 0).toString(36)}`
          r.supportAsks = [{ id, chips: [], note: text.slice(0, NOTE_MAX), until, to, here: [], queued: true, agent: true }, ...(r.supportAsks ?? [])]
          out = { id, asked: to.length, queued: true, needsTap: true }
        })
        return out
      },
    },
    {
      name: 'support_cancel', description: 'Cancel an ask of mine (by id from support_inbox); the app tells the people it went to on its next start.',
      inputSchema: schema({ id: S('ask id') }, ['id']),
      run: (a) => {
        const id = str(a.id).trim()
        e.commit((r) => {
          const ask = (r.supportAsks ?? []).find((x) => x.id === id && !x.cancelled)
          if (!ask) throw new Error(`no ask "${id}" of mine`)
          if (ask.queued) r.supportAsks = (r.supportAsks ?? []).filter((x) => x !== ask)   // never sent: nobody to tell
          else ask.cancelled = true
        })
        return { id, cancelled: true }
      },
    },
  ]
  return { read, write }
}
