// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list, MCP parity: group_list / group_read (read the record), group_create (record commit), group_invite (a signed invite link
 * scoped to just this group), the rest queued for the open app (registry actions in group_chat_actions.ts). Fake identity and names only.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { createIdentity, serializeIdentity, verifyDidSignature } from '../../../demo/src/did.ts'
import { createActions } from '../../src/actions.ts'
import { defineGroupActions } from '../../src/group_chat_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { inviteOfHash, verifyInvite } from '../../src/invite_policy.ts'

const me = createIdentity('https://relay.example/relay')
const NOW = new Date('2026-11-20T10:00:00Z')
const group = {
  id: 'g1', name: 'Flat', at: 1, unread: 2, mem: { me: { name: '', on: true, at: 1 }, b: { name: 'Ben', on: true, at: 2 }, 'n:cleo': { name: 'Cleo', on: false, at: 3 } },
  items: [{ m: 'a', k: 'msg', by: 'Ben', ts: 1_000, at: 1_000, text: 'tea?' }, { m: 'c', k: 'check', by: 'Ben', ts: 2_000, at: 2_000, text: 'Milk' }],
  lists: [{ id: 'l1', name: 'Shopping & errands', u: 1 }, { id: 'l2', name: 'Hardware', u: 2 }], active: { id: 'l2', u: 3 },
  li: [
    { id: 'i1', l: 'l1', text: 'Milk', o: 1, u: 2_000, by: 'Ana', done: { by: 'Ben', at: 2_000 } },
    { id: 'i2', l: 'l2', text: 'Glue', o: 2, u: 5, by: 'Ana' }, { id: 'i3', l: 'l2', text: 'Screws', o: 1, u: 5, by: 'Ben' },
    { id: 'i4', l: 'l2', text: 'Old', o: 0, u: 5, by: 'Ben', arc: true, done: { by: 'Ben', at: 4 } },
  ],
}
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-w45gl-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], inventory: [], log: [], peers: [], identity: serializeIdentity(me), chatGroups: { g1: group } }))
  return { file, by: Object.fromEntries(allTools({ file, write, now: () => NOW }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('group_list / group_read', () => {
  it('list: name, members, unread, the active list; read: the thread and every list with its open items in order, archived counted', () => {
    const f = fixture(false)
    expect(f.by.group_list.run({})).toEqual({ groups: [{ id: 'g1', name: 'Flat', members: ['Ana', 'Ben'], unread: 2, left: false, activeList: 'Hardware', lists: 2 }] })
    const out = f.by.group_read.run({ group: 'flat' })
    expect(out.items).toEqual([
      { kind: 'msg', by: 'Ben', text: 'tea?', at: new Date(1_000).toISOString(), mine: false, waiting: false },
      { kind: 'check', by: 'Ben', text: 'Milk', at: new Date(2_000).toISOString(), mine: false, waiting: false },
    ])
    expect(out.lists).toEqual([
      { id: 'l1', name: 'Shopping & errands', active: false, archived: 0, items: [{ id: 'i1', text: 'Milk', by: 'Ana', done: { by: 'Ben', at: new Date(2_000).toISOString() } }] },
      { id: 'l2', name: 'Hardware', active: true, archived: 1, items: [{ id: 'i3', text: 'Screws', by: 'Ben', done: null }, { id: 'i2', text: 'Glue', by: 'Ana', done: null }] },
    ])
    expect(() => f.by.group_read.run({ group: 'nope' })).toThrow(/no group/)
  })
})

describe('group_create / group_invite', () => {
  it('create writes a group with me and one active list; empty name refused', () => {
    const f = fixture()
    const out = f.by.group_create.run({ name: 'Choir' })
    const g = f.rec().chatGroups[out.group]
    expect(g).toMatchObject({ name: 'Choir', mem: { me: { on: true } } })
    expect(g.lists).toHaveLength(1)
    expect(g.active.id).toBe(g.lists[0].id)
    expect(() => f.by.group_create.run({ name: ' ' })).toThrow(/name/)
  })
  it('invite: a signed link scoped to just this group (tag grp:<id>, the group name shown)', async () => {
    const f = fixture()
    const out = await f.by.group_invite.run({ group: 'g1', kind: 'personal' })
    const tok = inviteOfHash(new URL(out.link).hash)
    const v = verifyInvite(tok, me.did, NOW.getTime(), (b, s) => verifyDidSignature(me.did, b, s))
    expect(v.ok && v.inv).toMatchObject({ t: 'grp:g1', l: 'Flat', k: 'p' })
    expect(f.rec().invites.map((e) => e.tag)).toEqual(['grp:g1'])
    await expect(async () => f.by.group_invite.run({ group: 'g1', kind: 'x' })).rejects.toThrow(/kind/)
  })
})

describe('queued for the open app', () => {
  it('send, leave, lists and items queue registry actions with the group id; bad input refused', () => {
    const f = fixture()
    f.by.group_open.run({ group: 'Flat' })
    f.by.group_send.run({ group: 'Flat', text: ' hi ' })
    f.by.group_leave.run({ group: 'g1', leave: true })
    f.by.list_create.run({ group: 'g1', name: 'Garden' })
    f.by.list_set_active.run({ group: 'g1', list: 'Shopping & errands' })
    f.by.list_add_item.run({ group: 'g1', text: 'Eggs' })
    f.by.list_check.run({ group: 'g1', item: 'Glue', done: true })
    f.by.list_move.run({ group: 'g1', item: 'i2', dir: 'up' })
    f.by.list_archive_done.run({ group: 'g1' })
    expect(readEvents(f.file, 0).events.map((e) => e.action)).toEqual([
      { type: 'group-open', args: { group: 'g1' } },
      { type: 'group-send', args: { group: 'g1', text: 'hi' } },
      { type: 'group-leave', args: { group: 'g1', leave: true } },
      { type: 'list-create', args: { group: 'g1', name: 'Garden' } },
      { type: 'list-set-active', args: { group: 'g1', list: 'l1' } },
      { type: 'list-add-item', args: { group: 'g1', text: 'Eggs' } },
      { type: 'list-check', args: { group: 'g1', item: 'i2', done: true } },
      { type: 'list-move', args: { group: 'g1', item: 'i2', dir: 'up' } },
      { type: 'list-archive-done', args: { group: 'g1' } },
    ])
    expect(() => f.by.list_add_item.run({ group: 'g1', text: 'x'.repeat(201) })).toThrow(/too long/)
    expect(() => f.by.list_check.run({ group: 'g1', item: 'nope', done: true })).toThrow(/no item/)
    expect(() => f.by.list_move.run({ group: 'g1', item: 'i2', dir: 'left' })).toThrow(/dir/)
    expect(() => f.by.group_leave.run({ group: 'g1', leave: 'yes' })).toThrow(/true or false/)
  })
  it('read-only server: reads only; Settings list and action map know the tools', () => {
    const ro = fixture(false).by
    expect(ro.group_read).toBeTruthy()
    expect(ro.group_create).toBeUndefined()
    expect(MCP_TOOLS).toEqual(expect.arrayContaining([{ name: 'group_list', write: false }, { name: 'group_create', write: true }, { name: 'group_invite', write: true }, { name: 'list_add_item', write: true }, { name: 'list_check', write: true }]))
    for (const [a, t] of [['group-send', 'group_send'], ['list-check', 'list_check'], ['list-add-item', 'list_add_item'], ['group-open', 'group_open']]) expect(ACTION_MCP[a]).toBe(t)
  })
  it('the registry actions reach the host', () => {
    const reg = createActions()
    const calls = []
    const rec = (name) => (...a) => { calls.push([name, ...a]); return Promise.resolve(true) }
    defineGroupActions(reg, { open: rec('open'), send: rec('send'), leave: rec('leave'), listCreate: rec('listCreate'), setActive: rec('setActive'), addItem: rec('addItem'), check: rec('check'), move: rec('move'), archiveDone: rec('archiveDone') })
    reg.run({ type: 'group-send', args: { group: 'g1', text: 'hi' } })
    reg.run({ type: 'list-check', args: { group: 'g1', item: 'i2', done: false } })
    reg.run({ type: 'list-move', args: { group: 'g1', item: 'i2', dir: 'down' } })
    reg.run({ type: 'list-add-item', args: { group: 'g1', text: 'Eggs', list: 'l2' } })
    expect(calls).toEqual([['send', 'g1', 'hi'], ['check', 'g1', 'i2', false], ['move', 'g1', 'i2', 1], ['addItem', 'g1', 'Eggs', 'l2']])
  })
})
