// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list: the sheets of a group (engine: group_chat.ts). Phone first.
 *   chat list   a Groups section on top (name, last line, unread dot) and "New group" next to New message (main.ts places both).
 *   group chat  name; a header row: "n members" (V expander with the names, P3), "Active list" and "Invite" (chips like "+ tag" of the person
 *               view); the thread (chat_view.ts bubbles: mine right, theirs left with the name; joins, leaves and checked items as quiet
 *               centred lines); composer; Leave / Join again.
 *   lists       the group's lists as chips (the active one marked), "Make this the active list", "+ list" inline; the open items of the list
 *               shown: a checkbox (done: who, when), the text, up / down; "Add an item" inline (Enter adds); "Archive done"; back to the chat.
 * Text goes in as text nodes only. An open sheet redraws when its group changes; a draft in an input stays.
 */
import { el } from '../../demo/src/ui/dom'
import type { EventEnvelope } from '../../demo/src/types'
import type { AppState } from './model'
import { injectChatStyles } from './chat_view'
import { createGroupChat } from './group_chat'
import type { Actions } from './actions'
import { defineGroupActions } from './group_chat_actions'
import { GROUP_ITEM_TEXT_MAX, GROUP_NAME_MAX, activeListId, archivedOf, groupTag, groupsOf, lastLine, liveItems, memberNames, type ChatGroup, type GItem } from './group_store'
import { S } from './strings'

export interface GroupViewDeps<P extends { id: string }> {
  st: () => AppState
  save: () => void
  openSheet: (body: (Node | null)[]) => void
  newId: () => string
  peers: () => P[]
  /** net.ts sendEvent: sealed with the pair key. */
  send: (peer: P, env: EventEnvelope) => Promise<void>
  /** The community invite sheet (invite_view.ts) for the group's tag, titled with the group name. */
  openInvite: (tag: string, label: string) => void
  /** Any group changed (the chat list may redraw). */
  changed?: () => void
}

const T = S.w45gl
const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const when = (at: number): string => (new Date(at).toDateString() === new Date().toDateString() ? time(at) : new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' }))
const lineOf = (i: GItem): string => (i.k === 'msg' ? `${i.mine ? '' : i.by + ': '}${i.text ?? ''}` : i.k === 'check' ? T.checked(i.by, i.text ?? '') : i.k === 'join' ? T.joined(i.by) : T.left(i.by))

function itemNode(i: GItem): HTMLElement {
  if (i.k !== 'msg') return el('p', { class: 'chat-note gl-quiet', 'data-group-item': i.k }, [lineOf(i)])
  return el('div', { class: `chat-msg ${i.mine ? 'chat-out' : 'chat-in'}`, 'data-group-item': 'msg' }, [
    i.mine ? null : el('span', { class: 'chat-by' }, [i.by]),
    el('span', { class: 'chat-text' }, [i.text ?? '']),
    el('span', { class: 'chat-meta' }, [[time(i.ts), i.state === 'pending' ? T.waiting : ''].filter(Boolean).join(' · ')]),
  ])
}

export function createGroupView<P extends { id: string }>(d: GroupViewDeps<P>) {
  let shown: { gid: string; root: HTMLElement; draw: () => void } | null = null
  const chat = createGroupChat<P>({
    state: d.st, save: d.save, now: Date.now, newId: d.newId, peers: d.peers, send: d.send, firstList: T.firstList,
    changed: (gid) => { if (shown?.gid === gid && shown.root.isConnected) shown.draw(); d.changed?.() },
  })
  const group = (gid: string): ChatGroup | undefined => groupsOf(d.st())[gid]
  const me = (): string => d.st().me.displayName || 'TrustWeb'

  function open(gid: string): void {
    const g0 = group(gid)
    if (!g0) return
    injectChatStyles(document)
    let membersOpen = false
    const title = el('h3', {}, [g0.name])
    const membersBtn = el('button', { class: 'tw-expander gl-members-btn', type: 'button', 'aria-label': T.membersAria, 'data-group-members-toggle': '', onclick: () => { membersOpen = !membersOpen; draw() } })
    const membersList = el('p', { class: 'meta gl-members', 'data-group-members': '' })
    const head = el('div', { class: 'gl-head' }, [
      membersBtn,
      el('button', { class: 'chip gl-chip gl-chip-list', type: 'button', 'data-group-active-list': '', onclick: () => openList(gid) }, [T.activeList]),
      el('button', { class: 'chip gl-chip gl-chip-invite', type: 'button', 'data-group-invite': '', onclick: () => { const g = group(gid); if (g) d.openInvite(groupTag(gid), g.name) } }, [T.invite]),
    ])
    const thread = el('div', { class: 'chat-thread', role: 'log', 'data-group-thread': '' })
    const note = el('p', { class: 'chat-note' })
    const area = el('textarea', { class: 'field', rows: '2', maxlength: '2000', placeholder: T.ph, 'aria-label': T.ph, 'data-group-text': '' }) as HTMLTextAreaElement
    const sendBtn = el('button', { class: 'btn btn-electric', type: 'button', 'data-group-send': '', onclick: () => { void chat.send(gid, area.value).then((i) => { if (i) area.value = '' }) } }, [T.send])
    const compose = el('div', { class: 'gl-compose' }, [area, sendBtn])
    const leaveBox = el('div', { class: 'gl-leave' })
    const root = el('div', { class: 'chat group-chat', 'data-group-chat': gid }, [title, head, membersList, thread, note, compose, leaveBox])
    function draw(): void {
      const g = group(gid)
      if (!g) return
      const left = g.mem.me?.on === false
      const names = memberNames(g, me())
      title.textContent = g.name
      membersBtn.replaceChildren(T.members(names.length), ' ', membersOpen ? '▴' : '▾')
      membersBtn.setAttribute('aria-expanded', String(membersOpen))
      membersList.hidden = !membersOpen
      membersList.textContent = names.map((n, i) => (i === 0 && !left ? T.you(n) : n)).join(', ')
      thread.replaceChildren(...(g.items.length ? g.items.map(itemNode) : [el('p', { class: 'chat-note', 'data-group-empty': '' }, [T.empty])]))
      thread.scrollTop = thread.scrollHeight
      note.textContent = left ? T.leftNote : ''
      compose.hidden = left
      leaveBox.replaceChildren(el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-group-leave': left ? 'rejoin' : 'leave', onclick: () => { void chat.leave(gid, !left) } }, [el('u', {}, [left ? T.rejoin : T.leave])]))
      chat.markRead(gid)
    }
    shown = { gid, root, draw }
    draw()
    d.openSheet([root])
    void chat.retry(gid)
  }

  function openList(gid: string, listId?: string): void {
    if (!group(gid)) return
    let viewing = listId
    let adding = false
    const chips = el('div', { class: 'chips gl-lists', 'data-group-lists': '' })
    const makeActive = el('div', {})
    const items = el('div', { class: 'gl-items', 'data-group-items': '' })
    const input = el('input', { class: 'field', type: 'text', maxlength: String(GROUP_ITEM_TEXT_MAX), placeholder: T.addPh, 'aria-label': T.addPh, 'data-group-add-text': '' }) as HTMLInputElement
    const addNow = (): void => { const v = viewing; if (v && input.value.trim()) void chat.addItem(gid, input.value, v).then((id) => { if (id) { input.value = ''; input.focus() } }) }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNow() } })
    const addRow = el('div', { class: 'gl-add' }, [input, el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-group-add': '', onclick: addNow }, [T.add])])
    const foot = el('div', { class: 'gl-foot' })
    const title = el('h3', {})
    const root = el('div', { class: 'group-lists', 'data-group-list-sheet': gid }, [
      title, chips, makeActive, items, addRow, foot,
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-group-back': '', onclick: () => open(gid) }, [el('u', {}, [T.backToChat])]),
    ])
    function draw(): void {
      const g = group(gid)
      if (!g) return
      const act = activeListId(g)
      if (!viewing || !g.lists.some((l) => l.id === viewing)) viewing = act
      const v = viewing
      title.textContent = T.listsOf(g.name)
      const newInput = el('input', { class: 'field optional gl-new-list', type: 'text', maxlength: String(GROUP_NAME_MAX), placeholder: T.newListPh, 'aria-label': T.newListPh, 'data-group-new-list-name': '' }) as HTMLInputElement
      newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { adding = false; draw() }
        if (e.key !== 'Enter') return
        e.preventDefault()
        void chat.listCreate(gid, newInput.value).then((id) => { if (id) { viewing = id; adding = false; draw() } })
      })
      chips.replaceChildren(
        ...g.lists.map((l) => el('button', { class: `chip gl-chip${l.id === v ? ' gl-chip-on' : ''}`, type: 'button', 'aria-pressed': String(l.id === v), 'data-group-list': l.id, onclick: () => { viewing = l.id; draw() } }, [l.name, l.id === act ? el('small', { class: 'gl-act' }, [' · ', T.isActive]) : null])),
        adding ? newInput : el('button', { class: 'chip gl-chip', type: 'button', 'data-group-new-list': '', onclick: () => { adding = true; draw(); (chips.querySelector('[data-group-new-list-name]') as HTMLInputElement | null)?.focus() } }, [T.newList]),
      )
      makeActive.replaceChildren(...(v && v !== act ? [el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-group-make-active': v, onclick: () => { void chat.setActive(gid, v) } }, [el('u', {}, [T.makeActive])])] : []))
      const open = v ? liveItems(g, v) : []
      items.replaceChildren(...(open.length ? open.map((i, n) => {
        const box = el('input', { type: 'checkbox', 'aria-label': i.text, 'data-group-check': i.id }) as HTMLInputElement
        box.checked = !!i.done
        box.addEventListener('change', () => { void chat.check(gid, i.id, box.checked) })
        return el('div', { class: `gl-item${i.done ? ' gl-done' : ''}`, 'data-group-item-row': i.id }, [
          el('label', { class: 'gl-label' }, [box, el('span', { class: 'gl-text' }, [i.text]), i.done ? el('small', { class: 'meta gl-by' }, [T.doneBy(i.done.by, when(i.done.at))]) : null]),
          el('button', { class: 'btn btn-ghost btn-sm gl-move', type: 'button', 'aria-label': T.up, 'data-group-up': i.id, disabled: n === 0, onclick: () => { void chat.move(gid, i.id, -1) } }, ['▲']),
          el('button', { class: 'btn btn-ghost btn-sm gl-move', type: 'button', 'aria-label': T.down, 'data-group-down': i.id, disabled: n === open.length - 1, onclick: () => { void chat.move(gid, i.id, 1) } }, ['▼']),
        ])
      }) : [el('p', { class: 'meta', 'data-group-items-empty': '' }, [T.nothingOpen])]))
      const arc = v ? archivedOf(g, v).length : 0
      const anyDone = open.some((i) => i.done)
      foot.replaceChildren(...[
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-group-archive': '', disabled: !anyDone, onclick: () => { if (v) void chat.archiveDone(gid, v) } }, [el('u', {}, [T.archiveDone])]),
        arc ? el('small', { class: 'meta', 'data-group-archived': String(arc) }, [T.archived(arc)]) : null,
      ].filter((n): n is HTMLElement => n !== null))
    }
    shown = { gid, root, draw }
    draw()
    d.openSheet([root])
    void chat.retry(gid)
  }

  /** Chat > New group: a name, Create; the new group's chat opens. */
  function newSheet(): void {
    const name = el('input', { class: 'field', type: 'text', maxlength: String(GROUP_NAME_MAX), placeholder: T.namePh, 'aria-label': T.namePh, 'data-group-new-name': '' }) as HTMLInputElement
    const go = (): void => { const gid = chat.create(name.value); if (gid) open(gid) }
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
    d.openSheet([el('div', { class: 'group-new', 'data-group-new-sheet': '' }, [
      el('h3', {}, [T.newTitle]), el('p', { class: 'meta' }, [T.newHint]), name,
      el('button', { class: 'btn btn-electric', type: 'button', 'data-group-create': '', onclick: go }, [T.create]),
    ])])
  }

  /** The chat list's Groups section (empty when I hold none). */
  function rows(): HTMLElement[] {
    const gs = Object.values(groupsOf(d.st())).sort((a, b) => (lastLine(b)?.at ?? b.at) - (lastLine(a)?.at ?? a.at))
    if (!gs.length) return []
    return [el('section', { class: 'gl-section', 'data-group-section': '' }, [
      el('h3', {}, [T.groups]),
      ...gs.map((g) => {
        const last = lastLine(g)
        return el('div', { class: 'prow chat-row', role: 'button', tabindex: '0', 'data-group-row': g.id, onclick: () => open(g.id) }, [
          el('span', { class: 'gl-badge', 'aria-hidden': 'true' }, [[...g.name][0]?.toUpperCase() ?? '#']),
          el('div', { class: 'who' }, [el('b', {}, [g.name]), el('i', {}, [last ? lineOf(last) : T.noLast])]),
          g.unread > 0 ? el('span', { class: 'dot', role: 'img', 'aria-label': S.chatTabUnread(g.unread) }) : null,
        ])
      }),
    ])]
  }
  const newButton = (): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-group-new': '', onclick: newSheet }, [el('u', {}, [T.newGroup])])

  return { ...chat, open, openList, newSheet, rows, newButton }
}
export type GroupView = ReturnType<typeof createGroupView>

/** answers-45a (P5): the whole row in one call for main.ts: the group sheets plus the registry actions behind MCP group_* / list_* (`showChat`
 *  brings the Chat screen up before an action opens a group). */
export function installGroupChat<P extends { id: string }>(reg: Actions, d: GroupViewDeps<P> & { showChat: () => void }): GroupView {
  const v = createGroupView(d)
  defineGroupActions(reg, { ...v, open: (gid) => { d.showChat(); v.open(gid) } })
  return v
}
