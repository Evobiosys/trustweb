/**
 * Text messages between connected phones (wave 6, U3, "N4 chat"): the store.
 *
 * Transport already exists and is NOT changed: a `chat` envelope
 * ({ v:1, t:'chat', from, text, ts }) sealed with the pair key over the relay
 * (apps/demo wire.ts parses it, net.ts Net.sendText sends it and calls the
 * onText hook). So this module holds only what a phone must keep:
 *   - a bounded thread per connected peer (CHAT_KEEP_PER_PERSON messages, at
 *     most CHAT_MAX_THREADS threads; nothing else is persisted);
 *   - delivered / pending for what this phone sent. "Delivered" means the relay
 *     accepted the sealed message; the wire has no read receipt (roadmap);
 *   - idempotency without a message id on the wire: the key of a message is
 *     direction + the sender's timestamp + a fingerprint of the text, so a
 *     relay redelivery is dropped, and a RETRY of a pending message reuses its
 *     original timestamp (the hook passes `sentAt` to Net.sendText) and so is
 *     dropped by the receiver if the first try arrived after all.
 * Ordering is by local arrival: a sender's clock is never trusted.
 * Wave 6i (chat_re.ts): a message may carry the ask it answers (`re`), kept with it in the thread and sent again on a retry.
 *
 * Pure and DOM-free; every function returns a new book and never throws on bad
 * input, so a corrupted record cannot take the app down.
 */
import { isKeepText, parseKeepText } from './account_keep'
import { sanitizeRe } from './chat_re'
import type { ChatRe } from './chat_re'
import { parseContactText, isContactText } from './contact_share'
import { isHelloText, parseHelloText } from './hello'
import { isProfileText, parseProfileText } from './profile'
import { stripUnsafe, fingerprint } from './safe_text'
import { SHARE_PARAM, parseShareText } from './share'

/** Mirrors apps/demo CHAT_MAX_LEN (wire.ts): the receiver drops longer texts at the boundary, so the sender must not offer them. */
export const CHAT_TEXT_MAX = 500
export const CHAT_KEEP_PER_PERSON = 200
export const CHAT_MAX_THREADS = 300
const KEY_MAX = 120
/** A sender's claimed time may lie this far ahead of ours before it is clamped for display. */
const CLOCK_SKEW_MS = 5 * 60 * 1000

export enum ChatDirection {
  Out = 'out',
  In = 'in',
}

export enum MessageState {
  /** Mine, not yet accepted by the relay: shown as waiting, retried. */
  Pending = 'pending',
  /** Mine, accepted by the relay. */
  Delivered = 'delivered',
  /** Theirs. */
  Received = 'received',
}

export interface ChatMessage {
  /** Dedupe key: direction, the timestamp on the wire, a fingerprint of the text. */
  key: string
  dir: ChatDirection
  text: string
  /** Local time the message entered this phone's thread. Never earlier than the message before it. */
  at: number
  /** The timestamp that travelled (mine: what Net.sendText sends; theirs: their claim, clamped). Display and retry only. */
  sentAt: number
  state: MessageState
  /** Wave 6i: the ask this message answers (chat_re.ts). Absent: a plain message (and every message of older records). */
  re?: ChatRe
}

export interface ChatThread {
  messages: ChatMessage[]
  /** Received since the thread was last opened. */
  unread: number
}

/** peer id -> thread. A plain optional record on the app state (absent in older records). */
export type ChatBook = Record<string, ChatThread>

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

export function emptyBook(): ChatBook {
  return {}
}

/** Text fit to send, show and keep: no hidden or bidi characters, tidy line breaks; null when empty or over the bound. */
export function cleanChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = stripUnsafe(raw).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return text.length > 0 && text.length <= CHAT_TEXT_MAX ? text : null
}

export function messageKey(dir: ChatDirection, sentAt: number, text: string): string {
  return `${dir === ChatDirection.Out ? 'o' : 'i'}:${sentAt}:${fingerprint(text)}`
}

function threadOf(book: ChatBook, peerId: string): ChatThread {
  return has(book, peerId) ? book[peerId] : { messages: [], unread: 0 }
}

function lastAt(thread: ChatThread): number {
  const last = thread.messages[thread.messages.length - 1]
  return last ? last.at : 0
}

/** Drops the oldest messages beyond the bound, waiting ones last (a message still to be sent is not forgotten first). */
function trimThread(messages: ChatMessage[]): ChatMessage[] {
  const out = [...messages]
  while (out.length > CHAT_KEEP_PER_PERSON) {
    const i = out.findIndex((m) => m.state !== MessageState.Pending)
    out.splice(i === -1 ? 0 : i, 1)
  }
  return out
}

function withThread(book: ChatBook, peerId: string, thread: ChatThread): ChatBook {
  const next: ChatBook = { ...book, [peerId]: thread }
  const ids = Object.keys(next)
  if (ids.length <= CHAT_MAX_THREADS) return next
  const quietest = ids.filter((id) => id !== peerId).sort((a, b) => lastAt(next[a]) - lastAt(next[b]))[0]
  delete next[quietest]
  return next
}

function append(thread: ChatThread, m: ChatMessage, unreadAdd: number): ChatThread {
  return { messages: trimThread([...thread.messages, m]), unread: Math.min(CHAT_KEEP_PER_PERSON, thread.unread + unreadAdd) }
}

export interface Queued {
  book: ChatBook
  /** The new message, or null when the text was empty, too long or not a string, or too many messages already wait to be sent. */
  message: ChatMessage | null
}

/**
 * Adds a message of mine in the Pending state. Its `sentAt` is the timestamp to send, strictly later than my previous one in this thread.
 * `re` (wave 6i): the ask it answers; a malformed one is dropped, the message is kept.
 */
export function queueOutgoing(book: ChatBook, peerId: string, raw: unknown, now: number, re?: ChatRe | null): Queued {
  const text = cleanChatText(raw)
  if (!text || !peerId) return { book, message: null }
  const thread = threadOf(book, peerId)
  // At most one fewer waiting message than the thread holds: an unsent message is never dropped to make room, and an arriving one always fits.
  if (thread.messages.filter((m) => m.state === MessageState.Pending).length >= CHAT_KEEP_PER_PERSON - 1) return { book, message: null }
  const lastOut = [...thread.messages].reverse().find((m) => m.dir === ChatDirection.Out)
  const sentAt = Math.max(now, (lastOut?.sentAt ?? 0) + 1)
  const message: ChatMessage = {
    key: messageKey(ChatDirection.Out, sentAt, text), dir: ChatDirection.Out, text,
    at: Math.max(now, lastAt(thread)), sentAt, state: MessageState.Pending, ...withRe(re),
  }
  return { book: withThread(book, peerId, append(thread, message, 0)), message }
}

/** The relay accepted this message. Unknown key or already delivered: unchanged. */
export function markDelivered(book: ChatBook, peerId: string, key: string): ChatBook {
  if (!has(book, peerId)) return book
  const thread = book[peerId]
  const target = thread.messages.find((m) => m.key === key)
  if (!target || target.state !== MessageState.Pending) return book
  const messages = thread.messages.map((m) => (m === target ? { ...m, state: MessageState.Delivered } : m))
  return { ...book, [peerId]: { ...thread, messages } }
}

/** Messages of mine still to be sent, oldest first (for a retry when the relay is back). */
export function pendingOutgoing(book: ChatBook, peerId: string): ChatMessage[] {
  return threadOf(book, peerId).messages.filter((m) => m.dir === ChatDirection.Out && m.state === MessageState.Pending)
}

export interface Received {
  book: ChatBook
  /** The stored message, or null when it was invalid or a duplicate. */
  message: ChatMessage | null
  duplicate: boolean
}

/** `{ re }` when it is well formed, else nothing (a message never fails because of its quote). */
function withRe(re: unknown): { re?: ChatRe } {
  const clean = sanitizeRe(re)
  return clean ? { re: clean } : {}
}

/**
 * A text arrived from a connected peer. `ts` is the sender's claim; it only helps dedupe and is clamped for display. `re` (wave 6i): the
 * ask it answers, already bound by the caller (chat_re.ts bindRe); a malformed one is dropped, the message is kept.
 */
export function receiveText(book: ChatBook, peerId: string, raw: unknown, ts: unknown, now: number, re?: ChatRe | null): Received {
  const text = cleanChatText(raw)
  if (!text || !peerId || typeof ts !== 'number' || !Number.isFinite(ts)) return { book, message: null, duplicate: false }
  const thread = threadOf(book, peerId)
  const key = messageKey(ChatDirection.In, ts, text)
  if (thread.messages.some((m) => m.key === key)) return { book, message: null, duplicate: true }
  const message: ChatMessage = {
    key, dir: ChatDirection.In, text, at: Math.max(now, lastAt(thread)),
    sentAt: Math.min(Math.max(0, ts), now + CLOCK_SKEW_MS), state: MessageState.Received, ...withRe(re),
  }
  return { book: withThread(book, peerId, append(thread, message, 1)), message, duplicate: false }
}

export function markRead(book: ChatBook, peerId: string): ChatBook {
  if (!has(book, peerId) || book[peerId].unread === 0) return book
  return { ...book, [peerId]: { ...book[peerId], unread: 0 } }
}

export function unreadTotal(book: ChatBook): number {
  return Object.values(book).reduce((n, t) => n + t.unread, 0)
}

export function removeThread(book: ChatBook, peerId: string): ChatBook {
  if (!has(book, peerId)) return book
  const next = { ...book }
  delete next[peerId]
  return next
}

/** What an incoming text is: a meeting share link, a contact payload, a chat message, or protocol text that is malformed (shown nowhere). */
export enum TextKind {
  Share = 'share',
  Contact = 'contact',
  /** Wave 6 (N5): a guest account's keep notice (account_keep.ts), in either direction. */
  Keep = 'keep',
  /** Wave 6b (hello.ts): a connected phone tells its name. */
  Hello = 'hello',
  /** Wave 7 (profile.ts): a connected phone shares its profile. */
  Profile = 'profile',
  Chat = 'chat',
  Ignore = 'ignore',
}

export function routeText(appUrl: string, text: string): TextKind {
  if (typeof text !== 'string') return TextKind.Ignore
  if (parseShareText(appUrl, text)) return TextKind.Share
  if (isContactText(appUrl, text)) return parseContactText(appUrl, text) ? TextKind.Contact : TextKind.Ignore
  if (isKeepText(appUrl, text)) return parseKeepText(appUrl, text) ? TextKind.Keep : TextKind.Ignore
  if (isHelloText(appUrl, text)) return parseHelloText(appUrl, text) ? TextKind.Hello : TextKind.Ignore
  if (isProfileText(appUrl, text)) return parseProfileText(appUrl, text, Date.now()) ? TextKind.Profile : TextKind.Ignore
  return text.startsWith(`${appUrl}?${SHARE_PARAM}=1#`) ? TextKind.Ignore : TextKind.Chat
}

const STATES: readonly string[] = [MessageState.Pending, MessageState.Delivered, MessageState.Received]

function sanitizeMessage(v: unknown): ChatMessage | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const dir = o.dir === ChatDirection.Out || o.dir === ChatDirection.In ? o.dir : null
  const text = cleanChatText(o.text)
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
  if (!dir || !text || !ok(o.at) || !ok(o.sentAt) || typeof o.state !== 'string' || !STATES.includes(o.state)) return null
  const state = o.state as MessageState
  if ((dir === ChatDirection.In) !== (state === MessageState.Received)) return null
  // The stored key is kept: for a received message it was made from the sender's own timestamp, which `sentAt` may have clamped.
  const key = typeof o.key === 'string' && o.key.length > 0 && o.key.length <= KEY_MAX ? o.key : messageKey(dir, o.sentAt, text)
  return { key, dir, text, at: o.at, sentAt: o.sentAt, state, ...withRe(o.re) }
}

/** Reads a stored book (migration): keeps what is valid, bounds it, drops the rest. Never throws. */
export function sanitizeChatBook(raw: unknown): ChatBook {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const threads: Array<[string, ChatThread]> = []
  for (const [id, t] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || id.length > KEY_MAX || id === '__proto__' || typeof t !== 'object' || t === null) continue
    const list = (t as Record<string, unknown>).messages
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    const messages = list.map(sanitizeMessage).filter((m): m is ChatMessage => m !== null && !seen.has(m.key) && !!seen.add(m.key))
    if (!messages.length) continue
    const unread = (t as Record<string, unknown>).unread
    threads.push([id, { messages: trimThread(messages), unread: typeof unread === 'number' && unread >= 0 ? Math.min(Math.floor(unread), CHAT_KEEP_PER_PERSON) : 0 }])
  }
  threads.sort((a, b) => lastAt(b[1]) - lastAt(a[1]))
  return Object.fromEntries(threads.slice(0, CHAT_MAX_THREADS))
}

/** Startup repair, in the style of migrateSources: sanitises a stored `chats` record in place. True when it changed anything. Never throws. */
export function migrateChats(state: { chats?: unknown }): boolean {
  if (state.chats === undefined) return false
  try {
    const clean = sanitizeChatBook(state.chats)
    if (JSON.stringify(clean) === JSON.stringify(state.chats)) return false
    state.chats = clean
    return true
  } catch {
    return false
  }
}

/** Peers with a message of mine still waiting (for a flush when the relay comes back). */
export function peersWithPending(book: ChatBook): string[] {
  return Object.keys(book).filter((id) => pendingOutgoing(book, id).length > 0)
}
