// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list: MCP parity for groups (a chat with members, independent of events, with its lists; apps/trustweb/src/group_store.ts,
 * group_chat.ts). group_list / group_read read the record field `chatGroups`; group_create writes a new group into the record; group_invite makes
 * an invite link scoped to just this group (the community invite of invite_tools.ts, tag `grp:<id>`). Everything that travels to the other
 * members is queued for the open app (registry actions in group_chat_actions.ts), which alone holds the pair keys that seal each op.
 */
import { randomBytes } from 'node:crypto'
import { announce } from './events.ts'
import { inviteTools } from './invite_tools.ts'
import { commitTo, load, needText, schema, S, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'
import { GROUP_ITEM_TEXT_MAX, GROUP_NAME_MAX, activeListId, archivedOf, groupTag, liveItems, memberNames, newGroup, sanitizeGroups, type ChatGroup } from '../../trustweb/src/group_store.ts'

type Obj = Record<string, unknown>
const MSG_MAX = 2000
const FIRST_LIST = 'Shopping & errands'
const iso = (ms: number): string => new Date(ms).toISOString()
const newId = (): string => randomBytes(9).toString('base64url')
const groupsIn = (file: string): ChatGroup[] => Object.values(sanitizeGroups(load(file).chatGroups))
const myName = (file: string): string => String((load(file).me as Obj | undefined)?.displayName ?? '')

function findGroup(file: string, q: unknown): ChatGroup {
  const key = needText(q, 'group')
  const all = groupsIn(file)
  const g = all.find((x) => x.id === key) ?? all.find((x) => x.name.toLowerCase() === key.toLowerCase())
  if (!g) throw new Error(`no group "${key}"`)
  return g
}
const findList = (g: ChatGroup, q: unknown): string => {
  const key = needText(q, 'list')
  const l = g.lists.find((x) => x.id === key) ?? g.lists.find((x) => x.name.toLowerCase() === key.toLowerCase())
  if (!l) throw new Error(`no list "${key}" in this group`)
  return l.id
}
const findItem = (g: ChatGroup, q: unknown): string => {
  const key = needText(q, 'item')
  const i = g.li.find((x) => x.id === key) ?? g.li.find((x) => !x.arc && x.text.toLowerCase() === key.toLowerCase())
  if (!i) throw new Error(`no item "${key}" in this group`)
  return i.id
}
const bounded = (v: unknown, what: string, max: number): string => { const t = needText(v, what); if (t.length > max) throw new Error(`${what} is too long`); return t }

export function groupTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const queue = (tool: string, type: string, args: Obj): Obj => {
    announce(o.file, { at: now().toISOString(), kind: 'action', tool, summary: `${type} ${JSON.stringify(args)}`.slice(0, 200), action: { type, args } })
    return { queued: true, ...args }
  }
  const G = S('group id or exact name')
  const read: Tool[] = [
    {
      name: 'group_list', description: 'My groups (chats with members, independent of events, each with lists such as shopping and errands): id, name, members by name (me first), unread messages, whether I left, the active list and how many lists.',
      inputSchema: schema({}),
      run: () => {
        const me = myName(o.file)
        return { groups: groupsIn(o.file).map((g) => ({ id: g.id, name: g.name, members: memberNames(g, me), unread: g.unread, left: g.mem.me?.on === false, activeList: g.lists.find((l) => l.id === activeListId(g))?.name ?? null, lists: g.lists.length })) }
      },
    },
    {
      name: 'group_read', description: 'One group: its chat oldest first (kind msg / join / leave / check, author, text, time, mine, waiting) and every list with its open items in order (id, text, who added it, done by whom and when) and how many are archived.',
      inputSchema: schema({ group: G }, ['group']),
      run: (a) => {
        const g = findGroup(o.file, a.group)
        const act = activeListId(g)
        return {
          group: g.id, name: g.name, members: memberNames(g, myName(o.file)), unread: g.unread, left: g.mem.me?.on === false,
          items: g.items.map((i) => ({ kind: i.k, by: i.by, text: i.text ?? '', at: iso(i.ts), mine: i.mine === true, waiting: i.mine === true && i.state === 'pending' })),
          lists: g.lists.map((l) => ({ id: l.id, name: l.name, active: l.id === act, archived: archivedOf(g, l.id).length, items: liveItems(g, l.id).map((i) => ({ id: i.id, text: i.text, by: i.by, done: i.done ? { by: i.done.by, at: iso(i.done.at) } : null })) })),
        }
      },
    },
  ]
  if (!o.write) return read
  const invite = inviteTools({ ...o, write: true }).find((t) => t.name === 'invite_link_create') as Tool
  return [...read,
    {
      name: 'group_create', description: 'Make a new group (a chat with the people I invite, independent of events) with one list "Shopping & errands" as its active list. Returns {group} (the id). Invite people with group_invite.',
      inputSchema: schema({ name: S('name of the group') }, ['name']),
      run: (a) => {
        const t = now().getTime()
        const g = newGroup({ id: newId(), name: bounded(a.name, 'name', GROUP_NAME_MAX), now: t, listId: newId(), listName: FIRST_LIST })
        if (!g) throw new Error('name is not usable')
        commitTo(o.file, now, (r) => { r.chatGroups = { ...sanitizeGroups(r.chatGroups), [g.id]: g } })
        return { group: g.id, name: g.name }
      },
    },
    {
      name: 'group_invite', description: 'An invite link to just this group: kind "personal" (works once, for the first person who accepts) or "open" (can be passed on, up to max_uses people). The person sees my name and the group before joining; my open app lets them in. Returns {link, id, kind, max, expiresAt}.',
      inputSchema: schema({ group: G, kind: S('"personal" or "open"'), max_uses: { type: 'number', description: 'Open link: how many people (default 10)' }, days: { type: 'number', description: 'Days the link works (default 30)' } }, ['group', 'kind']),
      run: (a) => {
        if (a.kind !== 'personal' && a.kind !== 'open') throw new Error('kind must be "personal" or "open"')
        const g = findGroup(o.file, a.group)
        return invite.run({ kind: a.kind, tag: groupTag(g.id), label: g.name, ...(typeof a.max_uses === 'number' ? { max_uses: a.max_uses } : {}), ...(typeof a.days === 'number' ? { days: a.days } : {}) })
      },
    },
    {
      name: 'group_open', description: 'Open the chat of a group in the TrustWeb app (queued for the open app).',
      inputSchema: schema({ group: G }, ['group']),
      run: (a) => queue('group_open', 'group-open', { group: findGroup(o.file, a.group).id }),
    },
    {
      name: 'group_send', description: 'Send one message into the chat of a group. Queued for the open TrustWeb app, which seals it per member.',
      inputSchema: schema({ group: G, text: S('the message') }, ['group', 'text']),
      run: (a) => queue('group_send', 'group-send', { group: findGroup(o.file, a.group).id, text: bounded(a.text, 'text', MSG_MAX) }),
    },
    {
      name: 'group_leave', description: 'Leave a group (leave true: nothing new reaches me) or join it again (leave false); the others are told. Queued for the open app.',
      inputSchema: schema({ group: G, leave: { type: 'boolean', description: 'true = leave, false = join again' } }, ['group', 'leave']),
      run: (a) => {
        if (typeof a.leave !== 'boolean') throw new Error('leave must be true or false')
        return queue('group_leave', 'group-leave', { group: findGroup(o.file, a.group).id, leave: a.leave })
      },
    },
    {
      name: 'list_create', description: 'Add a list to a group (e.g. "Hardware"). Queued for the open app.',
      inputSchema: schema({ group: G, name: S('name of the list') }, ['group', 'name']),
      run: (a) => queue('list_create', 'list-create', { group: findGroup(o.file, a.group).id, name: bounded(a.name, 'name', GROUP_NAME_MAX) }),
    },
    {
      name: 'list_set_active', description: 'Make a list the active list of its group (the chat header\'s "Active list" opens it). Queued for the open app.',
      inputSchema: schema({ group: G, list: S('list id or exact name') }, ['group', 'list']),
      run: (a) => { const g = findGroup(o.file, a.group); return queue('list_set_active', 'list-set-active', { group: g.id, list: findList(g, a.list) }) },
    },
    {
      name: 'list_add_item', description: 'Add an item at the end of a group list (the active list when none is named). Queued for the open app.',
      inputSchema: schema({ group: G, text: S('the item'), list: S('list id or exact name (optional)') }, ['group', 'text']),
      run: (a) => {
        const g = findGroup(o.file, a.group)
        const text = bounded(a.text, 'text', GROUP_ITEM_TEXT_MAX)
        return queue('list_add_item', 'list-add-item', { group: g.id, text, ...(a.list !== undefined ? { list: findList(g, a.list) } : {}) })
      },
    },
    {
      name: 'list_check', description: 'Check (done true, with my name and the time) or uncheck an item of a group list; a check posts a quiet line in the group chat. Queued for the open app.',
      inputSchema: schema({ group: G, item: S('item id or exact text'), done: { type: 'boolean', description: 'true = done' } }, ['group', 'item', 'done']),
      run: (a) => {
        const g = findGroup(o.file, a.group)
        if (typeof a.done !== 'boolean') throw new Error('done must be true or false')
        return queue('list_check', 'list-check', { group: g.id, item: findItem(g, a.item), done: a.done })
      },
    },
    {
      name: 'list_move', description: 'Move an item of a group list one place up or down. Queued for the open app.',
      inputSchema: schema({ group: G, item: S('item id or exact text'), dir: S('"up" or "down"') }, ['group', 'item', 'dir']),
      run: (a) => {
        const g = findGroup(o.file, a.group)
        if (a.dir !== 'up' && a.dir !== 'down') throw new Error('dir must be "up" or "down"')
        return queue('list_move', 'list-move', { group: g.id, item: findItem(g, a.item), dir: a.dir })
      },
    },
    {
      name: 'list_archive_done', description: 'Archive the checked items of a group list (the active list when none is named). Queued for the open app.',
      inputSchema: schema({ group: G, list: S('list id or exact name (optional)') }, ['group']),
      run: (a) => { const g = findGroup(o.file, a.group); return queue('list_archive_done', 'list-archive-done', { group: g.id, ...(a.list !== undefined ? { list: findList(g, a.list) } : {}) }) },
    },
  ]
}
