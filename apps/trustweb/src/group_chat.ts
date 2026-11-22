// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list: the engine of a group (store: group_store.ts). Built on the event chat's transport (event_group_chat.ts): every op
 * travels as a sealed `event` envelope, here with `gg` (apps/demo wire.ts parseGroupOp), pair key per connected member, over the existing relay.
 *   - no host: every member's device passes a NEW op on to the other members it is connected to (never back to the sender, never to someone
 *     who left). Chat items dedupe by id; list and item ops win only when newer (group_store.ts), so a flood stops by itself;
 *   - an op is taken only from a sender who is a member of a group I hold and did not leave; the actor's name travels as given (the members
 *     vouch for what they pass on);
 *   - wave46 answers-45b (review-45 Q7): a join / leave naming someone other than its sender is taken only from whoever admitted that member
 *     on my device (GMember.adm: me, or the member whose join first told me of them, who then passes their changes on); a join of someone new
 *     records its sender as admitter. Event chats (event_group_chat.ts) and merge-events are not touched.
 *   - in through an invite link scoped to just this group (invite_policy.ts, tag `grp:<id>`): the inviter's device admits the new member (a join
 *     notice to everyone, then the roster, the last GROUP_HISTORY messages, the lists and their items to the new member); the new member's
 *     device holds the group with the inviter from the invite (joined);
 *   - lists: add (to the active list), check / uncheck (who, when; a check posts a quiet `check` line in the chat), move up / down, archive done;
 *     a list change that reached nobody marks the group `dirty` and goes again on retry (the open of the group);
 *   - my other devices get the groups through the sync bundle as the setting `chatGroups`, merged item by item (SETTING_MERGERS below).
 */
import type { EventEnvelope, GroupOp } from '../../demo/src/types'
import type { AppState, Person } from './model'
import { cleanHelloName } from './hello'
import { SETTING_MERGERS } from './sync_core'
import {
  GROUP_ITEM_TEXT_MAX, activeListId, addChatItem, applyItem, applyList, cleanLine, cleanMsg, cleanName, groupsOf, itemOp, liveItems, mergeGroups,
  newGroup, sanitizeGroups, setMember, GROUP_MAX, type ChatGroup, type GItem, type ItemOp, type ListOp,
} from './group_store'

SETTING_MERGERS.set('chatGroups', mergeGroups)

/** A new member gets this many of the latest messages. */
export const GROUP_HISTORY = 20
const SKEW_MS = 5 * 60_000
const ROSTER_MAX = 50
/** The name of the list a new group starts with (strings.ts S.w45gl.firstList by default). */
export const FIRST_LIST = 'Shopping & errands'

const live = (p: Person): boolean => p.deleted_at === undefined && !p.via
const lower = (n: string): string => n.trim().toLowerCase()

export interface GroupChatHost<P extends { id: string }> {
  state(): AppState
  save(): void
  now(): number
  newId(): string
  peers(): P[]
  send(peer: P, env: EventEnvelope): Promise<void>
  /** A group changed: redraw what shows it. */
  changed(groupId: string): void
  /** The name of a new group's first list (default FIRST_LIST). */
  firstList?: string
}

export function createGroupChat<P extends { id: string }>(h: GroupChatHost<P>) {
  const all = (): Record<string, ChatGroup> => groupsOf(h.state())
  const held = (gid: string): ChatGroup | undefined => all()[gid]
  const myName = (): string => cleanName(cleanHelloName(h.state().me.displayName)) || 'TrustWeb'
  const personOf = (peerId: string): Person | undefined => h.state().people.find((p) => p.peerId === peerId && live(p))
  const iAmIn = (g: ChatGroup): boolean => g.mem.me?.on !== false
  const store = (g: ChatGroup): void => {
    const s = h.state()
    s.chatGroups = sanitizeGroups({ ...all(), [g.id]: g })
    h.save()
    h.changed(g.id)
  }
  /** The peers of the members my device reaches: a person id with a connection, who did not leave. */
  const reachable = (g: ChatGroup): string[] => Object.entries(g.mem)
    .filter(([key, m]) => key !== 'me' && !key.startsWith('n:') && m.on)
    .map(([key]) => h.state().people.find((p) => p.id === key && live(p))?.peerId)
    .filter((x): x is string => !!x)

  async function sendTo(peerIds: readonly string[], op: GroupOp): Promise<number> {
    let n = 0
    for (const id of peerIds) {
      const peer = h.peers().find((x) => x.id === id)
      if (peer) await h.send(peer, { v: 1, t: 'event', gg: op }).then(() => { n++ }, () => undefined)
    }
    return n
  }
  const flood = (g: ChatGroup, op: GroupOp, except: readonly string[] = []): Promise<number> => sendTo(reachable(g).filter((id) => !except.includes(id)), op)

  const chatOp = (gid: string, i: GItem): GroupOp => ({ g: gid, m: i.m, k: i.k, by: i.by, ts: i.ts, ...(i.text !== undefined ? { text: i.text } : {}) })
  const listOp = (gid: string, l: ListOp, ts: number, by: string): GroupOp => ({ g: gid, m: h.newId(), k: 'list', by, ts, list: l })
  const itOp = (gid: string, it: ItemOp, ts: number, by: string): GroupOp => ({ g: gid, m: h.newId(), k: 'item', by, ts, it })

  /** Everything about the lists, as ops (a new member; a retry after a change reached nobody). */
  function listSnapshot(g: ChatGroup): GroupOp[] {
    const by = myName()
    const act = activeListId(g)
    const ops = g.lists.map((l) => listOp(g.id, { id: l.id, name: l.name }, l.u, by))
    const a = g.lists.find((l) => l.id === act)
    if (a) ops.push(listOp(g.id, { id: a.id, name: a.name, act: true }, Math.max(g.active?.u ?? 0, a.u), by))
    for (const i of g.li) ops.push(itOp(g.id, itemOp(i), i.u, i.by))
    return ops
  }

  const markSent = (gid: string, m: string): void => {
    const g = held(gid)
    if (g) store({ ...g, items: g.items.map((i) => (i.m === m ? { ...i, state: 'sent' as const } : i)) })
  }
  /** A chat item of mine: kept (pending), sent to everyone, sent when one device took it. */
  async function postMine(g: ChatGroup, k: GItem['k'], text?: string): Promise<GItem> {
    const now = h.now()
    const item: GItem = { m: h.newId(), k, by: myName(), ts: now, at: now, ...(text !== undefined ? { text } : {}), mine: true, state: 'pending' }
    store(addChatItem(g, item).g)
    if ((await flood(g, chatOp(g.id, item))) > 0) markSent(g.id, item.m)
    return held(g.id)?.items.find((i) => i.m === item.m) ?? item
  }
  /** A list or item op of mine: applied here, sent to everyone; reaching nobody marks the group for a retry. */
  async function changeMine(g: ChatGroup, op: GroupOp): Promise<void> {
    const n = await flood(g, op)
    const now = held(g.id)
    if (!now) return
    if (n === 0 && reachable(now).length > 0 && !now.dirty) store({ ...now, dirty: true })
  }
  /** A time newer than `u` (my clock, or just after `u` when my clock is behind). */
  const after = (u: number): number => Math.max(h.now(), u + 1)
  const mine = (gid: string): ChatGroup | null => { const g = held(gid); return g && iAmIn(g) ? g : null }

  return {
    /** A new group with me in it and its first list; the group id, or null (empty name, too many groups). */
    create(rawName: string): string | null {
      if (Object.keys(all()).length >= GROUP_MAX) return null
      const g = newGroup({ id: h.newId(), name: rawName, now: h.now(), listId: h.newId(), listName: h.firstList ?? FIRST_LIST })
      if (!g) return null
      store(g)
      return g.id
    },
    /** The invited one's device, after the connect of a group invite: holds the group with the inviter (personId) as member. */
    joined(gid: string, rawName: string, personId: string): boolean {
      const p = h.state().people.find((x) => x.id === personId && live(x))
      const name = cleanLine(rawName, 60)
      if (!p || !name || !/^[A-Za-z0-9_-]{1,64}$/.test(gid)) return false
      const now = h.now()
      const have = held(gid)
      const base: ChatGroup = have ?? { id: gid, name, at: now, items: [], unread: 0, mem: {}, lists: [], li: [] }
      store(setMember(setMember(base, 'me', '', true, now), p.id, p.name, true, now))
      return true
    },
    /** The inviter's device: a group invite was accepted by personId. Everyone hears of the join; the new member gets the roster, history and lists. */
    async admit(gid: string, personId: string): Promise<boolean> {
      const g = mine(gid)
      const p = h.state().people.find((x) => x.id === personId && live(x))
      if (!g || !p || g.mem[p.id]?.on) return false
      const now = h.now()
      const by = cleanName(p.name) || 'TrustWeb'
      const join: GItem = { m: h.newId(), k: 'join', by, ts: now, at: now }
      const names = [myName(), ...Object.entries(g.mem).filter(([key, m]) => key !== 'me' && key !== p.id && m.on && m.name).map(([, m]) => m.name)].slice(0, ROSTER_MAX)
      const next = addChatItem(setMember(g, p.id, p.name, true, now, 'me'), join).g
      store(next)
      await flood(next, chatOp(gid, join))
      if (!p.peerId) return true
      const ops: GroupOp[] = [
        { g: gid, m: h.newId(), k: 'roster', by: myName(), ts: now, text: g.name, names },
        ...g.items.filter((i) => i.k === 'msg').slice(-GROUP_HISTORY).map((i) => chatOp(gid, i)),
        ...listSnapshot(g),
      ]
      for (const op of ops) await sendTo([p.peerId], op)
      return true
    },
    /** My message; null when I am not in the group or the text is empty / too long. */
    async send(gid: string, raw: string): Promise<GItem | null> {
      const g = mine(gid)
      const text = cleanMsg(raw)
      return g && text ? postMine(g, 'msg', text) : null
    },
    /** I leave (`leaving`) or come back; the others are told. */
    async leave(gid: string, leaving: boolean): Promise<boolean> {
      const g = held(gid)
      if (!g || iAmIn(g) === !leaving) return false
      const now = h.now()
      const item: GItem = { m: h.newId(), k: leaving ? 'leave' : 'join', by: myName(), ts: now, at: now, mine: true, state: 'pending' }
      const next = addChatItem(setMember(g, 'me', '', !leaving, now), item).g
      store(next)
      if ((await flood(next, chatOp(gid, item))) > 0) markSent(gid, item.m)
      return true
    },
    /** A new list (not active); its id, or null. */
    async listCreate(gid: string, rawName: string): Promise<string | null> {
      const g = mine(gid)
      const name = cleanLine(rawName, 60)
      if (!g || !name) return null
      const op = listOp(gid, { id: h.newId(), name }, h.now(), myName())
      const r = applyList(g, op.list as ListOp, op.ts)
      if (!r.changed) return null
      store(r.g)
      await changeMine(r.g, op)
      return (op.list as ListOp).id
    },
    /** The active list of the group (the one the chat header's Active list opens). */
    async setActive(gid: string, listId: string): Promise<boolean> {
      const g = mine(gid)
      const l = g?.lists.find((x) => x.id === listId)
      if (!g || !l || activeListId(g) === l.id) return false
      const op = listOp(gid, { id: l.id, name: l.name, act: true }, after(Math.max(g.active?.u ?? 0, l.u)), myName())
      const r = applyList(g, op.list as ListOp, op.ts)
      if (!r.changed) return false
      store(r.g)
      await changeMine(r.g, op)
      return true
    },
    /** An item at the end of a list (the active one when none is named); its id, or null. */
    async addItem(gid: string, raw: string, listId?: string): Promise<string | null> {
      const g = mine(gid)
      const text = cleanLine(raw, GROUP_ITEM_TEXT_MAX)
      const l = listId ?? (g ? activeListId(g) : undefined)
      if (!g || !text || !l || !g.lists.some((x) => x.id === l)) return null
      const o = Math.max(0, ...g.li.filter((i) => i.l === l).map((i) => i.o)) + 1
      const op = itOp(gid, { id: h.newId(), l, text, o }, h.now(), myName())
      const r = applyItem(g, op.it as ItemOp, op.ts, op.by)
      if (!r.changed) return null
      store(r.g)
      await changeMine(r.g, op)
      return (op.it as ItemOp).id
    },
    /** Check (done, with my name and the time) or uncheck an item; a check posts a quiet line in the chat. */
    async check(gid: string, itemId: string, done: boolean): Promise<boolean> {
      const g = mine(gid)
      const i = g?.li.find((x) => x.id === itemId)
      if (!g || !i || !!i.done === done) return false
      const ts = after(i.u)
      const { done: _was, ...rest } = itemOp(i)
      const op = itOp(gid, { ...rest, ...(done ? { done: { by: myName(), at: ts } } : {}) }, ts, myName())
      const r = applyItem(g, op.it as ItemOp, ts, op.by)
      if (!r.changed) return false
      store(r.g)
      await changeMine(r.g, op)
      if (done) await postMine(held(gid) as ChatGroup, 'check', i.text)
      return true
    },
    /** Moves an open item one place up (-1) or down (1) in its list: it swaps places with its neighbour. */
    async move(gid: string, itemId: string, dir: -1 | 1): Promise<boolean> {
      const g = mine(gid)
      const i = g?.li.find((x) => x.id === itemId && !x.arc)
      if (!g || !i) return false
      const list = liveItems(g, i.l)
      const at = list.findIndex((x) => x.id === i.id)
      const other = list[at + dir]
      if (!other) return false
      // equal orders (two devices added at once) get distinct ones first
      const [oa, ob] = other.o === i.o ? [i.o + dir, i.o] : [other.o, i.o]
      let next = g
      const ops: GroupOp[] = []
      for (const [x, o] of [[i, oa], [other, ob]] as const) {
        const ts = after(x.u)
        const op = itOp(gid, { ...itemOp(x), o }, ts, myName())
        next = applyItem(next, op.it as ItemOp, ts, op.by).g
        ops.push(op)
      }
      store(next)
      for (const op of ops) await changeMine(held(gid) as ChatGroup, op)
      return true
    },
    /** Archives the checked items of a list (the active one when none is named); how many. */
    async archiveDone(gid: string, listId?: string): Promise<number> {
      const g = mine(gid)
      const l = listId ?? (g ? activeListId(g) : undefined)
      if (!g || !l) return 0
      const done = g.li.filter((i) => i.l === l && i.done && !i.arc)
      let next = g
      const ops: GroupOp[] = []
      for (const i of done) {
        const ts = after(i.u)
        const op = itOp(gid, { ...itemOp(i), arc: true }, ts, myName())
        next = applyItem(next, op.it as ItemOp, ts, op.by).g
        ops.push(op)
      }
      if (!ops.length) return 0
      store(next)
      for (const op of ops) await changeMine(held(gid) as ChatGroup, op)
      return ops.length
    },
    /** My messages still waiting go out again, and the lists when a change of mine reached nobody; how many messages went. */
    async retry(gid: string): Promise<number> {
      const g = held(gid)
      if (!g || !iAmIn(g)) return 0
      let n = 0
      for (const i of g.items.filter((x) => x.mine && x.state === 'pending')) if ((await flood(g, chatOp(gid, i))) > 0) { markSent(gid, i.m); n++ }
      if (g.dirty) {
        let sent = 0
        for (const op of listSnapshot(g)) sent += await flood(g, op)
        const now = held(gid)
        if (sent > 0 && now) { const { dirty: _d, ...rest } = now; store(rest) }
      }
      return n
    },
    /** A sealed group op from a connected peer. True when it was new or newer and kept (then it is passed on to the other members). */
    async onEnvelope(peer: { id: string }, op: GroupOp): Promise<boolean> {
      const g = held(op.g)
      const who = personOf(peer.id)
      if (!g || !who || !iAmIn(g)) return false
      const sender = g.mem[who.id]
      const now = h.now()
      const by = cleanName(op.by) || cleanName(who.name) || 'TrustWeb'
      const about = lower(by) === lower(who.name)   // a join / leave of the sender themselves
      if (!sender || (!sender.on && !(op.k === 'join' && about))) return false
      const ts = Math.min(op.ts, now + SKEW_MS)
      let next: ChatGroup
      if (op.k === 'roster') {
        next = g
        for (const n of op.names ?? []) {
          const name = cleanName(n)
          if (name && lower(name) !== lower(myName()) && !Object.values(next.mem).some((m) => lower(m.name) === lower(name))) next = setMember(next, `n:${lower(name)}`, name, true, now, who.id)
        }
        if (next !== g) store(next)
        return next !== g
      }
      if (op.k === 'list' || op.k === 'item') {
        const r = op.k === 'list' ? applyList(g, op.list as ListOp, ts) : applyItem(g, op.it as ItemOp, ts, by)
        if (!r.changed) return false
        next = r.g
      } else {
        // wave46 answers-45b: about someone else -> only from their admitter; someone new -> the sender admits them
        const other = (op.k === 'join' || op.k === 'leave') && !about && lower(by) !== lower(myName())
        const known = other ? Object.entries(g.mem).find(([k, m]) => k !== 'me' && lower(m.name) === lower(by)) : undefined
        if (other && known && known[1].adm !== who.id) return false
        if (other && !known && op.k === 'leave') return false
        const text = op.k === 'msg' ? cleanMsg(op.text) : op.k === 'check' ? cleanLine(op.text, GROUP_ITEM_TEXT_MAX) : null
        if ((op.k === 'msg' || op.k === 'check') && !text) return false
        const r = addChatItem(g, { m: op.m, k: op.k, by, ts, at: now, ...(text ? { text } : {}) })
        if (!r.changed) return false
        next = r.g
        if ((op.k === 'join' || op.k === 'leave') && lower(by) !== lower(myName())) {
          const key = about ? who.id : Object.entries(next.mem).find(([k, m]) => k !== 'me' && lower(m.name) === lower(by))?.[0] ?? `n:${lower(by)}`
          next = setMember(next, key, by, op.k === 'join', now, about ? undefined : who.id)
        }
      }
      store(next)
      await flood(next, op, [peer.id])
      return true
    },
    markRead(gid: string): void {
      const g = held(gid)
      if (g?.unread) { store({ ...g, unread: 0 }) }
    },
  }
}
export type GroupChat = ReturnType<typeof createGroupChat>
