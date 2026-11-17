// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 1, D-P02, Jakob 2026-11-18: "ask_answer ... and mcp should be able to access everything"). ask_answer answers an incoming ask
 * the way its card does (plain Share / Not now; the "Do you know someone who has this?" tip with the optional "who has it" name; the "may I show
 * you" yes / no) by queueing the registry action 'ask-answer' for the open app (only the app holds the reply keys and the uniform reply schedule,
 * I3); asks_incoming_list reads the held prompts. The read tools the full-access audit found missing: events, chats, groups, relations, tasks,
 * invitations, meetings (text only: contact channels and keys are never returned); chat_send queues 'chat-send'.
 */
import type { HeldAsk } from '../../trustweb/src/model.ts'
import { addScoped, type Scope } from '../../trustweb/src/resource_scope.ts'
import { eventTagLabel, eventTagSlug } from '../../trustweb/src/event_tag.ts'
import { announce } from './events.ts'
import { commitTo, findPerson, load, needText, schema, S, type Person, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const iso = (ms: unknown): string | null => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null)
const nameOf = (r: Rec, id: unknown): string => r.people.find((p) => p.id === id)?.name ?? String(id ?? '')

export type AskKind = 'show' | 'know' | 'intro' | 'share'
const kindOf = (h: HeldAsk): AskKind => (h.show ? 'show' : h.know ? 'know' : h.intro ? 'intro' : 'share')
/** held_asks.ts LATE_KEEP_MS (late_answers.ts): a held prompt older than this is gone (that module is not loadable under plain node). */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** The prompts still waiting for my answer, oldest first (a yes already given waits only for its moment). */
const openAsks = (r: Rec, now: number): HeldAsk[] => list<HeldAsk>(r.heldAsks)
  .filter((h) => h && typeof h.qid === 'string' && typeof h.receivedAt === 'number' && now - h.receivedAt <= KEEP_MS && h.yesAt === undefined && Array.isArray(h.matches))
  .sort((a, b) => a.receivedAt - b.receivedAt)

interface Ev extends Obj { id: string; name: string; from?: string; where?: string; hosts?: string[]; communityId?: string; community?: string; roles?: unknown; resources?: { text: string }[]; conditions?: string; themes?: string[] }
const events = (r: Rec): Ev[] => list<Ev>(r.events)
const attendeesOf = (r: Rec, id: string): Person[] => r.people.filter((p) => list<string>(p.events).includes(id) && p.deleted_at === undefined)
function findEvent(r: Rec, q: unknown): Ev {
  const key = needText(q, 'event')
  const e = events(r).find((x) => x.id === key) ?? events(r).find((x) => x.name.toLowerCase() === key.toLowerCase())
  if (!e) throw new Error(`no event "${key}"`)
  return e
}

interface Msg { dir: string; text: string; at: number }
const chats = (r: Rec): Record<string, { messages?: Msg[]; unread?: number }> => (r.chats && typeof r.chats === 'object' ? r.chats as never : {})

export function a44dTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const queue = (tool: string, type: string, args: Obj): void => announce(o.file, { at: now().toISOString(), kind: 'action', tool, summary: `${type} ${JSON.stringify(args)}`.slice(0, 200), action: { type, args } })
  const read: Tool[] = [
    {
      name: 'asks_incoming_list', description: 'The asks waiting for my answer, oldest first: qid, who asks (from, through), the text, the card kind (share = my matching lines, know = "do you know someone who has this?", show = "may <show> see you?", intro = an introduction ask) and my matching lines. Answer with ask_answer.',
      inputSchema: schema({}),
      run: () => openAsks(load(o.file), now().getTime()).map((h) => ({
        qid: h.qid, from: h.fromName, through: h.through, text: h.text, kind: kindOf(h), receivedAt: iso(h.receivedAt),
        ...(h.show ? { show: h.show } : {}), ...(h.intro ? { intro: h.intro } : {}), matches: h.matches.map((m) => m.text),
      })),
    },
    {
      name: 'events_list', description: 'My events (id, name, from, where, community tag id, how many people are tagged with it).',
      inputSchema: schema({}),
      run: () => { const r = load(o.file); return events(r).map((e) => ({ id: e.id, name: e.name, from: e.from ?? '', where: e.where ?? '', community: e.communityId ?? e.community ?? null, attendees: attendeesOf(r, e.id).length })) },
    },
    {
      name: 'event_get', description: 'One event as its page shows it: name, when, where, hosts, community, the people tagged with it (id, name), roles, resources, conditions, themes.',
      inputSchema: schema({ event: S('event id or exact name') }, ['event']),
      run: (a) => {
        const r = load(o.file)
        const e = findEvent(r, a.event)
        return { id: e.id, name: e.name, from: e.from ?? '', to: e.to ?? null, where: e.where ?? '', hosts: e.hosts ?? [], community: e.communityId ?? e.community ?? null,
          attendees: attendeesOf(r, e.id).map((p) => ({ id: p.id, name: p.name })), roles: e.roles ?? [], resources: (e.resources ?? []).map((x) => x.text), conditions: e.conditions ?? '', themes: e.themes ?? [] }
      },
    },
    {
      name: 'chats_list', description: 'My chat threads, newest first: the person, unread count, the last message and its time. Text only.',
      inputSchema: schema({}),
      run: () => {
        const r = load(o.file)
        return Object.entries(chats(r)).map(([peerId, t]) => {
          const p = r.people.find((x) => x.peerId === peerId)
          const last = list<Msg>(t.messages).at(-1)
          return { person: p?.id ?? null, name: p?.name ?? peerId, unread: t.unread ?? 0, last: last?.text ?? '', lastAt: iso(last?.at), at: last?.at ?? 0 }
        }).sort((x, y) => y.at - x.at).map(({ at: _at, ...row }) => row)
      },
    },
    {
      name: 'chat_read', description: 'The messages of my chat with one person (dir in | out, text, time), oldest first, at most the last 200.',
      inputSchema: schema({ person: S('id or exact name') }, ['person']),
      run: (a) => {
        const r = load(o.file)
        const p = findPerson(r, a.person)
        const t = p.peerId ? chats(r)[String(p.peerId)] : undefined
        return { person: p.id, name: p.name, messages: list<Msg>(t?.messages).slice(-200).map((m) => ({ dir: m.dir, text: m.text, at: iso(m.at) })) }
      },
    },
    {
      name: 'groups_list', description: 'My groups (Groups view): name, members by name, tags.',
      inputSchema: schema({}),
      run: () => { const r = load(o.file); return list<{ id: string; name: string; members?: string[]; tags?: string[] }>(r.groups).map((g) => ({ id: g.id, name: g.name, members: (g.members ?? []).map((m) => nameOf(r, m)), tags: g.tags ?? [] })) },
    },
    {
      name: 'relations_list', description: 'The relations I stated between two people (Relations view): a, b by name and the kind.',
      inputSchema: schema({}),
      run: () => { const r = load(o.file); return list<{ a: string; b: string; kind: string }>(r.relations).filter((x) => x.kind !== 'none').map((x) => ({ a: nameOf(r, x.a), b: nameOf(r, x.b), kind: x.kind })) },
    },
    {
      name: 'tasks_list', description: 'My tasks (Calendar > Tasks): open ones, or all with done:true. id, title, due, people by name, done time.',
      inputSchema: schema({ done: { type: 'boolean', description: 'include ticked tasks' } }),
      run: (a) => { const r = load(o.file); return list<{ id: string; title: string; due?: string; done?: number; people?: string[] }>(r.tasks).filter((t) => a.done === true || t.done === undefined).map((t) => ({ id: t.id, title: t.title, due: t.due ?? null, people: (t.people ?? []).map((p) => nameOf(r, p)), done: iso(t.done) })) },
    },
    {
      name: 'invitations_list', description: 'Invitations I received (Events > invitations): event, host by name, date, status.',
      inputSchema: schema({}),
      run: () => { const r = load(o.file); return list<{ id: string; event?: string; host?: string; date?: string; status: string }>(r.invitations).map((i) => ({ id: i.id, event: i.event ?? '', host: i.host ? nameOf(r, i.host) : '', date: i.date ?? '', status: i.status })) },
    },
    {
      name: 'meetings_list', description: 'My past meetings and memos (Timeline), newest first: about, where, when, duration in minutes, the noted lines (no recording, no transcript).',
      inputSchema: schema({ limit: { type: 'number', description: 'at most this many (default 50)' } }),
      run: (a) => {
        const n = typeof a.limit === 'number' && a.limit > 0 ? Math.min(500, Math.floor(a.limit)) : 50
        return list<{ id: string; about: string; where: string; startedAt: number; durationMs: number; lines?: { text: string }[] }>(load(o.file).meetings)
          .slice().sort((x, y) => y.startedAt - x.startedAt).slice(0, n)
          .map((m) => ({ id: m.id, about: m.about, where: m.where, at: iso(m.startedAt), minutes: Math.round(m.durationMs / 60_000), notes: (m.lines ?? []).map((l) => l.text) }))
      },
    },
  ]
  if (!o.write) return read
  const write: Tool[] = [
    {
      name: 'ask_answer', description: 'Answer an incoming ask (qid from asks_incoming_list) as its card does: answer yes | no. A know card takes the tip as note (required with yes) and, optionally, who has it (that person is asked first whether they may be shown). Queued for the open TrustWeb app, which sends it on the usual reply schedule.',
      inputSchema: schema({ qid: S('qid from asks_incoming_list'), answer: S('yes | no'), note: S('know card: the tip, e.g. "Lena has one"'), who: S('know card, optional: who has it') }, ['qid', 'answer']),
      run: (a) => {
        const qid = needText(a.qid, 'qid')
        const h = openAsks(load(o.file), now().getTime()).find((x) => x.qid === qid)
        if (!h) throw new Error(`no open ask "${qid}" (asks_incoming_list)`)
        if (a.answer !== 'yes' && a.answer !== 'no') throw new Error('answer must be yes or no')
        const yes = a.answer === 'yes'
        const kind = kindOf(h)
        const note = typeof a.note === 'string' ? a.note.trim().slice(0, 200) : ''
        const who = typeof a.who === 'string' ? a.who.trim().slice(0, 80) : ''
        if (kind !== 'know' && note) throw new Error(`a ${kind} card takes no note`)
        if (kind !== 'know' && who) throw new Error(`a ${kind} card takes no who`)
        if (kind === 'know' && yes && !note) throw new Error('a know card needs the tip as note with yes')
        queue('ask_answer', 'ask-answer', { qid, yes, ...(yes && note ? { note } : {}), ...(yes && who ? { who } : {}) })
        return { queued: true, qid, kind, answer: a.answer }
      },
    },
    {
      name: 'chat_send', description: 'Send a chat message to a connected person. Queued for the open TrustWeb app (it holds the keys); shows in the chat once sent.',
      inputSchema: schema({ person: S('id or exact name'), text: S('the message') }, ['person', 'text']),
      run: (a) => {
        const p = findPerson(load(o.file), a.person)
        if (!p.peerId) throw new Error(`${p.name} is not connected (no chat)`)
        const text = needText(a.text, 'text')
        if (text.length > 4000) throw new Error('text is too long')
        queue('chat_send', 'chat-send', { person: p.id, text })
        return { queued: true, person: p.id }
      },
    },
    {
      name: 'resource_add', description: 'Add a resource as the "+ Add resource" row does: into a community (its tag id; only that community sees it) or an event (id or exact name; tagged event_<slug>), else into my plain list. reference:true makes it a reference.',
      inputSchema: schema({ title: S('the resource'), community: S('community tag id'), event: S('event id or exact name'), reference: { type: 'boolean', description: 'a reference (References page)' } }, ['title']),
      run: (a) => {
        const title = needText(a.title, 'title')
        let made: unknown = null
        commitTo(o.file, now, (r) => {
          const inv = (Array.isArray(r.inventory) ? r.inventory : (r.inventory = [])) as never[]
          const id = `mcp${now().getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`
          const page = a.reference === true ? 'references' as const : 'resources' as const
          const source = { kind: 'typed' } as never // Provenance.Typed (model.ts enum; not loadable under plain node)
          let sc: Scope | null = null
          if (typeof a.event === 'string' && a.event.trim()) {
            const e = findEvent(r, a.event)
            const n = (e as { tagName?: string }).tagName ?? e.name
            sc = { kind: 'event', id: e.id, label: eventTagLabel(n), tagIds: [eventTagSlug(n)] }
          } else if (typeof a.community === 'string' && a.community.trim()) sc = { kind: 'community', id: a.community.trim().slice(0, 80), label: a.community.trim() }
          if (sc) made = addScoped(inv, sc, page, title, id, now().getTime(), source)
          else { made = { id, text: title.slice(0, 120), audience: 'fof', included: true, createdAt: now().getTime(), source, ...(page === 'references' ? { kind: 'reference' } : {}) }; inv.push(made as never) }
        })
        return made
      },
    },
  ]
  return [...read, ...write]
}
