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
import type { SignalProvider } from './channel'
import type { ChatBook } from './chat'
import type { ConnectRecord } from './connect_code'
import type { ShareSettings } from './contact_share'

export enum Ring {
  Close = 'close',
  Friend = 'friend',
  Acquaintance = 'acquaintance',
  /** A tier below acquaintance: someone you plan to meet, not yet in your web. */
  Intending = 'intending',
}

export const RINGS: readonly Ring[] = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]

/** The web search engines of "Search the web instead" (wave 2, B8; web_search.ts). A fixed set. */
export enum SearchEngine {
  Google = 'google',
  Ecosia = 'ecosia',
  Qwant = 'qwant',
  Brave = 'brave',
}

/**
 * Who transcribes, where and under which data policy, as GET /hosted/status
 * reports it in its `provider.transcribe` block (contract v1.5). The consent
 * copy is built from it, so the app never claims a route the server does not
 * take. A value this build does not know reads as null (named generically).
 */
export enum TranscribeProviderName {
  OpenRouter = 'openrouter',
  Infomaniak = 'infomaniak',
  /** Berget AI, Sweden (wave 3: the default provider; OpenRouter only as its fallback). */
  Berget = 'berget',
}

/** Where the INFERENCE runs (not where our server is). */
export enum InferenceRegion {
  Us = 'us',
  Ch = 'ch',
  /** Sweden, in the EU (Berget). */
  Se = 'se',
  /** Somewhere in the EU, not narrowed down further. */
  Eu = 'eu',
}

/** OpenRouter's data-collection setting sent with every call; Infomaniak has none (null). */
export enum ProviderDataPolicy {
  Deny = 'deny',
  Allow = 'allow',
}

/** One transcription route: who, where the inference runs, which data policy is sent. */
export interface TranscribeRoute {
  provider: TranscribeProviderName | null
  region: InferenceRegion | null
  dataPolicy: ProviderDataPolicy | null
}

export interface TranscribeProviderInfo extends TranscribeRoute {
  /**
   * Wave 3: the provider that takes over when the active one is down (5xx,
   * timeout), so audio can end up there too. null: the server says there is
   * none. undefined: the server did not say (older servers).
   */
  fallback?: TranscribeRoute | null
}

/**
 * The yes to transcription on a server, bound to the route it was given for
 * (wave 3, D7 of review-wave2): provider, region, data policy and fallback as
 * the server reported them at that moment. A different route asks again. The
 * values are kept as the server's strings (an older or newer build may not
 * know them as enum values).
 */
export interface ServerConsentRoute {
  provider: string | null
  region: string | null
  dataPolicy: string | null
}

export interface ServerConsent extends ServerConsentRoute {
  at: number
  fallback: ServerConsentRoute | null
}

/** In the order the row shows them (Jakob's list, Max meeting 00:16:53). */
export const SEARCH_ENGINES: readonly SearchEngine[] = [SearchEngine.Google, SearchEngine.Ecosia, SearchEngine.Qwant, SearchEngine.Brave]

/**
 * Who may ask about one line: the three tiers (acquaintances, friends, close
 * friends) and "Only me" (Jakob, wave 2, P22/P26). Each tier admits itself and
 * everyone closer. Never sent anywhere: it only decides what an asker is matched against.
 */
export enum Audience {
  /** Acquaintances too: anyone in my rings (and, once the second hop ships here, their friends). Value kept from before wave 2. */
  FriendsOfFriends = 'fof',
  /** Friends and close friends only. */
  Friends = 'friends',
  /** Close friends only (wave 2). An older build reads it as "nobody": its matcher admits no ring for an unknown value. */
  Close = 'close',
  /** Nobody but me. */
  OnlyMe = 'me',
}

/** In the order the pill cycles through and the item sheet lists them: widest first. */
export const AUDIENCES: readonly Audience[] = [Audience.FriendsOfFriends, Audience.Friends, Audience.Close, Audience.OnlyMe]

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
  /** Wave 6: how many degrees past my direct contacts it may answer (cascade.ts). Absent: 0 for a note about a person. */
  degrees?: number
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
  /** Imported: when the person opened it and kept it ("Reviewed", wave 2, B4). Absent: unreviewed. Local only. */
  reviewedAt?: number
}

/**
 * The three provenance states from the Max meeting (wave 2, B4): an imported
 * line is "unreviewed" until the person keeps it ("mass-imported" then);
 * recorded and typed lines are "created step by step". Derived, never stored.
 */
export enum ProvenanceState {
  Unreviewed = 'unreviewed',
  MassImported = 'mass-imported',
  StepByStep = 'step-by-step',
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
  /**
   * Wave 6e: a free-text note about this person, written under "Advanced" on their card (general_notes.ts), at most 4000 characters.
   * ONLY ME, always: it is not a note line, so it never answers an ask, passes through a hop, matches a search by others, joins an export,
   * a provenance entry or any share or contact payload (test/unit/general_notes.test.mjs guards every place that names it). Absent: none.
   */
  generalNote?: string
  /** Wave 6e: no longer chosen or shown; still read from older records and ignored. */
  signalProvider?: SignalProvider
  /**
   * What this person shared with me when we connected (contact_share.ts): ticked by them, validated on receipt. SEPARATE from `channels`,
   * which stays the owner's own typed list and is never written from the wire. Absent: nothing shared.
   */
  theirChannels?: Partial<Record<Channel, string>>
  /** Wave 6e: no longer stored from the wire; an older record may still hold it, ignored. */
  theirSignalProvider?: SignalProvider
  theirChannelsAt?: number
  /**
   * Wave 6: their asks may go on through me to my own contacts (hops.ts), when
   * they ask further than one step. Absent: the default (passesAsksOn).
   */
  passOn?: boolean
  /**
   * Wave 6 (N6, one Jakob): the front door (services/trustweb-peer) that is
   * this person's own inventory, connected as a second peer but shown as this
   * one person. Absent: none.
   */
  doorPeerId?: string
}

/**
 * Do this person's asks go on through me by default? Close friends and friends
 * yes, acquaintances and people I only intend to meet no (Jakob 2026-10-07:
 * "per default, if I have close friends, I should be able to just share their
 * inventory as well. Or to be able to choose"). The per-person setting wins.
 */
export function passesAsksOn(p: Pick<Person, 'passOn' | 'ring'>): boolean {
  if (typeof p.passOn === 'boolean') return p.passOn
  return p.ring === Ring.Close || p.ring === Ring.Friend
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
  /**
   * Notes added to this thing later ("Who or what was this about?" > an existing item, wave 5): context, oldest first, at most
   * CONTEXT_MAX (note_fields.ts). This phone only: the matcher reads the item's text alone and answers never carry it. Absent: none.
   */
  context?: InventoryContext[]
  /** Wave 6: how many degrees past my direct contacts it may answer (cascade.ts). Absent: by audience (acquaintances 1, else 0). */
  degrees?: number
}

/** One note added as context to an inventory item. */
export interface InventoryContext {
  text: string
  at: number
  /** The recording it came from, when there was one (chain of proof). */
  meetingId?: string
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
  /** Wave 6: how many of my contacts I passed this ask on to (hops.ts). Absent: not passed on. */
  passedOn?: number
  /** Wave 6: how many lines came back from them and went on to the asker. Absent: none. */
  cameBack?: number
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
  /**
   * Wave 6 (N5): kept until the person leaves, never taken down by the clock (account_keep.ts). Absent: a demo account that ends at
   * `expiresAt`, exactly as before. Its `expiresAt` is moved far out when kept, so a build that ignores this field still keeps it.
   */
  keep?: boolean
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
  /** Wave 6 (N5): this phone asked its owner to keep the account ("Make it your personal account"); waiting for his yes. Absent: not asked. */
  keepAsked?: boolean
  /** Wave 6 (N5): the owner keeps this account until the person leaves; `expiresAt` is gone. Absent: a demo account. */
  kept?: boolean
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
  shared: { from: string; peerId?: string; items: { text: string; context: string; when: string; via?: string[] }[] }[]
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
  lines: { text: string; tag: Tag; atMs?: number; line?: number; audience?: Audience }[]
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
  /** What was typed under "General notes" on Record (wave 5), as typed. Absent: none. */
  generalNotes?: string
  /** A plain note, about neither a person nor a thing ("none of these", wave 5): kept here only, with no link. Absent: false. */
  plain?: boolean
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

/**
 * The record's data format. Every change since the first one has been optional
 * fields only, so it stays 1 (review-app-a: a different number would make an
 * older build keep the record aside). Shown in Settings > About (wave 2, P20).
 */
export const RECORD_FORMAT = 1

export interface AppState {
  v: typeof RECORD_FORMAT
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
  /** Which of my links go to a new connection (contact_share.ts). Absent: nothing is shared. */
  contactShare?: ShareSettings
  /** peer id -> fingerprint of the contact already sent to that peer (so it is sent once per change). */
  contactSent?: Record<string, string>
  /**
   * peer id -> the channels (and values) that contact text carried, next to the fingerprint above (wave 6e): a later scan in a narrower
   * mode does not send a smaller set over a bigger one. Absent in older records; an older build ignores it.
   */
  contactSentChannels?: Record<string, Partial<Record<Channel, string>>>
  /**
   * Wave 6e: the share mode shown on Meet last (share_modes.ts ShareMode, kept per phone: Meet opens with it) and the pinned modes
   * (at most two, first pin first). Absent: the default order. A stored mode whose link was removed falls back to the default; an
   * unknown value is dropped at boot. An older build ignores both.
   */
  shareMode?: string
  sharePins?: string[]
  /**
   * The persistent connect code this phone registered on the server (connect_code.ts): {code, secret, url, updatedAt}.
   * Stays on this phone (the secret is a password); absent until the first successful registration and on a phone
   * that is not served from one of the two app origins. Older builds ignore it.
   */
  connectCode?: ConnectRecord
  /** Chat threads per connected peer id (chat.ts): at most 200 messages of 500 characters per person, 300 threads. */
  chats?: ChatBook
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
  /**
   * Settings > Advanced (wave 3): ask only my direct contacts. On: every ask
   * carries `direct: true` and nobody passes it on. Absent or anything but
   * true: off (the default: one hop, plus whatever the front doors allow).
   * An older build ignores it.
   */
  askDirectOnly?: boolean
  /**
   * Wave 6: how far this phone's asks travel ("How far?" in the ask dock):
   * hops.ts maxHops, 1..HOP_CAP or HOPS_UNBOUNDED. Absent: 1 (my contacts).
   * `askDirectOnly` wins. An older build ignores it.
   */
  askReach?: number
  /**
   * Wave 6 (Jakob 2026-10-08: "all my notes should be queriable"): meeting notes also answer asks that
   * arrive through this phone (notes_source.ts), each hit still in front of the person for a yes or no.
   * Absent: on for a personal account, off for a demo phone or a demo account (notesMatchDefault).
   */
  asksMatchNotes?: boolean
  /**
   * Wave 3: the web search engines this phone said yes to sending its words
   * to, for results inside the app (web_results.ts; once per engine). Absent: none.
   */
  webSearchConsent?: string[]
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
  /**
   * Before wave 3: the bare time of the yes to server transcription. Wave 3
   * reads it as NO consent (it names no route; no live phone holds one) and
   * deletes it with every new yes or withdrawal, so a rollback never revives
   * a yes that named nobody. Absent: never given (or replaced).
   */
  serverTranscriptionConsentAt?: number
  /** Wave 3: the yes to server transcription with the route it covers (server_consent.ts). Absent: not given. */
  serverTranscriptionConsent?: ServerConsent
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

/** "Ask only my direct contacts" (wave 3): on only when the record says exactly true. */
export function askDirectOnly(s: Pick<AppState, 'askDirectOnly'>): boolean {
  return s.askDirectOnly === true
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

/**
 * The engine list in Settings > Recording (wave 3): transcription on a server
 * is never one of these radios but an extra button below them ("see where"),
 * so "Automatic" and the rest never send audio away. TRANSCRIPTION_CHOICES
 * still knows Server: a stored "server" stays readable.
 */
export const ENGINE_CHOICES: readonly TranscriptionChoice[] = [
  TranscriptionChoice.Auto, TranscriptionChoice.TalkWeave, TranscriptionChoice.OnDevice, TranscriptionChoice.Later,
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
    case Audience.Close:
      return ring === Ring.Close
    case Audience.FriendsOfFriends:
      return true
    default:
      // A value this build does not know (a newer build's) admits nobody: fail closed.
      return false
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
    threads.push(lineThread(s.me.displayName, threadId, text, context, at))
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

/** One line as the matcher reads it: a single-message thread, source 'self' (owner-declared), like apps/demo's inventoryThreads(). */
export function lineThread(owner: string, threadId: string, text: string, context: string, at: number): ChatThread {
  return {
    id: threadId,
    title: context,
    kind: 'direct',
    participants: [owner],
    messages: [{ ts: new Date(at).toISOString(), author: owner, text, system: false }],
    source: 'self',
    included: true,
  }
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
