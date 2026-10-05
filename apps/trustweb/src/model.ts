/**
 * TrustWeb's data model and the one rule that decides what an incoming ask
 * can see: the three rings (close friends, friends, acquaintances) and, per
 * line, who may ask about it. Pure and DOM-free so the test suite can import
 * the exact function the app calls.
 *
 * A line that is not shared with the asker's ring is simply left out of the
 * matcher's input, so the asker gets the same sealed "nothing" as when no
 * line matched at all (apps/demo's gate.ts / answer_key.ts). There is no
 * separate "hidden" path: a note not shared with you looks exactly like no match.
 */
import type { ChatThread } from '../../demo/src/types'
import type { SerializedIdentityV1 } from '../../demo/src/did'

export enum Ring {
  Close = 'close',
  Friend = 'friend',
  Acquaintance = 'acquaintance',
  /** A tier below acquaintance: someone you plan to meet, not yet in your web. */
  Intending = 'intending',
}

export const RINGS: readonly Ring[] = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]

/** Who may ask about one line. */
export enum Audience {
  /** Anyone in my rings (and, once the second hop ships here, their friends). */
  FriendsOfFriends = 'fof',
  /** Friends and close friends only. */
  Friends = 'friends',
  /** Nobody but me. */
  OnlyMe = 'me',
}

export const AUDIENCES: readonly Audience[] = [Audience.FriendsOfFriends, Audience.Friends, Audience.OnlyMe]

export enum Tag {
  Looking = 'looking',
  Offer = 'offer',
  Meet = 'meet',
  Opportunity = 'opportunity',
  Talent = 'talent',
  Resource = 'resource',
  Note = 'note',
  Custom = 'custom',
}

export const TAGS: readonly Tag[] = [
  Tag.Looking, Tag.Offer, Tag.Meet, Tag.Opportunity, Tag.Talent, Tag.Resource, Tag.Note, Tag.Custom,
]

export enum LineStatus {
  Current = 'current',
  Gone = 'gone',
}

export interface NoteLine {
  id: string
  text: string
  tag: Tag
  customTag?: string
  audience: Audience
  status: LineStatus
  notedAt: number
  checkedAt: number
}

export interface Person {
  id: string
  name: string
  context: string
  ring: Ring
  metAt: number
  lines: NoteLine[]
  /** Set once this person is also connected on TrustWeb (a paired peer). */
  peerId?: string
  /**
   * How to reach them outside TrustWeb, canonical form per channel.ts. Kept on
   * this phone only: never matched, relayed or put into a shared code.
   * Absent in records saved before it existed.
   */
  channels?: Partial<Record<Channel, string>>
}

/** Messengers a contact can be opened in, in the owner's order (2026-10-05). */
export enum Channel {
  Signal = 'signal',
  WhatsApp = 'whatsapp',
  Matrix = 'matrix',
  Delta = 'delta',
  Telegram = 'telegram',
  Messenger = 'messenger',
}

export const CHANNELS: readonly Channel[] = [
  Channel.Signal, Channel.WhatsApp, Channel.Matrix, Channel.Delta, Channel.Telegram, Channel.Messenger,
]

export interface Peer {
  id: string
  displayName: string
  did: string
  ring: Ring
  connectedAt: number
}

export interface InventoryItem {
  id: string
  text: string
  audience: Audience
  included: boolean
  createdAt: number
}

export enum LogOutcome {
  NoMatch = 'no-match',
  Declined = 'declined',
  Shared = 'shared',
}

export interface LogEntry {
  id: string
  at: number
  from: string
  text: string
  outcome: LogOutcome
}

export interface Me {
  id: string
  displayName: string
}

/** Which side of the raised Record button each outer tab sits on (Inventory settings). */
export enum TabOrder {
  WebLeft = 'web-left',
  InventoryLeft = 'inventory-left',
}

export interface AppState {
  v: 1
  me: Me
  identity?: SerializedIdentityV1
  people: Person[]
  peers: Peer[]
  inventory: InventoryItem[]
  log: LogEntry[]
  notificationsOn: boolean
  /** Absent in records saved before it existed: read as TabOrder.WebLeft. */
  tabOrder?: TabOrder
  /** Absent: QueryStyle.Call. */
  queryStyle?: QueryStyle
  /** My own messenger handles (Meet shows my Signal / Matrix code). This phone only. */
  myChannels?: Partial<Record<Channel, string>>
  /**
   * Opt-in: the live site may reach TalkWeave on this computer
   * (http://127.0.0.1:8990) for meeting transcription. Absent: off, so no
   * visitor gets the browser's local-network prompt unasked (2026-10-05).
   */
  talkWeaveLocal?: boolean
  /**
   * Demo content added on request (imaginary friends and things, 2026-10-05):
   * the ids it added, so "Remove demo content" takes exactly those away again.
   * Absent: none added.
   */
  demo?: { people: string[]; inventory: string[] }
  /** The phone offered demo content once (popup); absent: not yet. */
  demoOffered?: boolean
  /** Settings > Advanced: close friend / friend / acquaintance under each name on the web. Absent: hidden (2026-10-06). */
  showRingNames?: boolean
  /** Info hints ("i") the person switched off, by HintId. Absent: all on. */
  hiddenHints?: string[]
}

/** Things that explain themselves: a tooltip on desktop, a small "i" on a touch phone (owner 2026-10-06). */
export enum HintId {
  Meeting = 'meeting',
  Qr = 'qr',
  CallWeb = 'call-web',
  WebTap = 'web-tap',
  AboutWho = 'about-who',
  AboutWhat = 'about-what',
  RecAdvanced = 'rec-advanced',
}
export const HINTS: readonly HintId[] = [
  HintId.Meeting, HintId.Qr, HintId.CallWeb, HintId.WebTap, HintId.AboutWho, HintId.AboutWhat, HintId.RecAdvanced,
]

/** What a recording is about: a person (notes go to them) or a thing (notes go to the inventory). */
export enum AboutKind {
  Who = 'who',
  What = 'what',
}

/** The Web screen's query button: calling into the web (default) or the magnifier "Query". */
export enum QueryStyle {
  Call = 'call',
  Search = 'search',
}

/** Does `audience` admit someone I hold in `ring`? */
export function audienceAdmits(audience: Audience, ring: Ring): boolean {
  // Someone I only intend to connect with is not yet in my web: they admit
  // nothing, the same as OnlyMe, regardless of what the line's audience says.
  if (ring === Ring.Intending) return false
  switch (audience) {
    case Audience.OnlyMe:
      return false
    case Audience.Friends:
      return ring === Ring.Friend || ring === Ring.Close
    case Audience.FriendsOfFriends:
      return true
  }
}

export const INVENTORY_CONTEXT = 'What I have'

export function notesContext(p: Person): string {
  return `Notes about ${p.name}`
}

/** Where a matcher hit came from, so a consent prompt can show and share it. */
export interface LineRef {
  threadId: string
  text: string
  context: string
  at: number
}

/**
 * Everything an asker in `ring` may be matched against, as apps/demo's
 * matcher input: one synthetic single-message thread per line, source 'self'
 * (owner-declared, B-08), exactly like apps/demo's inventoryThreads().
 */
export function threadsForRing(s: AppState, ring: Ring): { threads: ChatThread[]; refs: Map<string, LineRef> } {
  const refs = new Map<string, LineRef>()
  const threads: ChatThread[] = []
  const push = (threadId: string, text: string, context: string, at: number): void => {
    refs.set(threadId, { threadId, text, context, at })
    threads.push({
      id: threadId,
      title: context,
      kind: 'direct',
      participants: [s.me.displayName],
      messages: [{ ts: new Date(at).toISOString(), author: s.me.displayName, text, system: false }],
      source: 'self',
      included: true,
    })
  }
  for (const item of s.inventory) {
    if (!item.included || !audienceAdmits(item.audience, ring)) continue
    push(`inv:${item.id}`, item.text, INVENTORY_CONTEXT, item.createdAt)
  }
  for (const person of s.people) {
    for (const line of person.lines) {
      if (line.status !== LineStatus.Current || !audienceAdmits(line.audience, ring)) continue
      push(`note:${person.id}:${line.id}`, line.text, notesContext(person), line.notedAt)
    }
  }
  return { threads, refs }
}

/** "early/mid/late <Month>", coarse on purpose: a shared line never carries an exact date. */
export function coarseWhen(at: number): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return 'recently'
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December']
  const day = d.getDate()
  return `${day <= 10 ? 'early' : day <= 20 ? 'mid' : 'late'} ${months[d.getMonth()]}`
}

/** "today", "3 days ago", "5 months ago": for the "Still true?" review. */
export function ageLabel(at: number, now: number): string {
  const days = Math.floor((now - at) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`
  const years = Math.floor(months / 12)
  return years === 1 ? '1 year ago' : `${years} years ago`
}
