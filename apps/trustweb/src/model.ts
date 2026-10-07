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
  /** Where it came from (provenance.ts). This phone only. Absent before 2026-10-06: migrated to typed or demo. */
  source?: ItemSource
}

/** Where an item or a note came from: the chain of proof (wave 1733, owner 2026-10-06). A fixed set. */
export enum Provenance {
  /** Noted in a recording by yourself ("Just me"). */
  RecordedSolo = 'recorded-solo',
  /** Noted in a meeting recording. */
  RecordedMeeting = 'recorded-meeting',
  /** Typed in by hand (and everything saved before provenance existed). */
  Typed = 'typed',
  /** Imported from Tana. */
  Tana = 'tana',
  /** A person shared it with you (a Meet code's notes, a meeting sent inside TrustWeb). */
  SharedByPerson = 'shared-by-person',
  /** Demo content (imaginary friends and things). */
  Demo = 'demo',
}

export const PROVENANCES: readonly Provenance[] = [
  Provenance.RecordedSolo, Provenance.RecordedMeeting, Provenance.Typed, Provenance.Tana, Provenance.SharedByPerson, Provenance.Demo,
]

/**
 * Where one item came from. Kept on this phone only: never put into what an
 * asker can be matched against, never into an answer, a Meet code or a
 * meeting sent inside TrustWeb (threadsForRing and sharedItems read text,
 * context and date only; test/unit/provenance.test.mjs proves it).
 */
export interface ItemSource {
  kind: Provenance
  /** Recorded: the past meeting or memo it was noted in (AppState.meetings id). */
  meetingId?: string
  /** Recorded: the moment, in ms from the start of the recording. */
  atMs?: number
  /** Recorded: the transcript line it was picked from (index into that meeting's transcript). */
  line?: number
  /** Shared by a person: who. */
  fromName?: string
  /** Tana: the source node's reference. Local only, NEVER sent to anyone. */
  ref?: string
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
  /**
   * Their public Mastodon or Pixelfed address (wave 1733 round B, item 2), so
   * the Feed can show their PUBLIC posts, fetched by this phone straight from
   * that instance. This phone only. Absent: none.
   */
  fediverse?: FediverseLink
}

/** A person's fediverse address and whether the Feed shows their public posts. */
export interface FediverseLink {
  /** "user@instance", canonical (fediverse.ts). */
  handle: string
  /** Show their public posts in the Feed (off until turned on, per person). */
  show: boolean
  /** How the phone reaches the instance, found when the address was added: its public API, or only a link out. */
  reach?: FediverseReach
}

export enum FediverseReach {
  /** The instance's public API answers this page (CORS allowed). */
  Api = 'api',
  /** It does not (CORS refused or down): "Open their profile" instead. */
  Link = 'link',
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
  /** Where it came from (provenance.ts). This phone only. Absent before 2026-10-06: migrated to typed or demo. */
  source?: ItemSource
  /** A picture the person attached (image_store.ts, this phone only; never sent). Absent: none. */
  imageId?: string
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
  /** The asking peer, so Review / requests can mark asks from a demo account. Absent in older entries. */
  peerId?: string
}

export interface Me {
  id: string
  displayName: string
}

/**
 * A demo account this phone made from the QR button (owner 2026-10-06):
 * "<name>-demo" (older ones: "-test"). Its connection goes through three
 * states: waiting (nobody opened it), pending (a phone opened it and asks to
 * connect: `pending` holds that phone until the owner allows it in his own
 * view), connected (`peerId` set). Taken down at `expiresAt` (absent on
 * accounts made before expiry existed: read as a week after creation).
 * Removing it forgets the peer and the person.
 */
export interface DemoAccount {
  id: string
  name: string
  createdAt: number
  expiresAt?: number
  peerId?: string
  pending?: Peer
}

/** Set on a phone that started from a demo-account link: whose demo account it is. */
export interface DemoOf {
  name: string
  createdAt: number
  /** The account's id on the owner's phone; absent on links made before it existed. */
  accountId?: string
  expiresAt?: number
  /** The owner allowed the connection (his phone's ack arrived). Absent: waiting. */
  approvedAt?: number
  /** Runs on the owner's own phone (a second tab), not on somebody else's. */
  own?: boolean
  /** Handed over to another phone: this record is finished, the relay identity moved. */
  handedOverAt?: number
}

/** What a demo account found: one entry per ask that got a share, kept so a hand-over carries it. */
export interface Found {
  id: string
  at: number
  text: string
  /**
   * `from`: this phone's name for the peer that answered; `peerId`: that peer
   * (wave 1733 round B, review: the Feed links an answer to a person by the
   * peer, never by a name inside the answer). Absent in finds saved before.
   */
  shared: { from: string; peerId?: string; items: { text: string; context: string; when: string }[] }[]
}

/** One line of a meeting transcript as kept on this phone (who said it, when in the recording, what). */
export interface TranscriptLine {
  speaker: number
  atMs: number
  text: string
}

/**
 * A meeting or memo this phone recorded, kept so past meetings can be opened
 * again with their notes, place and transcript (owner 2026-10-06: "I had a
 * meeting and took notes, incl. where we met"). Written when a meeting ends
 * (transcript) and completed when its notes are saved (lines, person).
 */
export interface PastMeeting {
  id: string
  /** Who it was with (a person's name) or what it was about. */
  about: string
  kind: AboutKind
  personId?: string
  where: string
  startedAt: number
  endedAt: number
  durationMs: number
  /** A meeting (who, where, consent) rather than a memo by yourself. */
  meeting: boolean
  /** The notes; `atMs` / `line` say where in the recording each was noted, when known (wave 1733). */
  lines: { text: string; tag: Tag; atMs?: number; line?: number }[]
  transcript: TranscriptLine[]
  /** Another phone sent it (notes and transcript of a meeting they recorded). */
  fromName?: string
  /** The Swiss server's transcription of this recording (wave 1733 round B). Absent: never asked. */
  serverJob?: ServerJob
  /** Wave 2: the server estimated its lines' times per sentence (its answer said approx): shown as "rough times". Absent: exact or not from the server. */
  roughTimes?: boolean
  /**
   * Sent (Meet code or inside TrustWeb) while its transcript was still arriving:
   * the key of each such pack, kept until the full version replaced it (A3).
   * The key text alone is enough: the pack's slot id and write token are derived from it. Absent: none waiting.
   */
  outbox?: OutboxPack[]
  /** When the full version last replaced the packs sent early. Absent: never needed or not yet. */
  fullSentAt?: number
  /** Kept from another phone while its transcript was still arriving: where to look for the full version. Absent: complete. */
  late?: LateLink
}

/** Where the Swiss server's transcription of one recording stands. A fixed set. */
export enum ServerJobState {
  /** A call is out (saved BEFORE each call, so a reload never sends the audio again by itself). */
  Running = 'running',
  Done = 'done',
  /** Refused or failed (nothing charged, or charged back): may be tried again. */
  Failed = 'failed',
  /** The answer was lost (timeout, dropped connection, the app closed): it may still be charged. */
  MaybeCharged = 'maybe-charged',
}

export interface ServerJob {
  state: ServerJobState
  at: number
  /** Takes already transcribed (their lines are in the transcript); a new try goes on from the next one. */
  takesDone: number
  /** Why it stopped (swiss_server.ts SwissError), for the message. */
  error?: string
}

/** A pack sent before its transcript was complete; dropped once the full version went out (or was finalised without it). */
export interface OutboxPack {
  keyText: string
  title: string
  /** The notes the early pack carried, so the full one carries the same. */
  notes: string[]
  at: number
}

/** A kept pack whose transcript was still arriving: its key and the version (ETag) this phone has. */
export interface LateLink {
  keyText: string
  etag?: string
  since: number
}

/** A meeting another phone sent inside TrustWeb: an encrypted pack on the backup server, its key only in the link. */
export interface ReceivedShare {
  id: string
  at: number
  fromName: string
  fromPeerId: string
  link: string
  title: string
  openedAt?: number
  /** The pack said its transcript was still arriving when it was last opened. Absent: complete or never opened. */
  pending?: boolean
  /** Kept in past meetings as this meeting (the Feed shows it once). Absent: not kept. */
  keptAs?: string
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
   * Superseded by `transcription` (2026-10-06); still read from records saved
   * before it: true there means TranscriptionChoice.TalkWeave. Settings drops
   * it the first time a transcription choice is made.
   */
  talkWeaveLocal?: boolean
  /** Settings > Recording: who transcribes. Absent: see transcriptionChoice() (Auto, or TalkWeave for an old opt-in). */
  transcription?: TranscriptionChoice
  /** Settings > Recording: what the Record tab opens for a fresh draft. Absent: DefaultRecording.Solo. */
  defaultRecording?: DefaultRecording
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
  /** Demo accounts made on this phone (QR > Demo account, 2026-10-06). Absent: none. (Stored key kept from v1.) */
  testAccounts?: DemoAccount[]
  /** This phone is somebody's demo account. Absent: an ordinary phone (today's behaviour). (Stored key kept from v1.) */
  testOf?: DemoOf
  /** A demo account's finds, newest first, capped. Absent: none. */
  found?: Found[]
  /** Past meetings and memos, newest first (owner 2026-10-06). Absent: none stored yet; see pastMeetings(). */
  meetings?: PastMeeting[]
  /** Meetings other phones sent inside TrustWeb, newest first, capped. Absent: none. */
  received?: ReceivedShare[]
  /**
   * Demo accounts see only the demo content (owner 2026-10-06: "make sure the
   * entry of Max is not part of the demo for other people"). Absent: true.
   * Only in force while demo content is on this phone (`demo` set).
   */
  demoOnlyForDemoAccounts?: boolean
  /**
   * Recordings on the Swiss server (wave 1733 round B): the hosted account's
   * secret (made on this phone, rides inside the encrypted backup) and what is
   * stored there. The same account carries the server transcription. Absent: never used.
   */
  hosting?: HostingState
  /** The person said yes, once, to audio going through the Swiss server for transcription. Absent: not asked yet. */
  serverTranscriptionConsentAt?: number
  /** Inventory files imported (Settings > Inventory), newest first, for "Undo import". Absent: none. */
  imports?: ImportBatch[]
  /** Settings > Feed (wave 1733 round B, items 1 and 2). Absent: the Feed off (wave 2, P9), nothing from the fediverse. */
  feed?: FeedSettings
}

export interface FeedSettings {
  /** The Feed tab in the bottom bar. Absent: off (wave 2, P9: optional and later). Off: the bar is exactly as before. */
  on?: boolean
  /** "Also show posts from" people's Mastodon / Pixelfed addresses. Absent: off. */
  remote?: boolean
  /** Show pictures in those posts (each one a second request to their instance). Absent: off. */
  images?: boolean
  /** The person's own Mastodon instance, for "Share to Mastodon" (host only). Absent: asked when sharing. */
  myInstance?: string
  /** The person's own Pixelfed instance, for "Share to Pixelfed" (host only). */
  myPixelfed?: string
}

/** The Feed is optional and early (Jakob, wave 2, P9): off unless switched on in Settings > Feed. */
export function feedOn(s: Pick<AppState, 'feed'>): boolean {
  return s.feed?.on === true
}

export interface HostingState {
  /** 32 random bytes, hex (swiss_server.ts hostedAccount derives account, token and key from it). */
  secret: string
  /** Settings > "Hosted on the Swiss server": new recordings go up by themselves. */
  on: boolean
  recs: HostedRec[]
}

/** One recording stored on the Swiss server: which meeting it belongs to and its id there. */
export interface HostedRec {
  meetingId: string
  rid: string
  seconds: number
  bytes: number
  at: number
  /**
   * Written BEFORE the upload, cleared when the server said it stored it
   * (review-app-b): an answer lost on the way is retried under the SAME id (an
   * idempotent replace), never a second copy charged to the allowance. Absent: stored.
   */
  pending?: boolean
}

/** One "Import inventory file": what it added, so Undo removes exactly that (and nothing the person changed since). */
export interface ImportBatch {
  id: string
  at: number
  exportedOn: string
  /**
   * `sig`: a fingerprint of the text and who can ask as imported (safe_text.ts),
   * so Undo can tell "changed since" without a second copy of every text in the
   * record (review-app-b). Batches saved before kept `text` and `audience` instead.
   */
  items: { itemId: string; key: string; sig?: string; text?: string; audience?: Audience }[]
}

/** Demo content on this phone: these people and items were added as "imaginary friends" and are marked dummy. */
export function isDemoPerson(s: Pick<AppState, 'demo'>, personId: string): boolean {
  return Boolean(s.demo?.people.includes(personId))
}

export function isDemoItem(s: Pick<AppState, 'demo'>, itemId: string): boolean {
  return Boolean(s.demo?.inventory.includes(itemId))
}

export function demoOnlyForDemoAccounts(s: Pick<AppState, 'demoOnlyForDemoAccounts'>): boolean {
  return s.demoOnlyForDemoAccounts !== false
}

/** What an asker may be matched against: only these people and items (absent set = everything). */
export interface MatchScope {
  people?: ReadonlySet<string>
  inventory?: ReadonlySet<string>
}

/** The scope a demo account gets while demo content is on and the setting says so: the dummy content only. */
export function demoAccountScope(s: Pick<AppState, 'demo' | 'demoOnlyForDemoAccounts'>): MatchScope | undefined {
  if (!s.demo || !demoOnlyForDemoAccounts(s)) return undefined
  return { people: new Set(s.demo.people), inventory: new Set(s.demo.inventory) }
}

/** The thread id a matcher hit carries ("inv:<item>" or "note:<person>:<line>") says whether it is demo content. */
export function threadIsDemo(s: Pick<AppState, 'demo'>, threadId: string): boolean {
  const [kind, id] = threadId.split(':')
  return kind === 'inv' ? isDemoItem(s, id) : kind === 'note' ? isDemoPerson(s, id) : false
}

const DAY_MS = 86_400_000

/**
 * Past meetings, newest first: the stored ones plus, for notes saved before
 * meetings were stored at all, one entry per person and day built from their
 * notes (so an earlier meeting with its place is found again, nothing lost).
 * A day whose notes ALL came from a stored meeting (their source names it) is
 * left out: that meeting is listed itself, or was deleted on purpose, and the
 * notes stay on the person's card either way (review P1, wave 1733 round B).
 */
export function pastMeetings(s: Pick<AppState, 'meetings' | 'people'>): PastMeeting[] {
  const out: PastMeeting[] = [...(s.meetings ?? [])]
  const covered = new Set(out.filter((m) => m.personId).map((m) => `${m.personId}:${Math.floor(m.startedAt / DAY_MS)}`))
  for (const p of s.people) {
    const byDay = new Map<number, NoteLine[]>()
    for (const l of p.lines) {
      const day = Math.floor(l.notedAt / DAY_MS)
      byDay.set(day, [...(byDay.get(day) ?? []), l])
    }
    for (const [day, lines] of byDay) {
      if (covered.has(`${p.id}:${day}`) || lines.every((l) => Boolean(l.source?.meetingId))) continue
      const at = lines.map((l) => l.notedAt)
      out.push({
        id: `notes:${p.id}:${day}`, about: p.name, kind: AboutKind.Who, personId: p.id, where: p.context,
        startedAt: Math.min(...at), endedAt: Math.max(...at), durationMs: 0, meeting: false,
        lines: lines.map((l) => ({ text: l.text, tag: l.tag })), transcript: [],
      })
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt)
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

/** Settings > Recording: who turns a recording into text (owner 2026-10-06). */
export enum TranscriptionChoice {
  /** TalkWeave behind this site, else speech on this device, else later. Never reaches into this computer unasked. */
  Auto = 'auto',
  /** TalkWeave on this computer (the browser asks once to let this page reach it), else as Auto. */
  TalkWeave = 'talkweave',
  /** Only the device's own speech recognition; audio never leaves the phone. */
  OnDevice = 'on-device',
  /** Nothing live: the recording is transcribed later on the computer. */
  Later = 'later',
  /**
   * The Swiss server, when the recording stops (wave 1733 round B): the audio
   * leaves this phone, after a one-time yes. A build that does not know it reads Auto.
   */
  Server = 'server',
}

export const TRANSCRIPTION_CHOICES: readonly TranscriptionChoice[] = [
  TranscriptionChoice.Auto, TranscriptionChoice.TalkWeave, TranscriptionChoice.OnDevice, TranscriptionChoice.Server, TranscriptionChoice.Later,
]

/** Settings > Recording: what the Record tab opens for a fresh draft (owner 2026-10-06). */
export enum DefaultRecording {
  /** "Just me": a voice memo. */
  Solo = 'solo',
  /** "A meeting": who/where, consent, speakers. */
  Meeting = 'meeting',
}

export const DEFAULT_RECORDINGS: readonly DefaultRecording[] = [DefaultRecording.Solo, DefaultRecording.Meeting]

/**
 * The transcription choice in force. A record saved before the choice existed
 * keeps what it had: the old opt-in "Use TalkWeave on this computer" reads as
 * TalkWeave, everything else as Auto.
 */
export function transcriptionChoice(s: Pick<AppState, 'transcription' | 'talkWeaveLocal'>): TranscriptionChoice {
  if (s.transcription && TRANSCRIPTION_CHOICES.includes(s.transcription)) return s.transcription
  return s.talkWeaveLocal === true ? TranscriptionChoice.TalkWeave : TranscriptionChoice.Auto
}

/** What the record view starts from; anything unknown is Solo. */
export function defaultRecording(s: Pick<AppState, 'defaultRecording'>): DefaultRecording {
  return s.defaultRecording === DefaultRecording.Meeting ? DefaultRecording.Meeting : DefaultRecording.Solo
}

/** Which engines a recording may try, in order: TalkWeave (same-origin, then this computer), then on-device. */
export interface EnginePlan {
  /** TalkWeave behind this site (the dev server's /talkweave proxy). */
  sameOrigin: boolean
  /** TalkWeave on this computer (127.0.0.1): makes Chromium ask for local network access, so opt-in only. */
  direct: boolean
  /** The device's own speech recognition. */
  onDevice: boolean
}

export function enginePlan(choice: TranscriptionChoice): EnginePlan {
  switch (choice) {
    case TranscriptionChoice.Auto: return { sameOrigin: true, direct: false, onDevice: true }
    case TranscriptionChoice.TalkWeave: return { sameOrigin: true, direct: true, onDevice: true }
    case TranscriptionChoice.OnDevice: return { sameOrigin: false, direct: false, onDevice: true }
    case TranscriptionChoice.Later: return { sameOrigin: false, direct: false, onDevice: false }
    // Nothing live: the server transcribes when the recording stops.
    case TranscriptionChoice.Server: return { sameOrigin: false, direct: false, onDevice: false }
  }
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
export function threadsForRing(s: AppState, ring: Ring, scope?: MatchScope): { threads: ChatThread[]; refs: Map<string, LineRef> } {
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
    if (scope?.inventory && !scope.inventory.has(item.id)) continue
    push(`inv:${item.id}`, item.text, INVENTORY_CONTEXT, item.createdAt)
  }
  for (const person of s.people) {
    if (scope?.people && !scope.people.has(person.id)) continue
    for (const line of person.lines) {
      if (line.status !== LineStatus.Current || !audienceAdmits(line.audience, ring)) continue
      push(`note:${person.id}:${line.id}`, line.text, notesContext(person), line.notedAt)
    }
  }
  return { threads, refs }
}

/**
 * What an answer carries for each shared line: its text, a coarse date and its
 * context, nothing else (no ids, no provenance, no exact time). net.ts builds
 * every answer with this, so the no-leak test covers exactly what is sent.
 */
export function sharedItems(matches: readonly LineRef[]): { text: string; when: string; context: string }[] {
  return matches.map((m) => ({ text: m.text, when: coarseWhen(m.at), context: m.context }))
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
