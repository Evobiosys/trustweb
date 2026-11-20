// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list (D-P02): the group steps MCP queues for the open app, because only the app holds the pair keys that seal each op
 * (apps/mcp group_tools.ts; group_create and group_invite write the record directly). Each action calls the same engine the sheets use (group_chat.ts).
 */
import { bool, oneOf, str, type Actions } from './actions'
import { S } from './strings'

type P<T> = Promise<T>
export interface GroupActionHost {
  open(gid: string): void
  send(gid: string, text: string): P<unknown>
  leave(gid: string, leave: boolean): P<unknown>
  listCreate(gid: string, name: string): P<unknown>
  setActive(gid: string, listId: string): P<unknown>
  addItem(gid: string, text: string, listId?: string): P<unknown>
  check(gid: string, itemId: string, done: boolean): P<unknown>
  move(gid: string, itemId: string, dir: -1 | 1): P<unknown>
  archiveDone(gid: string, listId?: string): P<unknown>
}

export function defineGroupActions(reg: Actions, host: GroupActionHost): void {
  const T = S.w45gl
  const g = (a: Record<string, unknown>): string => str(a, 'group', 64) as string
  const base = { undoable: false } as const
  reg.define({ type: 'group-open', ...base, doc: 'Opens the chat of a group.', shape: '{"group": group id}', parse: (a) => ({ group: g(a) }), label: () => T.actOpen, apply: (a) => host.open(a.group) })
  reg.define({ type: 'group-send', ...base, doc: 'Sends one message into the chat of a group.', shape: '{"group": group id, "text": message}', parse: (a) => ({ group: g(a), text: str(a, 'text', 2000) as string }), label: () => T.actSend, apply: (a) => { void host.send(a.group, a.text) } })
  reg.define({ type: 'group-leave', ...base, doc: 'Leaves a group (leave true) or joins it again (leave false); the others are told.', shape: '{"group": group id, "leave": true|false}', parse: (a) => ({ group: g(a), leave: bool(a, 'leave') }), label: () => T.actLeave, apply: (a) => { void host.leave(a.group, a.leave) } })
  reg.define({ type: 'list-create', ...base, doc: 'Adds a list to a group (shopping, errands, ...).', shape: '{"group": group id, "name": list name}', parse: (a) => ({ group: g(a), name: str(a, 'name', 60) as string }), label: () => T.actListCreate, apply: (a) => { void host.listCreate(a.group, a.name) } })
  reg.define({ type: 'list-set-active', ...base, doc: 'Makes a list the active list of its group (the chat header opens it).', shape: '{"group": group id, "list": list id}', parse: (a) => ({ group: g(a), list: str(a, 'list', 64) as string }), label: () => T.actSetActive, apply: (a) => { void host.setActive(a.group, a.list) } })
  reg.define({ type: 'list-add-item', ...base, doc: 'Adds an item at the end of a list of a group (the active list when none is named).', shape: '{"group": group id, "text": item, "list"?: list id}', parse: (a) => ({ group: g(a), text: str(a, 'text', 200) as string, list: str(a, 'list', 64, true) }), label: () => T.actAdd, apply: (a) => { void host.addItem(a.group, a.text, a.list) } })
  reg.define({ type: 'list-check', ...base, doc: 'Checks (done true) or unchecks an item of a group list; a check posts a quiet line in the group chat.', shape: '{"group": group id, "item": item id, "done": true|false}', parse: (a) => ({ group: g(a), item: str(a, 'item', 64) as string, done: bool(a, 'done') }), label: () => T.actCheck, apply: (a) => { void host.check(a.group, a.item, a.done) } })
  reg.define({ type: 'list-move', ...base, doc: 'Moves an item of a group list one place up or down.', shape: '{"group": group id, "item": item id, "dir": "up"|"down"}', parse: (a) => ({ group: g(a), item: str(a, 'item', 64) as string, dir: oneOf(a, 'dir', ['up', 'down'] as const) }), label: () => T.actMove, apply: (a) => { void host.move(a.group, a.item, a.dir === 'up' ? -1 : 1) } })
  reg.define({ type: 'list-archive-done', ...base, doc: 'Archives the checked items of a group list (the active list when none is named).', shape: '{"group": group id, "list"?: list id}', parse: (a) => ({ group: g(a), list: str(a, 'list', 64, true) }), label: () => T.actArchive, apply: (a) => { void host.archiveDone(a.group, a.list) } })
}
