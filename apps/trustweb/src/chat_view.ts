/**
 * The chat screen of one person (wave 6, U3): press a person -> chat. Above the
 * thread a "Message on Signal / Molly" link when a channel is known (deep links
 * stay the alternative to chatting inside TrustWeb); below it the thread and a
 * composer. Self-contained: no import from main.ts, a minimal element helper of
 * its own, its copy handed in as `ChatStrings`, its own CSS (injectChatStyles).
 *
 * Safety: every piece of text from a message goes in through `textContent` /
 * text nodes, never innerHTML; a link is only rendered when its scheme is
 * https or mailto.
 *
 * Split in two so the logic tests without a browser: `chatViewModel` is pure
 * (what to show), `renderChat` turns it into elements and wires the composer.
 *
 * Wave 6i (chat_re.ts): a message that answers an ask shows the ask above it ("Re: ..."); a chat opened from an ask shows that ask
 * above the composer, and the next message sent carries it. Opened from a "new message" card, the thread scrolls to that message.
 */
import {
  CHAT_TEXT_MAX, ChatDirection, MessageState, markDelivered, markRead, pendingOutgoing, queueOutgoing,
} from './chat'
import type { ChatBook, ChatMessage } from './chat'
import type { ChatRe } from './chat_re'
import { sharesPhoneNumber, withTick } from './contact_share'
import type { Reachable, ShareSettings } from './contact_share'
import { Channel } from './model'

/** Copy handed in by the app (strings.ts), so this module holds none. */
export interface ChatStrings {
  title(name: string): string
  /** "Message on Signal" / "Message on Molly" / "Message on Signal or Molly", for the reachable channel. */
  messageOn(reach: Reachable): string
  notConnected(name: string): string
  empty(name: string): string
  offline: string
  placeholder: string
  send: string
  sendAgain: string
  pending: string
  sent: string
  charsLeft(n: number): string
  you: string
  /** Wave 6i: the quoted ask above a message, "Re: “<ask>” · <when>". */
  re(text: string, when: string): string
  /** Wave 6i: the ask above the composer that the next message answers, "Replying to “<ask>” · <when>". */
  replyingTo(text: string, when: string): string
  /** Wave 6i: the label of the small button that takes that ask away again. */
  replyingToDrop: string
}

export interface ChatViewPerson {
  name: string
  /** The connected peer's id, when this person is connected on TrustWeb; absent: no chat inside TrustWeb. */
  peerId?: string
  /** The best known other way to reach them (contact_share.primaryReachable), if any. */
  reach: Reachable | null
}

export enum ThreadStatus {
  /** Not connected on TrustWeb: only the outside link, if any. */
  NotConnected = 'not-connected',
  Empty = 'empty',
  Messages = 'messages',
}

export interface ChatRowModel {
  key: string
  dir: ChatDirection
  text: string
  at: number
  state: MessageState
  /** Wave 6i: the ask this message answers. */
  re?: ChatRe
}

export interface ChatViewModel {
  status: ThreadStatus
  /** The outside link above the thread; null when no channel is known or its link is not safe to render. */
  externalLink: { href: string; reach: Reachable } | null
  rows: ChatRowModel[]
  /** Something is waiting to be sent while the relay is not reachable. */
  showOffline: boolean
  hasPending: boolean
}

/** Only https and mailto links are ever rendered (channel.ts produces nothing else). */
export function safeHref(href: string): string | null {
  return /^(https:\/\/|mailto:)/i.test(href) ? href : null
}

export function chatViewModel(person: ChatViewPerson, book: ChatBook, online: boolean): ChatViewModel {
  const link = person.reach && safeHref(person.reach.link)
  const externalLink = person.reach && link ? { href: link, reach: person.reach } : null
  if (!person.peerId) return { status: ThreadStatus.NotConnected, externalLink, rows: [], showOffline: false, hasPending: false }
  const messages: ChatMessage[] = Object.prototype.hasOwnProperty.call(book, person.peerId) ? book[person.peerId].messages : []
  const rows = messages.map((m) => ({ key: m.key, dir: m.dir, text: m.text, at: m.at, state: m.state, ...(m.re ? { re: m.re } : {}) }))
  const hasPending = pendingOutgoing(book, person.peerId).length > 0
  return {
    status: rows.length ? ThreadStatus.Messages : ThreadStatus.Empty,
    externalLink, rows, hasPending, showOffline: !online && hasPending,
  }
}

// ---------------------------------------------------------------------------
// sending
// ---------------------------------------------------------------------------

export interface ChatIo {
  getBook(): ChatBook
  setBook(book: ChatBook): void
  /**
   * Sends one sealed chat text; `sentAt` is the timestamp to put on it, the same on every retry of that message; `re` (wave 6i) the ask
   * it answers, also on every retry. Rejects when the relay is not reachable.
   */
  send(peerId: string, text: string, sentAt: number, re?: ChatRe): Promise<void>
  now(): number
}

/** Sends every waiting message of one peer, oldest first, stopping at the first failure. Returns how many went out. */
export async function flushPending(io: ChatIo, peerId: string): Promise<number> {
  let sent = 0
  for (const m of pendingOutgoing(io.getBook(), peerId)) {
    try {
      await io.send(peerId, m.text, m.sentAt, m.re)
    } catch {
      return sent
    }
    io.setBook(markDelivered(io.getBook(), peerId, m.key))
    sent++
  }
  return sent
}

/** Queues a typed text (with the ask it answers, if any) and tries to send it. Returns false when the text was empty or too long (nothing queued). */
export async function submitText(io: ChatIo, peerId: string, raw: string, re?: ChatRe | null): Promise<boolean> {
  const queued = queueOutgoing(io.getBook(), peerId, raw, io.now(), re)
  if (!queued.message) return false
  io.setBook(queued.book)
  await flushPending(io, peerId)
  return true
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

type Attrs = Record<string, string>

function h(doc: Document, tag: string, attrs: Attrs = {}, kids: Array<Node | string | null> = []): HTMLElement {
  const node = doc.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  for (const kid of kids) if (kid !== null) node.append(typeof kid === 'string' ? doc.createTextNode(kid) : kid)
  return node
}

const timeLabel = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Wave 6i: the time of an ask: the clock time on the same day, else the date and the time. */
export function askWhenLabel(at: number, now: number = Date.now()): string {
  const a = new Date(at)
  const b = new Date(now)
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  return sameDay ? timeLabel(at) : `${a.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${timeLabel(at)}`
}

export const CHAT_CSS = `
.chat{display:flex; flex-direction:column; gap:10px}
.chat-ext{display:inline-block; align-self:flex-start; color:var(--electric-deep); font-weight:600; text-decoration:underline; padding:6px 0}
.chat-note{color:var(--ink-soft); font-size:13.5px}
.chat-thread{display:flex; flex-direction:column; gap:6px; max-height:46vh; overflow-y:auto; padding:2px}
.chat-msg{max-width:84%; padding:8px 12px; border-radius:16px; background:var(--card); border:1px solid var(--line); white-space:pre-wrap; overflow-wrap:anywhere}
.chat-out{align-self:flex-end; background:var(--electric); color:#fff; border-color:transparent}
.chat-in{align-self:flex-start}
.chat-meta{display:block; font-size:11.5px; opacity:.75; margin-top:2px}
.chat-composer{display:flex; flex-direction:column; gap:6px}
.chat-composer textarea{width:100%; min-height:64px; resize:vertical; font:inherit; padding:10px 12px; border-radius:14px; border:1px solid var(--line); background:var(--card); color:var(--ink)}
.chat-row{display:flex; gap:8px; align-items:center; justify-content:space-between}
.chat-re{display:block; font-size:12px; opacity:.85; border-left:3px solid currentColor; padding:0 0 0 8px; margin:0 0 4px; white-space:normal}
.chat-context{display:flex; gap:8px; align-items:flex-start; justify-content:space-between; font-size:13px; color:var(--ink-soft); border-left:3px solid var(--electric); padding:4px 0 4px 10px}
.chat-context button{border:0; background:none; font:inherit; color:var(--ink-soft); cursor:pointer; padding:0 4px; line-height:1}
.chat-msg.chat-focus{outline:2px solid var(--electric); outline-offset:2px}
`

/** Adds the chat CSS once to the document head. */
export function injectChatStyles(doc: Document): void {
  if (doc.getElementById('tw-chat-css')) return
  const style = h(doc, 'style', { id: 'tw-chat-css' }, [CHAT_CSS])
  doc.head.append(style)
}

export interface ChatViewDeps extends ChatIo {
  doc: Document
  person: ChatViewPerson
  S: ChatStrings
  isOnline(): boolean
  /** Wave 6i: the chat was opened from an ask: shown above the composer, carried by the next message sent. */
  context?: ChatRe | null
  /** Wave 6i: the key of the message to scroll to (a "new message" card was tapped). Absent: the newest. */
  scrollTo?: string
}

function rowNode(deps: ChatViewDeps, r: ChatRowModel): HTMLElement {
  const { doc, S } = deps
  const state = r.dir === ChatDirection.Out ? (r.state === MessageState.Pending ? S.pending : S.sent) : null
  const who = r.dir === ChatDirection.Out ? S.you : deps.person.name
  return h(doc, 'div', { class: `chat-msg chat-${r.dir}`, 'data-key': r.key }, [
    r.re ? h(doc, 'span', { class: 'chat-re', 'data-chat-re': r.re.qid }, [S.re(r.re.text, askWhenLabel(r.re.at, deps.now()))]) : null,
    h(doc, 'span', { class: 'chat-text' }, [r.text]),
    h(doc, 'span', { class: 'chat-meta' }, [[who, timeLabel(r.at), state].filter(Boolean).join(' · ')]),
  ])
}

function statusNote(deps: ChatViewDeps, vm: ChatViewModel): HTMLElement | null {
  const { doc, S, person } = deps
  if (vm.status === ThreadStatus.NotConnected) return h(doc, 'p', { class: 'chat-note', 'data-chat': 'not-connected' }, [S.notConnected(person.name)])
  if (vm.status === ThreadStatus.Empty) return h(doc, 'p', { class: 'chat-note', 'data-chat': 'empty' }, [S.empty(person.name)])
  return null
}

/** The unsent text and the ask it answers survive a redraw (a message arriving must not wipe what is being typed). */
interface Draft {
  text: string
  /** Wave 6i: the ask the next message answers; cleared once a message carried it, or by its small x. */
  re: ChatRe | null
}

function contextLine(deps: ChatViewDeps, draft: Draft, redraw: () => void): HTMLElement | null {
  const { doc, S } = deps
  const re = draft.re
  if (!re) return null
  const drop = h(doc, 'button', { type: 'button', 'aria-label': S.replyingToDrop, title: S.replyingToDrop, 'data-chat-context-drop': '1' }, ['×'])
  drop.addEventListener('click', () => { draft.re = null; redraw() })
  return h(doc, 'div', { class: 'chat-context', 'data-chat-context': re.qid }, [h(doc, 'span', {}, [S.replyingTo(re.text, askWhenLabel(re.at, deps.now()))]), drop])
}

function composer(deps: ChatViewDeps, vm: ChatViewModel, redraw: () => void, draft: Draft): HTMLElement {
  const { doc, S, person } = deps
  const area = h(doc, 'textarea', { placeholder: S.placeholder, 'aria-label': S.placeholder, maxlength: String(CHAT_TEXT_MAX), rows: '2' }) as HTMLTextAreaElement
  area.value = draft.text
  const left = h(doc, 'span', { class: 'chat-note' })
  const sendBtn = h(doc, 'button', { class: 'btn btn-electric btn-sm', type: 'button' }, [S.send]) as HTMLButtonElement
  const updateLeft = (): void => {
    draft.text = area.value
    const n = CHAT_TEXT_MAX - area.value.length
    left.textContent = n <= 100 ? S.charsLeft(n) : ''
  }
  updateLeft()
  const submit = async (): Promise<void> => {
    if (!person.peerId || sendBtn.disabled) return
    sendBtn.disabled = true
    const ok = await submitText(deps, person.peerId, area.value, draft.re)
    if (ok) { draft.text = ''; draft.re = null }
    redraw()
  }
  area.addEventListener('input', updateLeft)
  area.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent
    if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) { k.preventDefault(); void submit() }
  })
  sendBtn.addEventListener('click', () => { void submit() })
  const again = vm.hasPending
    ? h(doc, 'button', { class: 'btn btn-ghost btn-sm', type: 'button' }, [S.sendAgain])
    : null
  again?.addEventListener('click', () => { if (person.peerId) void flushPending(deps, person.peerId).then(redraw) })
  return h(doc, 'div', { class: 'chat-composer' }, [
    vm.showOffline ? h(doc, 'p', { class: 'chat-note', 'data-chat': 'offline' }, [S.offline]) : null,
    contextLine(deps, draft, redraw),
    area,
    h(doc, 'div', { class: 'chat-row' }, [left, again, sendBtn]),
  ])
}

export interface ChatHandle {
  el: HTMLElement
  /** Redraw from the current book: call it when a message arrived while the screen is open. */
  refresh(): void
}

/** The chat of one person as an element; redraws itself after every change of its own. */
export function renderChat(deps: ChatViewDeps): ChatHandle {
  const { doc, S, person } = deps
  injectChatStyles(doc)
  const root = h(doc, 'div', { class: 'chat', 'data-chat-root': '1' })
  const draft: Draft = { text: '', re: deps.context ?? null }
  let focusKey = deps.scrollTo
  const draw = (): void => {
    if (person.peerId) deps.setBook(markRead(deps.getBook(), person.peerId))
    const vm = chatViewModel(person, deps.getBook(), deps.isOnline())
    const link = vm.externalLink
      ? h(doc, 'a', { class: 'chat-ext', href: vm.externalLink.href, target: '_blank', rel: 'noopener noreferrer' }, [S.messageOn(vm.externalLink.reach)])
      : null
    const thread = vm.rows.length ? h(doc, 'div', { class: 'chat-thread', role: 'log' }, vm.rows.map((r) => rowNode(deps, r))) : null
    root.replaceChildren(
      ...[h(doc, 'h3', {}, [S.title(person.name)]), link, statusNote(deps, vm), thread, person.peerId ? composer(deps, vm, draw, draft) : null]
        .filter((n): n is HTMLElement => n !== null),
    )
    if (thread) scrollThread(thread, focusKey)
    focusKey = undefined
  }
  draw()
  return { el: root, refresh: draw }
}

/** The thread at its newest message, or (wave 6i) at the message a card was about, marked for a moment. */
function scrollThread(thread: HTMLElement, key: string | undefined): void {
  const target = key ? Array.from(thread.children).find((n): n is HTMLElement => (n as HTMLElement).dataset?.key === key) : undefined
  if (!target) { thread.scrollTop = thread.scrollHeight; return }
  target.classList.add('chat-focus')
  thread.scrollTop = Math.max(0, target.offsetTop - thread.offsetTop - 8)
}

// ---------------------------------------------------------------------------
// the owner's side: whether this link is shared when we connect
// ---------------------------------------------------------------------------

/** Copy for the tick under a saved link in the contact box. */
export interface ShareStrings {
  /** "Share this link with people when we connect on TrustWeb" */
  tickLabel: string
  /** Shown while the saved value carries a phone number. */
  tickPhoneNote: string
  /** "Links already sent stay with the people who got them." */
  tickHint: string
}

export interface ShareControlsDeps {
  doc: Document
  channel: Channel
  /** The saved value of this channel (undefined: nothing saved yet, no controls). */
  getHandle(): string | undefined
  getSettings(): ShareSettings | undefined
  setSettings(next: ShareSettings): void
  S: ShareStrings
}

function tickRow(deps: ShareControlsDeps, handle: string): HTMLElement {
  const { doc, S, channel } = deps
  const box = h(doc, 'input', { type: 'checkbox', 'data-share-tick': channel }) as HTMLInputElement
  box.checked = deps.getSettings()?.shareOnConnect?.[channel] === true
  box.addEventListener('change', () => deps.setSettings(withTick(deps.getSettings(), channel, box.checked)))
  return h(doc, 'div', { class: 'chat' }, [
    h(doc, 'label', { class: 'chat-row' }, [box, h(doc, 'span', {}, [S.tickLabel])]),
    sharesPhoneNumber(channel, handle) ? h(doc, 'p', { class: 'chat-note', 'data-share': 'phone' }, [S.tickPhoneNote]) : null,
    h(doc, 'p', { class: 'chat-note' }, [S.tickHint]),
  ])
}

/**
 * The "share when we connect" tick under a saved link (Signal, WhatsApp, Matrix; wave 6e removed the Signal/Molly pick). The tick is
 * unticked until the owner ticks it or the hook calls settleDefaultTick after a save.
 */
export function renderShareControls(deps: ShareControlsDeps): HTMLElement {
  const { doc } = deps
  injectChatStyles(doc)
  const root = h(doc, 'div', { class: 'chat', 'data-share-root': '1' })
  const draw = (): void => {
    const handle = deps.getHandle()
    if (!handle) { root.replaceChildren(); return }
    root.replaceChildren(tickRow(deps, handle))
  }
  draw()
  return root
}
