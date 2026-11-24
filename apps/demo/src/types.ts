/**
 * Shared data contract for the Web-of-Trust demo.
 *
 * Everything here is pure data. No DOM, no IndexedDB, no network. Keep it that
 * way so the matcher, the parser and the gate can be unit-tested in isolation.
 */

// ---------------------------------------------------------------------------
// Imported chat material
// ---------------------------------------------------------------------------

export type ChatSource =
  | 'whatsapp-ios'
  | 'whatsapp-android'
  | 'signal-desktop'
  | 'telegram-json'
  | 'seed'
  /**
   * Not an import: a thread synthesized from an inventory entry she typed
   * in herself. See state.ts's inventoryThreads(). Kept distinct from
   * 'seed' so a source dump never mislabels her own words as demo fixture
   * data.
   */
  | 'self'

export interface ChatMessage {
  /** ISO-8601 local timestamp as parsed from the export. */
  ts: string
  author: string
  text: string
  /** True for join/leave/encryption notices and other non-human lines. */
  system: boolean
}

export type ThreadKind = 'group' | 'direct'

export interface ChatThread {
  id: string
  title: string
  kind: ThreadKind
  participants: string[]
  messages: ChatMessage[]
  source: ChatSource
  /**
   * Whether this thread is in scope for queries.
   * Groups default to true, 1-on-1 threads default to FALSE: the user opts in
   * to direct conversations, never the other way round.
   */
  included: boolean
}

// ---------------------------------------------------------------------------
// Profile: who this person is, local to their own device
// ---------------------------------------------------------------------------

/**
 * A person's own profile. Lives in DeviceState, same as `threads` and
 * `inventory`, and is subject to the identical rule: nothing here reaches a
 * requester except through the existing Gate-2 consent step in gate.ts. This
 * demo build does not surface any profile field in an AnswerEnvelope at all
 * -- see gate.ts's GateInput, which has no `profile` field to plumb one
 * through, and test/gate_profile_privacy.test.ts, which pins that shut.
 */
export interface Profile {
  displayName: string
  /** "Was mich ausmacht" -- a short self-description, in her own words. */
  bio: string
  /** Grätzl / neighbourhood, e.g. "Ottakring". Free text, not a picklist. */
  neighbourhood: string
  languages: string[]
}

// ---------------------------------------------------------------------------
// Her own inventory: things she has, knows or can offer, typed in herself
// ---------------------------------------------------------------------------

export interface InventoryItem {
  id: string
  text: string
  /** ISO-8601 local timestamp of when she typed it in. */
  createdAt: string
  /**
   * Whether this entry is in scope for matching. Defaults to TRUE when a
   * new entry is created (see state.ts's addInventoryItem) -- the opposite
   * default from ChatThread.included on a 1-on-1 thread below, and
   * deliberately so: a 1-on-1 chat's content originates with someone else
   * and she is opting IN to exposing it, whereas an inventory entry is
   * something she sat down and typed on purpose, so it starts visible.
   */
  included: boolean
}

// ---------------------------------------------------------------------------
// Query templates
// ---------------------------------------------------------------------------

export type Sensitivity = 'low' | 'medium' | 'high'

export interface QueryTemplate {
  id: string
  version: number
  category: string
  title: { de: string; en: string }
  /** The question as a person would actually ask it. */
  question: { de: string; en: string }
  /**
   * Lowercased, de-umlauted match terms. A term containing a space is matched
   * as a phrase; otherwise it is matched against stemmed tokens.
   */
  matchTerms: string[]
  /** Terms that make a hit much more likely to be a real lead. */
  boostTerms: string[]
  /** Terms that veto a message even if it matched (e.g. "suche" for an offer query). */
  excludeTerms: string[]
  /** Minimum score for a message to count as a candidate hit. */
  minScore: number
  /**
   * Minimum number of DISTINCT AUTHORS who must have said something matching
   * before anything may be offered.
   *
   * Authors, not messages. Counting messages does not anonymise anybody: seven
   * messages from one neighbour clear a floor of seven and all seven are hers,
   * so the floor that is supposed to protect the most exposed person in the
   * chat protects nobody. Enforced by match/lexical.ts and asserted in
   * test/match_kanon.test.ts.
   */
  kThreshold: number
  sensitivity: Sensitivity
  ttlSeconds: number
}

// ---------------------------------------------------------------------------
// Matching (runs only on the answering device, never leaves it)
// ---------------------------------------------------------------------------

export interface MatchHit {
  threadId: string
  threadTitle: string
  messageIndex: number
  message: ChatMessage
  score: number
  /** Which match/boost terms fired. For the "what exactly would I share" screen. */
  terms: string[]
  /**
   * The source of the thread this hit came from (state.ts's inventoryThreads()
   * and main.ts's secondBrainThread() both set 'self': the device owner's own
   * declared entry, never a real contact's chat message). Pushed straight
   * through from ChatThread.source at the point matchTemplate() builds the
   * hit (lexical.ts), so a bypass decision there never has to re-derive it.
   * See lexical.ts:171 area for the one place this field changes behaviour:
   * a hit set that is entirely 'self' clears the anonymity floor regardless
   * of distinctAuthors, because an inventory/second-brain entry has no third
   * party to protect -- the author IS the person about to consent.
   */
  source: ChatSource
}

export interface MatchResult {
  hits: MatchHit[]
  /**
   * How many DISTINCT people wrote the hits, counting only hits that clear the
   * relevance bar. This is the number the anonymity floor is compared against.
   */
  distinctAuthors: number
  /**
   * True when distinctAuthors >= template.kThreshold, OR (B-08, 2026-09-06)
   * when every relevance-band hit is owner-declared (MatchHit.source ===
   * 'self') -- see match/lexical.ts's matchTemplate() for the one place this
   * is computed.
   */
  aboveThreshold: boolean
}

// ---------------------------------------------------------------------------
// The wire protocol (QR payloads)
// ---------------------------------------------------------------------------

export const WIRE_VERSION = 1

export interface Identity {
  /** Short stable id, 8 chars. */
  id: string
  displayName: string
}

/** QR 1: the connection ceremony. */
export interface ConnectEnvelope {
  v: 1
  t: 'connect'
  from: Identity
  /** Random, binds the pair. */
  nonce: string
  /**
   * OPTIONAL: sender's did:peer:2 (did.ts), present only in relay-mode
   * builds (mode.ts). A demo-1 (qr-mode) connect code never carries this
   * field, and `decodeFromQr` must still parse a code that lacks it -- the
   * whole point of making it optional is that qr-mode's wire is unchanged.
   * The peer's did is how relay.ts's `send()` addresses them once paired;
   * see state.ts's `Peer.did`.
   */
  did?: string
}

/**
 * The one-scan connect-link ceremony's reply (connect_link.ts): sent by a
 * phone that opened a connect LINK (never a QR -- see that module's header
 * for why a link is the whole point of this envelope existing) back to the
 * laptop that showed it, over the relay, once the phone has minted its own
 * did:peer:2 and registered with the relay.
 *
 * Deliberately carries NO nonce and NO other secret. The pairing key comes
 * from X25519 ECDH between the two `did`s (crypto.ts's `deriveEcdhPairKey`,
 * did.ts's `ecdhSharedSecret`), which only needs each side's PUBLIC key --
 * this envelope, like every relay wire's outer `to`/`from`, is safe to be
 * sent unencrypted (relay.ts's `sendRaw`) because the relay learning "these
 * two DIDs are pairing" is not new information (it must know both DIDs to
 * route anyway) and this carries no PRIVATE key material at all.
 *
 * `did` is REQUIRED here, unlike ConnectEnvelope.did (optional there for
 * qr-mode/demo-1 compatibility): a ConnectAckEnvelope only ever exists in
 * relay mode, so routing back to the phone always needs it.
 */
export interface ConnectAckEnvelope {
  v: 1
  t: 'connect-ack'
  from: Identity
  did: string
  /** Wave 8: the sender reached out through the receiver's public link (no relationship before). Additive; absent otherwise. */
  reachOut?: true
  /** Wave 44 steer-invite-link (TrustWeb invite_policy.ts): the signed community invite token, only ever inside the sealed connect-ack2. */
  inv?: string
}

/**
 * QR 2: B asks. Carries the template id and the nonce -- and, as of "call
 * into the web" (Ins Netzwerk rufen), OPTIONALLY a free-text ask instead of
 * one of the five fixed templates.
 *
 * `freeText` present means: `templateId` is the fixed sentinel
 * `FREE_TEXT_TEMPLATE_ID` (data/free_text_query.ts), `templateVersion` is
 * always 1, and the receiving device builds its own QueryTemplate from
 * `freeText` via `freeTextTemplate()` rather than looking `templateId` up in
 * `data/templates.ts`'s fixed catalogue. Kept as an addition to the existing
 * required `templateId`/`templateVersion` fields, not a replacement, so every
 * function that already reads those two fields (gate.ts's `buildSharedJsonBytes`,
 * the wire parser, every test fixture) keeps working unmodified for a
 * free-text query too.
 *
 * Bounded the same way ChatEnvelope.text is (wire.ts's CHAT_MAX_LEN):
 * free text is the one open-ended field this envelope can carry, and the
 * asking UI must say plainly that it crosses to the other device verbatim
 * (types.ts cannot enforce that half -- see screenAsk's free-text card).
 */
export interface QueryEnvelope {
  v: 1
  t: 'query'
  from: Identity
  templateId: string
  templateVersion: number
  /** Unique per ask. Also the AEAD nonce for the answer. */
  qid: string
  issuedAt: number
  /** Present only for a free-text ask. See this interface's doc comment. */
  freeText?: string
  /**
   * Demo 21 (secondHop scenario) only. Present and `true` ONLY on the fresh
   * QueryEnvelope a relaying hop composes when forwarding someone else's
   * question one step further (main.ts's `forwardToOwner`/D13-D16 shape,
   * `packages/agent-daemon`'s `forwardRelay`). Every ordinary query --
   * everything demos 1/2/3/6/20 ever send, and the ORIGINAL query the asker
   * themselves sends in demo 21 -- omits this field entirely; `undefined`
   * and `false` are never distinguished, only `true` means anything.
   *
   * THE DEPTH CAP (I8 "one hop, not N"): a device handling an incoming query
   * with `relayed === true` must never itself offer to relay it a second
   * time, regardless of whether it happens to hold a second-brain note that
   * would otherwise be eligible. Enforced in main.ts's relay-eligibility
   * check, not by scenario topology alone -- see that check's own comment.
   * No field anywhere lets the ASKER request a hop count; this flag is only
   * ever set by a relaying hop's own one-time local decision.
   */
  relayed?: true
  /**
   * "This is very important" (2026-09-06 decision, cooldown.ts). Present and
   * `true` ONLY when the asker has deliberately marked this specific ask as
   * an escalation past the receiving device's own repeat-ask cooldown
   * (cooldown.ts's ASK_COOLDOWN_MS) -- omitted on every ordinary ask, same
   * `undefined`-means-nothing convention as `relayed` above.
   *
   * This is a REQUEST, not a grant: the receiving device decides for itself,
   * from its OWN local cooldown record, whether this asker has already
   * spent their one-time escalation for this (asker, template-or-query-text)
   * pair -- see cooldown.ts's `decideAsk`. Setting this field on a second
   * ask after the first was already granted changes nothing; the recipient
   * ignores it and applies its ordinary cooldown decision. This is the
   * enforcement the feature depends on: an asker's own device cannot make
   * itself believe it has an escalation left by simply setting this field
   * again, because the field is not where the "spent" state lives.
   */
  escalated?: true
  /**
   * "Ask only my direct contacts" (TrustWeb wave 3, Settings > Advanced).
   * Present and `true` ONLY when the ASKER chose to reach their direct
   * contacts and nobody beyond them: a device that receives such an ask
   * answers from its own lines and never passes it on (no relay, no front
   * door forwarding it to a second person). Same `undefined`-means-nothing
   * convention as `relayed`/`escalated`; an older build ignores the field
   * (parseQuery picks known fields only), so it is safe across a rollback.
   * A relaying hop never sets it on the ask it composes, so `relayed` and
   * `direct` together mean a hop ignored the asker's wish (never surfaced).
   */
  direct?: true
  /**
   * TrustWeb wave 33 ("Ask for intros", apps/trustweb/src/intro_ask.ts): `kind: 'intro'` with a `target` (1..80 characters, the person,
   * organisation or topic the asker wants an introduction to). Both optional and always together; `freeText` still carries the readable
   * request, so an older build (which ignores both fields) shows it as an ordinary ask. No schema bump.
   */
  kind?: 'intro' | 'know' | 'show'
  /** Wave 44c seen-through: with kind 'show' the target is the name of the person who would see the receiver ("May Anna see you?"). */
  target?: string
  /**
   * Wave 44 steer-ask-escalation: `kind: 'know'` = the second round "Do you know someone who has this?" (no target; freeText is the original
   * question). `askedNames`: who this ask went to, sent ONLY to a recipient the asker placed as Closest few or Close and only when the asker
   * left it on (1..50 display names). Both optional; older builds ignore them (the ask then reads as an ordinary one).
   */
  askedNames?: string[]
  // ----- BEGIN TrustWeb wave 6 (U1): how far an ask travels (hops) -----
  // All optional; an older build's parseQuery copies known fields only, so it
  // ignores every one of them (the ask then behaves as one hop, as before).
  // Validated in wire.ts parseQuery (present-and-malformed rejects the whole
  // envelope); the rules that read them live in apps/trustweb/src/hops.ts.
  // An ask that goes to direct contacts only (maxHops 1, the default) carries
  // NONE of them: it is byte-for-byte the ask of the build before.
  /**
   * How many steps the ASKER lets the ask travel: 1 = my direct contacts
   * (never sent: absence means 1), 2 = friends of friends, up to HOP_CAP, or
   * HOPS_UNBOUNDED ("no limit", which still stops at HOP_CAP; never Infinity
   * in JSON). `direct: true` overrides it to 1.
   */
  maxHops?: number
  /** How often this ask was passed on before it reached the receiver: 0 = sent by the asker (or by a front door for its owner). */
  hop?: number
  /** The asker's id for this ask, the same on every hop (each hop mints its own `qid`): a phone answers one root once. */
  root?: string
  /**
   * Hashed ids (SEEN_ID_RE) of the asker and of every phone that passed the
   * ask on, salted with `root` (hops.ts seenHash): a phone never passes it to
   * anyone listed, so a cycle stops. The chain only, never anyone's contacts.
   */
  seen?: string[]
  /** Display names before the sender: the asker first, then the phones that passed it on (the sender is `from`). At most HOP_CAP. */
  via?: string[]
  /** Set by a front door (services/trustweb-peer) on an ask it forwards to its OWNER's phone: the same person, so not a hop. */
  door?: true
  // ----- END TrustWeb wave 6 (U1) -----
  // ----- BEGIN TrustWeb wave 6h: the asker's answer window -----
  /**
   * The asker's answer window in ms (apps/trustweb/src/ask_window.ts): every answer to this ask leaves the
   * receiver one window per step after it arrived, a yes after that moment travels as a separate LATE answer
   * (same qid, fresh IV). Absent: the 30 s window and the answer-when-decided rule of the builds before (an
   * older asker, a front door, an older phone passing the ask on). Older builds' parseQuery drop it.
   * Bounded by ANSWER_WINDOW_MS_MAX; present-and-malformed rejects the envelope like the hop fields.
   */
  answerWindowMs?: number
  // ----- END TrustWeb wave 6h -----
  // ----- BEGIN TrustWeb wave 6i: an earlier ask, asked again -----
  /**
   * Set ONLY on an ask the asker's phone sends again on its own, after the receiver tightened the asker's ring
   * (apps/trustweb/src/reask.ts): `originalQid` is the qid the receiver got the first time, `originalAt` the asker's
   * clock at that first ask (the receiver shows "Earlier ask from <name> (<date>)"). Carries nothing else.
   * Present-and-malformed rejects the envelope like the hop fields; older builds' parseQuery drop it (the ask then
   * reads as a new one).
   */
  reask?: ReaskRef
  // ----- END TrustWeb wave 6i -----
  /* wave44b hide-from-crypto */
  /** The asker's signed exclusion list as keyed tags (apps/trustweb/src/hide_from_crypto.ts ExclusionBlob); passed on unchanged, checked there. */
  hx?: Record<string, unknown>
  /** The level secret for this receiver (base64url, 32 bytes): sealed by the pair key like the whole envelope; lets it test candidates, never read the list. */
  hk?: string
}

// ----- BEGIN TrustWeb wave 6i -----
/** QueryEnvelope.reask: which earlier ask this one repeats. */
export interface ReaskRef {
  originalQid: string
  originalAt: number
}

/** ChatEnvelope.re: the ask a message answers (or follows up), so the message carries its question. */
export interface ChatRe {
  /** The qid of that ask between these two phones (each connection gets its own). */
  qid: string
  /** The ask's words, at most RE_TEXT_MAX characters. */
  text: string
  /** When it was asked (the sender's clock; display only). */
  at: number
}

/** The longest ChatRe.text: an ask's own bound (FREE_TEXT_MAX_LEN). */
export const RE_TEXT_MAX = 200
/** Wave 19: a profile picture rides beside a chat text as a small JPEG data URL (ChatEnvelope.pic), at most this many characters. */
export const PIC_MAX_LEN = 24 * 1024
export const isJpegDataUrl = (v: unknown): v is string => typeof v === 'string' && v.length <= PIC_MAX_LEN && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v)
/** A qid as this app mints it (crypto.ts randomId: base64url), bounded. Also ReaskRef.originalQid. */
export const QID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * "Ask me again" (TrustWeb wave 6i): sent, sealed with the pair key, by a phone whose person just TIGHTENED the receiver's
 * ring (or pressed "Get their earlier asks again"). The receiver re-sends the asks it made to the sender that were never
 * answered with a share (apps/trustweb/src/reask.ts). It carries no ring and no text: the receiver learns nothing about the
 * sender's lines. Loosening a ring sends nothing at all. An older build's decodeFromQr does not know `t` and returns null,
 * so its relay channel never acks the wire: it waits on the relay until that phone runs a build that reads it.
 */
export interface AskAgainEnvelope {
  v: 1
  t: 'ask-again'
}
// ----- END TrustWeb wave 6i -----

/**
 * TrustWeb wave 43c (sync-devices): "my other devices": sent, sealed with the pair key, by the device that made a connection, so the
 * connection also accepts (and sends chat text to) my other linked devices (apps/trustweb/src/device_alias.ts). Only DIDs, at most DEVICES_MAX.
 */
export interface DevicesEnvelope {
  v: 1
  t: 'devices'
  dids: string[]
}
export const DEVICES_MAX = 8
// ----- BEGIN TrustWeb wave 43c (social-hosting) -----
/**
 * Friends-first social hosting: ONE envelope type for the whole small protocol (apps/trustweb/src/social_hosting.ts HostMsg), sealed with the pair
 * key like chat. `m.k` is put | drop | get | rec | intent; the wire only guards the outer shape and size, the receiver checks the body (signatures).
 * An older build's decodeFromQr does not know `t` and returns null, so its relay channel never acks the wire.
 */
export const HOST_KINDS = ['put', 'drop', 'get', 'rec', 'intent'] as const
export const HOST_MAX_JSON = 8192
export interface HostEnvelope {
  v: 1
  t: 'host'
  m: { k: (typeof HOST_KINDS)[number]; [field: string]: unknown }
}
// ----- END TrustWeb wave 43c -----

// ----- BEGIN TrustWeb wave 43c (connect-extras): the event envelope -----
/** The longest EventEnvelope.link: far above a chat text (500), room for place, conditions and themes of one event. */
export const EVENT_LINK_MAX = 8192
/**
 * Sealed with the pair key like every envelope. Exactly one of two things: `want` (the id of an event the sender asks the receiver's device for) or
 * `link` (the event as an ordinary event link, event_link.ts; the receiver's decoder checks it). No server holds the event: the person who shows the
 * event QR answers from their own device. An older build's decodeFromQr does not know `t` and drops it.
 */
export interface EventEnvelope {
  v: 1
  t: 'event'
  want?: string
  link?: string
  /** Wave 44 steer-event-visibility: how the sender shows at this event, and "the host shares this with the whole community" (a link envelope only). */
  show?: 'open' | 'discoverable' | 'off'
  announce?: true
  /** Wave 44 steer-open-space: the schedule of an online open space (instead of `want` / `link`): `open` = the sender, a host, says the event is an open space; `acts` are checked by the receiver (open_space.ts). */
  os?: { id: string; open?: true; acts: unknown[]; poll?: unknown }
  /** Wave 44c event-autosave: the guest's answer to the host (yes = "I will attend"), and the host's conference links, sent only after a yes. */
  rsvp?: { id: string; yes: boolean }
  conf?: { id: string; links: { provider: 'kmeet' | 'zoom' | 'jitsi' | 'custom'; url: string }[] }
  /** Wave 44c seen-through: a host introduces a person at event `id` to its attendees; `who` (the name) only when that person's device said yes (`shown`). */
  seen?: { id?: string; shown: boolean; who?: string; tag?: string } // wave46 iyg-roster: `tag` without `id` = a community roster name (event_roster.ts)
  /** answers-44d: the guest accepted the invitation to event `id` (sent to the inviter and the hosts, who mark them joined). */
  joined?: { id: string }
  /** wave45 event-group-chat: one item of the event's ONE shared thread: a message (`text`), or a join / leave notice. `m` = the item id (dedupe), `by` = the author's name (a host forwards it on), `ts` = the author's clock. */
  gc?: { id: string; m: string; k: 'msg' | 'join' | 'leave'; by: string; ts: number; text?: string }
  /** wave45 group-chat-list: one op of a group (a chat independent of events, trustweb group_chat.ts): `g` = group id, `m` = op id, `by` = the actor's name,
   * `ts` = the actor's clock. msg / check carry `text`; join / leave none; list carries `list`, item carries `it`, roster carries `text` (group name) + `names`. */
  gg?: GroupOp
  /** wave45 merge-events: two events become one (trustweb event_merge_flow.ts). `ask` (a host of `keep` asks a host of `gone`; `link` = the kept event), `yes` / `no` (the answer), `done` (a host of `gone` tells its people; `link` = the kept event). */
  merge?: { step: 'ask' | 'yes' | 'no' | 'done'; keep: string; gone: string; link?: string }
  /** wave45 events-refetch: "send me the events you announced to my communities" (alone in the envelope). */
  sync?: true
  /** wave46 iyg-shared-resource: one resource shared into a community AND its event(s), synced (trustweb resource_sync.ts). `updatedAt` = the author's clock (last writer wins), `by` = the author's name (a host forwards it on), `retracted` = hidden for everyone. */
  res?: { id: string; text: string; communityId: string; eventIds: string[]; updatedAt: number; by: string; kind?: string; link?: string; blocks?: unknown[]; retracted?: true }
}
/** wave45 group-chat-list: see EventEnvelope.gg. */
export interface GroupOp {
  g: string; m: string; k: 'msg' | 'join' | 'leave' | 'check' | 'list' | 'item' | 'roster'; by: string; ts: number; text?: string
  list?: { id: string; name: string; act?: true }
  it?: { id: string; l: string; text: string; o: number; done?: { by: string; at: number }; arc?: true }
  names?: string[]
}
/** wave45 group-chat-list: bounds of a group op. */
export const GROUP_NAME_MAX = 60
export const GROUP_ITEM_TEXT_MAX = 200
export const GROUP_ROSTER_MAX = 50
/** wave45 event-group-chat: the longest text of one group-chat message (EventEnvelope.gc.text). */
export const EVENT_CHAT_TEXT_MAX = 2000
// ----- END TrustWeb wave 43c -----

// ----- BEGIN TrustWeb wave 6 (U1): bounds for the hop fields above -----
/** The furthest any ask travels (also what "no limit" means). Each step adds one answer window (gate.ts RELAY_DEADLINE_MS). */
export const HOP_CAP = 6
/** QueryEnvelope.maxHops for "no limit" (bounded by HOP_CAP in practice). */
export const HOPS_UNBOUNDED = -1
/** The longest name in QueryEnvelope.via / SharedItem.via. */
export const VIA_NAME_MAX = 40
/** The most entries QueryEnvelope.seen may carry: the asker, every forwarder and a front door's asker, with room to spare. */
export const SEEN_MAX = 16
/** One QueryEnvelope.seen entry: 16 lower-case hex characters. */
export const SEEN_ID_RE = /^[0-9a-f]{16}$/
/** QueryEnvelope.root: a random id like a qid. */
export const ROOT_RE = /^[A-Za-z0-9_-]{6,40}$/
// ----- END TrustWeb wave 6 (U1) -----

// ----- BEGIN TrustWeb wave 6h -----
/** The longest answer window an ask may carry (QueryEnvelope.answerWindowMs): ten minutes. */
export const ANSWER_WINDOW_MS_MAX = 600_000
// ----- END TrustWeb wave 6h -----

/** Bound for QueryEnvelope.freeText, same reasoning as wire.ts's CHAT_MAX_LEN
 *  for ChatEnvelope.text: the boundary must reject an oversized value rather
 *  than trust a sender's restraint. Defined here (not wire.ts) so gate.ts and
 *  data/free_text_query.ts can reference it without importing the wire
 *  parser. */
export const FREE_TEXT_MAX_LEN = 200

/**
 * QR 3: A answers.
 *
 * THE CENTRAL PRIVACY CONTRACT.
 *
 * There are exactly two outcomes visible to the asker: `nothing` and `shared`.
 * The four internal reasons for `nothing` -- no match, below k, declined,
 * blocked -- MUST produce byte-identical envelopes. The only field that may
 * vary is `body`, which is fixed-length in both cases.
 *
 * Enforced by test/gate_identity.test.ts. Do not add a field to this type
 * without adding it to that test.
 */
export interface AnswerEnvelope {
  v: 1
  t: 'answer'
  /** Echoes QueryEnvelope.qid. */
  qid: string
  /** Fixed-length. Opaque. Padded to ANSWER_BODY_LEN in every case. */
  body: string
}

export const ANSWER_BODY_LEN = 512

/**
 * A plain message between two paired devices, and a round-trip probe.
 *
 * Neither is part of the query protocol and neither goes through the consent
 * gate: they exist so a person can SEE that the connection is real. Watching a
 * word typed on a laptop appear on a phone answers "is this actually
 * connected" in a way a status line never will, and the probe puts a number on
 * it. Both are ordinary payloads on whichever transport is open, so they also
 * exercise the exact path a query would take.
 *
 * They carry no inventory, no chat history, and nothing gated. Do not route
 * anything through them that the gate would otherwise decide about.
 */
export interface ChatEnvelope {
  v: 1
  t: 'chat'
  from: Identity
  text: string
  /** Sender's clock, for ordering in the local log only. Never trusted. */
  ts: number
  /** TrustWeb wave 6i: the ask this message answers. Optional; older builds' parseChat drop it and show the text alone. */
  re?: ChatRe
  /** TrustWeb wave 19: the sender's profile picture (isJpegDataUrl), sent only on the owner's tap "Send my profile". Older builds' parseChat drop it. */
  pic?: string
}

/**
 * One type for both halves of the probe: `back: false` is the question,
 * `back: true` is the reply carrying the same `id`. Keeping it to one type
 * keeps wire.ts's parser table small, which is the file where every extra
 * branch is another way to accept something malformed.
 */
export interface PingEnvelope {
  v: 1
  t: 'ping'
  id: string
  back: boolean
}

/**
 * Reasons live only on the answering device. They are never serialised.
 *
 * `'relayed'`/`'relay-nothing'` (demo 21 / secondHop only): a hop that chose
 * to forward someone else's question one step further, recorded locally
 * (I6) so its OWN Protokoll can distinguish "I relayed and it came back
 * shared" from "I relayed and got nothing back" -- a distinction that must
 * never leak onto the wire (see gate.ts's module doc for why LocalOutcome
 * existing at all is safe: nothing here is ever serialised into an
 * AnswerEnvelope). A device that answers directly, with no relay involved,
 * never produces these two -- it keeps using the five reasons above,
 * unchanged, exactly as every other demo already does.
 */
/**
 * `'cooldown'`/`'muted'` (2026-09-06, cooldown.ts): two more local-only
 * "nothing" reasons, added alongside the original four (`no-match`,
 * `below-k`, `declined`, `blocked`) for the SAME reason `blocked` exists --
 * a device that has decided, ahead of time and for its own reasons, not to
 * engage with this particular ask still runs the full gate.ts `decide()`
 * path and still produces a byte-identical wire "nothing", it just gets to
 * remember WHY locally. `'cooldown'`: this asker sent the same
 * (template-or-query-text) too recently and did not have an unspent
 * escalation to spend (cooldown.ts's `decideAsk`). `'muted'`: this asker is
 * on this device's mute list (state.ts's `Peer.muted`) -- silenced
 * entirely, regardless of cooldown state.
 */
export type LocalOutcome =
  | 'no-match'
  | 'below-k'
  | 'declined'
  | 'blocked'
  | 'cooldown'
  | 'muted'
  | 'shared'
  | 'relayed'
  | 'relay-nothing'

// ---------------------------------------------------------------------------
// Repeat-ask cooldown (cooldown.ts) -- local-only, never transmitted
// ---------------------------------------------------------------------------

/**
 * One (asker, template-or-query-text) cooldown record, keyed by
 * cooldown.ts's `cooldownKey()`. Lives in DeviceState.askCooldowns on the
 * RECEIVING device (the enforcement this feature depends on: the asker's
 * own device cannot edit this record) and, in a parallel, best-effort,
 * UI-ONLY copy, in DeviceState.escalationHints on the ASKING device (see
 * that field's own doc comment for why it can never be authoritative).
 *
 * `windowStartAt` anchors the cooldown clock: the timestamp of the ask that
 * OPENED the current window (the first-ever ask for this key, or the first
 * one to arrive after a prior window had already elapsed naturally). An
 * escalated ask that is granted mid-window does NOT move this forward --
 * see cooldown.ts's `decideAsk` doc comment for why the natural expiry has
 * to stay anchored to the window's true start, not to whichever ask most
 * recently got through.
 *
 * `escalationUsedInWindow`: true once this asker's one-time "this is very
 * important" pass has been spent for the CURRENT window. Reset to false
 * only when the window itself naturally expires and a fresh one opens --
 * never by anything else, per this feature's spec ("gone until the cooldown
 * naturally expires").
 */
export interface AskCooldownRecord {
  windowStartAt: number
  escalationUsedInWindow: boolean
}

/** What the asking device is allowed to learn. */
export type VisibleOutcome = 'nothing' | 'shared'

export interface DecodedAnswer {
  outcome: VisibleOutcome
  /** Present only when outcome === 'shared'. */
  shared?: SharedPayload
}

export interface SharedPayload {
  from: string
  templateId: string
  items: SharedItem[]
}

export interface SharedItem {
  /** The message text as it stood in the chat. Messy on purpose. */
  text: string
  /** Coarse date only: "Mitte August" rather than a timestamp. */
  when: string
  /** Which group it came from, or 'eine Gruppe' if the user chose to blur it. */
  context: string
  /**
   * TrustWeb wave 6 (U1): the names an item passed through on its way back,
   * from the asker's side ("through B"); the person who holds it is not named.
   * Absent: the answering person's own line. Untrusted on arrival: read it
   * with apps/trustweb/src/hops.ts readVia.
   */
  via?: string[]
  /** Wave 44c seen-through (apps/trustweb/src/seen_through.ts): this item names a person the answerer knows; `shown` = that person's own yes to be shown. */
  shown?: boolean
  /** Wave 44c seen-through: that person's name, only with `shown: true` (at most VIA_NAME_MAX characters). */
  who?: string
}

// ---------------------------------------------------------------------------
// The local query log (I6 Auditability, CLAUDE.md) -- "Protokoll"
// ---------------------------------------------------------------------------

/**
 * One row of the local, never-transmitted record of every query this device
 * has RECEIVED. Lives in DeviceState.queryLog (state.ts), persisted the same
 * way as `inventory`/`threads`, and read only by screenLog() in main.ts.
 *
 * Deliberately narrow. It records what THIS device was asked and what THIS
 * device decided -- nothing about any other device, ever, because there is
 * nothing here that could name one: a query only ever names its own asker
 * (`fromDisplayName`/`fromId`), the one thing this device already legitimately
 * knows per I4 (contextual consent: the owner sees asker identity + request
 * text before deciding anything). Logging it locally does not teach the
 * asker, or any other peer, anything they could not already have caused this
 * device to know.
 *
 * `outcome` reuses LocalOutcome verbatim on purpose (see that type's doc
 * comment: "Reasons live only on the answering device. They are never
 * serialised."). A log entry MUST NEVER be built from, or fed into, anything
 * that crosses the wire -- gate.ts's AnswerEnvelope has no field for it and
 * never will (test/gate_identity.test.ts pins AnswerEnvelope's shape shut).
 * main.ts's emitAnswer() appends the log entry (via answer_log.ts's
 * logAndDispatch()) BEFORE the answer is sent (or shown as a QR) -- not
 * after. The entry's own cost still cannot shift when the wire message goes
 * out (a plain array push is O(1) and identical regardless of `outcome`),
 * but its EXISTENCE must not depend on that send ever completing: relay.ts's
 * ingress POST has no timeout, and a query this device answers ambiently and
 * silently has nobody watching a screen to notice a stalled send -- only the
 * local record would ever have shown it happened at all. See answer_log.ts's
 * module doc comment for the full argument.
 *
 * What is deliberately NOT stored: `match.hits` themselves. Only the label
 * (`outcome`) is kept, never the matched content. Two reasons: it keeps every
 * entry the same shape/size regardless of how many hits fired (no local
 * signal that could vary by outcome the way the wire's byte-padding already
 * guards against), and it means this log is not a second place chat content
 * ends up retained -- "was ich habe"/imported chats remain the one copy.
 */
export interface QueryLogEntry {
  id: string
  /** THIS device's own clock, when the query was received. Never the
   *  asker's `issuedAt` -- that is untrusted input (see PingEnvelope.ts,
   *  same discipline). */
  at: number
  fromDisplayName: string
  fromId: string
  /** What was asked, verbatim: the free-text ask, or the template's German
   *  question. Exactly what this device was shown before deciding -- I4
   *  already grants the owner this much, so recording it locally adds
   *  nothing new. */
  text: string
  /** What this device did about it. See LocalOutcome and this interface's
   *  doc comment on why it is safe to keep this granular locally even though
   *  the wire may never distinguish it. */
  outcome: LocalOutcome
}

/* wave44b hide-from-crypto */
/** The largest QueryEnvelope.hx as JSON (HIDE_TAGS_MAX tags at the furthest reach fit): a larger one rejects the envelope. */
export const HIDE_BLOB_MAX_JSON = 8192
/** The largest HideReportEnvelope.rep as JSON. */
export const HIDE_REPORT_MAX_JSON = 2048
/** QueryEnvelope.hk: 32 bytes, base64url. */
export const HIDE_KEY_RE = /^[A-Za-z0-9_-]{43}$/
/**
 * A tamper report on its way back to the asker (apps/trustweb/src/hide_from_crypto.ts TamperReport): sealed with the pair key, sent by the
 * device that found the exclusion list changed to the one that sent it the ask, and passed up hop by hop (qid = the ask that hop received).
 * The wire guards only the outer shape and size; the asker checks the report (signature, MAC). An older build drops the unknown `t`.
 */
export interface HideReportEnvelope {
  v: 1
  t: 'hide-report'
  qid: string
  rep: Record<string, unknown>
}
