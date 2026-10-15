/**
 * TrustWeb's network layer: apps/demo's relay transport, pairing and consent
 * gate, orchestrated for this app's rings. No DOM here; the UI passes callbacks.
 *
 * Reused as-is from apps/demo (not copied): the did:peer:2 identity and ECDH
 * pair key (did.ts, crypto.ts), the relay channel (relay.ts, through
 * app.idea2.site/relay/*), the one-scan connect link and its connect-ack
 * (connect_link.ts), the matcher (match/lexical.ts), the surface-or-stay-silent
 * decision (incoming_query.ts) and the sealed, fixed-length answer in which a
 * decline and a no-match are the same bytes (answer_key.ts / gate.ts).
 *
 * Timing: every answer, match or not, shared or declined, leaves this device
 * no earlier than RELAY_DEADLINE_MS (30 s) after the ask arrived, so a quick
 * automatic "nothing" cannot be told apart from a person saying no within
 * that window. A person who takes longer than 30 s to decide is answered the
 * moment they decide; the UI says so.
 *
 * Wave 6 (hops.ts): an ask may travel further than one step. A phone that may
 * pass it on (the asker's reach, this person's "pass their asks on", no cycle)
 * asks its own contacts the moment the ask arrives, without waiting for its
 * person, and puts what came back ("through <me>") into its ONE sealed answer,
 * which leaves at a moment fixed by the envelope alone (one window per step
 * left), whether or not anything was passed on.
 *
 * Wave 6f (THE ONE THING: whoever opens my link appears in MY web, also when I was offline): the phone that opened a link re-sends
 * its connect-ack until it hears from the sharer (ack_retry.ts); a tab that is not in front of the person no longer fights the one
 * in front for the relay drain (drain_lock.ts); an ask that arrives after its asker stopped waiting is kept as "asked while you were
 * away" instead of a consent prompt for nobody (away_asks.ts).
 *
 * Wave 6h (THE ONE THING: a connected person's ask reaches me and I can answer): the answer window is 120 s and travels on the ask
 * (ask_window.ts); an undecided prompt answers "nothing" at its moment and a later yes goes as a LATE answer, which the asker's app keeps
 * silently and shows on its next open (late_answers.ts); a prompt survives a reload (held_asks.ts); a direct contact's ask that matched
 * nothing leaves a quiet card for the ASKED person only (unmatched_asks.ts); refresh() reopens the drain after a sleep (wake_watch.ts).
 *
 * Wave 6i (THE ONE THING: an ask and its answer stay one conversation): a chat message may carry the ask it answers (chat_re.ts); an
 * ask-again envelope (sent only when this phone TIGHTENS a connection's ring) makes the other phone re-send its earlier unanswered asks
 * to this one, each marked as earlier (reask.ts); loosening sends nothing at all.
 *
 * DIDs stay in this layer. Nothing here hands a DID string to the UI.
 */
import { createIdentity, deserializeIdentity, serializeIdentity, ecdhSharedSecret } from '../../demo/src/did'
import type { Identity as DidIdentity } from '../../demo/src/did'
import { createRelayChannel } from '../../demo/src/relay'
import type { RelayChannel, RelayStatus } from '../../demo/src/relay'
import { deriveEcdhPairKey, randomId } from '../../demo/src/crypto'
import { decodeFromQr, encodeForQr } from '../../demo/src/wire'
import type { Envelope } from '../../demo/src/wire'
import { buildConnectAck, buildConnectLinkUrl } from '../../demo/src/connect_link'
import type { ConnectLinkParams } from '../../demo/src/connect_link'
import { interpret, settleAt } from '../../demo/src/gate'
import { sealRelayAnswer } from '../../demo/src/answer_key'
import { classifyIncomingQuery } from '../../demo/src/incoming_query'
import { matchTemplate } from '../../demo/src/match/lexical'
import { FREE_TEXT_MAX_LEN } from '../../demo/src/types'
import type { AnswerEnvelope, AskAgainEnvelope, ChatEnvelope, ChatRe, ChatThread, DecodedAnswer, MatchResult, QueryEnvelope, QueryTemplate, SharedItem, SharedPayload } from '../../demo/src/types'
import { ackDue, attemptAllowed, nextAttempts, noteAckSent, noteHeard } from './ack_retry'
import type { AckAttempts } from './ack_retry'
import { ANSWER_WINDOW_MS, carriesWindow, passOnWindowFields, receivedWindowMs, windowFields } from './ask_window'
import { AWAY_TEXT_MAX, isAwayAsk } from './away_asks'
import { askSources } from './cascade'
import { createDrainLock, drainLockName } from './drain_lock'
import type { DrainLock, LockManagerLike } from './drain_lock'
import { directFlag, surfacesHere } from './direct_ask'
import {
  askerOf, askFields, askReachOf, askTimeoutMs, answerDelayMs, cascadeFields, dedupeItems, hopInfo, markThrough, MAX_FANOUT,
  mayCascade, RootMemory, sanitizeHopItems, seenHash, throughOf,
} from './hops'
import type { HopInfo } from './hops'
import { NAMELESS_PEER, cleanHelloName } from './hello'
import { addHeldAsk, dropHeldAsk, liveHeldAsks } from './held_asks'
import { addLateAnswer, addSentAsk, addShownAnswer, forgetSentAsk, LATE_KEEP_MS, openWindowUntil, releaseLateAnswers, sentAskFor } from './late_answers'
import { askTemplate, foldThreadsForMatch, foldForMatch, forgivingAskTemplate, lineTextsOf } from './lexicon'
import { LogOutcome, RINGS, Ring, sharedItems } from './model'
import type { AppState, AwayAsk, HeldAsk, LineRef, LogEntry, MatchScope, Peer } from './model'
import { askPeers } from './non_responsive'
import { addUnmatchedAsk, dismissUnmatchedAsk, unmatchedReason, withOnlyMeOpened } from './unmatched_asks'
import { acceptsReaskFrom, askAgainAllowed, earlierAsk, noteEarlierAsk, noteReasked, reaskCandidates, reaskFields, reaskText, showsEarlierAsk, undoReasked } from './reask'
import type { EarlierAsk, ReaskPlan } from './reask'

export type { RelayStatus }

export { ANSWER_WINDOW_MS }
const RELEVANCE_BAND = 0.5
const MAX_SHARED = 3
/** A passed-on ask stops waiting for the next step this share of a window before this phone's own moment, to seal and send in time. */
const HOP_COLLECT_LEAD = 0.1
/** A tab in front of the person waits at most this long for the drain lock before it carries on (sends still work without the drain). */
const LOCK_WAIT_MS = 2_000

/** The template of an ask, for its id and what travels (the asker's own words only). */
export function templateFor(text: string): QueryTemplate {
  return askTemplate(text)
}

/**
 * The ONE place this file runs the matcher on an incoming ask (with apps/demo's prune). The
 * template is widened on THIS phone by the holder's own lines (typos, plurals, "Community hof"
 * for "Communityhof": lexicon.forgivingAskTemplate); nothing of that widening ever travels.
 */
export function matchAsk(text: string, threads: ChatThread[]): MatchResult {
  // Wave 6h: the same folding on BOTH sides (case, accents, umlauts, hyphens) before the matcher sees either.
  const folded = foldThreadsForMatch(threads)
  return prune(matchTemplate(forgivingAskTemplate(foldForMatch(text), lineTextsOf(folded)), folded))
}

/** Would this ask put a prompt in front of the person, matched against `threads`? */
function surfacesFor(text: string, threads: ChatThread[]): boolean {
  return classifyIncomingQuery(matchAsk(text, threads), false, true).surface
}

/** What came back from the people this phone passed an ask on to. */
interface HopHarvest {
  asked: number
  items: SharedItem[]
}

const NO_HARVEST: HopHarvest = { asked: 0, items: [] }

export interface IncomingAsk {
  qid: string
  fromName: string
  text: string
  matches: LineRef[]
  receivedAt: number
  /** Forwarded by a front-door peer (services/trustweb-peer) on behalf of somebody who asked it. */
  relayed: boolean
  /**
   * Wave 6: the people this ask came through on its way here, after its asker
   * (the sender last): "Ann asks, through Ben". Empty: asked by `fromName`
   * directly (or by a front door, see `relayed`).
   */
  through: string[]
  /** Wave 6: the front door that forwarded it (a travelling ask; `fromName` is then the person who asked the door). Null: none or an older door. */
  doorName: string | null
  /** Wave 6h: the answer moment on this phone's clock. */
  deadline: number
  /** Wave 6h: a yes after the moment reaches the asker as "answered later" (the ask carried its window, ask_window.ts). */
  lateMode: boolean
  /** Wave 6h: it reached this phone after its asker had stopped waiting; a yes goes as a late answer. */
  arrivedLate: boolean
  /**
   * Wave 6i: the connection of the person who ASKED, when the ask came straight from them (not passed on by a friend, not through a front
   * door): "Message <name>" from the prompt goes there, carrying this ask (chat_re.ts). Null: no message from the prompt.
   */
  askerPeerId: string | null
  /** Wave 6i (reask.ts): an earlier ask its asker sent again after this phone tightened their ring; `at` null: shown without a date. */
  earlier: { at: number | null } | null
  decide(share: boolean): Promise<void>
}

export interface AskResult {
  peerId: string
  peerName: string
  /** Wave 6i: the qid this connection got (so "Message <name>" from the answer carries the question, chat_re.ts). */
  qid: string
  decoded: DecodedAnswer | null
}

export interface NetHooks {
  state(): AppState
  save(): void
  onStatus(status: RelayStatus): void
  /** A matching ask arrived: show the consent prompt, wherever the person is. */
  onAsk(ask: IncomingAsk): void
  /** A person scanned this device's code: they are now a connected peer. */
  onPeerConnected(peer: Peer): void
  /**
   * A phone that opened a demo-account code asks to connect (owner 2026-10-06:
   * "I need to authorize in my view the connection"). Return true to HOLD it:
   * nothing is stored here, the app keeps the would-be peer until the owner
   * allows it (admitPeer) or drops it. False: the ordinary one-scan flow.
   */
  holdPeer(peer: Peer): boolean
  /** A new peer came in through a reach-out (public link): true drops it unanswered (over the hourly cap, or paused; reach_out_guard.ts). */
  refuseReachOut?(): boolean
  /** The other side of the hold: a peer we already hold sent its ack again, i.e. the owner allowed us. */
  onPeerConfirmed(peer: Peer): void
  /** Ring for a peer who just scanned this device's code. */
  ringForNewPeer(): Ring
  onLogChanged(): void
  /** What this asker may be matched against; undefined = everything their ring admits. */
  askScope(peer: Peer): MatchScope | undefined
  /** Ids of the colour tags the person behind this peer holds (colour_tags.ts): an item shared with "selected tags" answers them. */
  askerTags?(peer: Peer): string[]
  /** A connected peer sent a text inside TrustWeb (today: a link to a meeting they shared). `re` (wave 6i): the ask a chat message answers. */
  onText(peer: Peer, text: string, ts: number, re?: ChatRe): void
  /** Wave 6: may this peer's asks go on through this phone to its other contacts (one_jakob.ts passOnAllowed)? */
  mayPassOnFrom(peer: Peer): boolean
  /**
   * Wave 6: is `target` the same person as this phone (its own front door) or
   * as `sender` (their phone and their front door)? Never asked again: they
   * answer once already (one_jakob.ts samePersonTarget).
   */
  samePerson(target: Peer, sender: Peer): boolean
  /**
   * Wave 6f (ack_retry.ts): may this phone re-send its connect-ack to `peer` until it hears from them? Absent: never (tests, and the
   * side-by-side demo / demo accounts, whose flows are their own).
   */
  mayResendAck?(peer: Peer): boolean
  /** Wave 6f (away_asks.ts): an ask that matched this web arrived after its asker had stopped waiting; nothing was answered. */
  onAwayAsk?(ask: AwayAsk, peer: Peer): void
  /**
   * Wave 6h (unmatched_asks.ts): may this phone keep a "<name> asked about X; nothing matched" card for this asker (Settings > Advanced
   * "Show me asks that matched nothing"; never a demo account)? Absent: never.
   */
  keepsUnmatched?(peer: Peer): boolean
  /** Wave 6h: such a card was just kept (state.unmatchedAsks). */
  onUnmatchedAsk?(): void
  /** Review 6h (late_answers.ts openWindowUntil): late answers the drain brought right after an open were released; show them. */
  onLateAnswersReleased?(): void
  /**
   * Wave 6i (reask.ts): `peer` tightened this phone's ring and asks for its earlier asks again: may this phone re-send them? Absent:
   * never (tests, the side-by-side demo, demo accounts and their owners: their flows are their own).
   */
  mayReask?(peer: Peer): boolean
}

/** Tests only (test/unit/hops_net.test.mjs): never a URL or UI setting. Production passes nothing. */
export interface NetOptions {
  /** A shorter answer window; production always uses ANSWER_WINDOW_MS. */
  answerWindowMs?: number
  /** The relay's origin outside a browser; production uses the page's own origin. */
  relayOrigin?: string
}

function upsertPeer(s: AppState, p: Peer): Peer {
  const i = s.peers.findIndex((x) => x.did === p.did || x.id === p.id)
  if (i >= 0) {
    s.peers[i] = { ...s.peers[i], ...p, ring: s.peers[i].ring }
    return s.peers[i]
  }
  s.peers.push(p)
  return p
}

/** apps/demo's prune(): keep the relevance band, at most three lines. */
function prune(m: MatchResult): MatchResult {
  if (!m.hits.length) return m
  const top = m.hits[0].score
  return { ...m, hits: m.hits.filter((h) => h.score >= top * RELEVANCE_BAND).slice(0, MAX_SHARED) }
}

/** The page's Web Locks manager, when it has one (secure pages in current browsers). */
function pageLocks(): LockManagerLike | undefined {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }) : undefined
  return nav?.locks
}

/** Is this tab the one in front of the person (visible or focused)? Outside a page: yes. */
function inFront(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState === 'visible' || (typeof document.hasFocus === 'function' && document.hasFocus())
}

export class Net {
  private channel: RelayChannel | null = null
  private identity: DidIdentity | null = null
  private lock: DrainLock | null = null
  /** Connect-acks being sent right now (by DID): never two at once for one peer. */
  private acking = new Set<string>()
  /** This visit's connect-ack attempts per DID, whatever their outcome (ack_retry.ts attemptAllowed). */
  private ackAttempts = new Map<string, AckAttempts>()
  private keys = new Map<string, Promise<CryptoKey>>()
  private awaiting = new Map<string, (env: AnswerEnvelope) => void>()
  private seenQids = new Set<string>()
  private roots = new RootMemory()
  private starting: Promise<void> | null = null
  /** Review 6h: when the app was last opened (markOpened), until the drain's next connect; null: no open waiting for one. */
  private openedAt: number | null = null
  /** Review 6h: late answers that land before this moment belong to the open that just happened (late_answers.ts openWindowUntil). */
  private releaseUntil = 0
  /** Review 6h: the restoreHeldAsks run in progress, if any. */
  private restoring: Promise<void> | null = null
  /** Wave 6i (reask.ts): per connection (peer id), when its last ask-again started a round of re-asks here, and the rounds running. */
  private askAgainAt = new Map<string, number>()
  private reasking = new Set<string>()
  private readonly windowMs: number
  private readonly relayOrigin: string | undefined

  /** This phone's answer window (ask_window.ts): what its asks carry and what the dock counts down. */
  get answerWindowMs(): number {
    return this.windowMs
  }

  constructor(private readonly hooks: NetHooks, opts: NetOptions = {}) {
    this.windowMs = opts.answerWindowMs ?? ANSWER_WINDOW_MS
    this.relayOrigin = opts.relayOrigin
  }

  /** This device's relay identity, minted once and kept in the app's own record. */
  private ensureIdentity(): DidIdentity {
    if (this.identity) return this.identity
    const s = this.hooks.state()
    if (s.identity) {
      this.identity = deserializeIdentity(s.identity)
    } else {
      this.identity = createIdentity((this.relayOrigin ?? location.origin) + '/relay')
      s.identity = serializeIdentity(this.identity)
      this.hooks.save()
    }
    return this.identity
  }

  private pairKey(peer: Peer): Promise<CryptoKey> {
    let k = this.keys.get(peer.did)
    if (!k) {
      k = deriveEcdhPairKey(ecdhSharedSecret(this.ensureIdentity(), peer.did))
      this.keys.set(peer.did, k)
    }
    return k
  }

  private peerByDid(did: string): Peer | undefined {
    return this.hooks.state().peers.find((p) => p.did === did)
  }

  /**
   * Opens the relay drain once; safe to call repeatedly. The drain itself is held by ONE tab of this browser profile (drain_lock.ts):
   * a tab in front of the person takes it, a tab behind another waits for it. Resolves once this tab drains, or at once when another
   * tab does (its sends then fail like an offline phone's and are retried).
   */
  start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = (async () => {
      const identity = this.ensureIdentity()
      let granted: () => void = () => {}
      const firstGrant = new Promise<void>((resolve) => { granted = resolve })
      this.lock = createDrainLock(drainLockName(identity.did), pageLocks(), {
        // Review 6h: the held prompts show in the tab that drains (the one that can answer them), once it does.
        onGranted: () => { this.openDrain(identity).then(granted, granted).then(() => this.restoreHeldAsks()) },
        onLost: () => this.closeDrain(),
      })
      this.lock.request(inFront())
      await Promise.race([firstGrant, new Promise<void>((resolve) => setTimeout(resolve, LOCK_WAIT_MS))])
    })()
    return this.starting
  }

  /** A fresh channel for this identity (never a closed one again: its late close event would start a second socket). */
  private async openDrain(identity: DidIdentity): Promise<void> {
    this.closeDrain()
    const channel = createRelayChannel(this.relayOrigin ? { relayOrigin: this.relayOrigin } : {})
    this.channel = channel
    channel.onStatus((status) => {
      if (this.channel !== channel) return // a channel this tab already closed
      this.hooks.onStatus(status)
      if (status === 'connected') { this.noteConnected(Date.now()); void this.resendAcks(); void this.flushLateYes(); void this.flushAskAgain() }
    })
    channel.onRawWire((fromDid, payload) => this.handleRaw(fromDid, payload))
    channel.onEnvelope(async (fromDid) => {
      const peer = this.peerByDid(fromDid)
      return peer ? this.pairKey(peer) : null
    }, (env, fromDid) => { void this.handleEnvelope(env, fromDid) })
    try {
      await channel.connect(identity)
    } catch {
      /* relay.ts keeps reconnecting on its own; the status badge shows it */
    }
  }

  private closeDrain(): void {
    const channel = this.channel
    this.channel = null
    channel?.close()
  }

  /**
   * The person is in front of this tab (it became visible or got the focus): it takes the drain from any other tab of this profile.
   * `fresh`: after a long time hidden (a laptop that slept), the socket it holds may be dead without knowing it: open a new one.
   */
  activate(fresh = false): void {
    if (!this.lock || !this.identity) return
    if (!this.lock.held()) { this.lock.request(true); return }
    if (fresh) void this.openDrain(this.identity)
  }

  /** Closes the relay drain for good: after a hand-over the identity lives on another phone. */
  stop(): void {
    this.lock?.release()
    this.lock = null
    this.closeDrain()
    this.starting = null
  }

  /** The URL a phone camera opens to connect to this device (one scan). */
  connectLink(appUrl: string): string {
    return buildConnectLinkUrl(appUrl, this.ensureIdentity().did, this.hooks.state().me)
  }

  /** The scanning side of the one-scan ceremony: add the peer, tell them who we are. */
  async completeConnect(params: ConnectLinkParams, ring: Ring, reachOut = false): Promise<Peer> {
    const s = this.hooks.state()
    this.ensureIdentity()
    // A connection this phone already holds under that DID keeps its id and name (a bare-DID add made it up, a scan may bring the real ones).
    const known = s.peers.find((x) => x.did === params.did)
    const peer = upsertPeer(s, {
      id: known?.id ?? params.from.id,
      displayName: cleanHelloName(params.from.displayName) || known?.displayName || NAMELESS_PEER,
      did: params.did,
      ring,
      connectedAt: Date.now(),
      ...(reachOut ? { reachOut: true as const } : {}),
    })
    this.hooks.save()
    await this.start()
    await this.sendAck(peer)
    return peer
  }

  /**
   * One connect-ack to `peer` (the cleartext bootstrap wire of connect_link.ts, byte-for-byte the same every time). Counted only when
   * the relay accepted it; a failure is retried by resendAcks (ack_retry.ts). Never two at once for one peer.
   */
  private async sendAck(peer: Peer): Promise<void> {
    if (this.acking.has(peer.did)) return
    this.acking.add(peer.did)
    try {
      if (!this.channel) return
      this.ackAttempts.set(peer.did, nextAttempts(this.ackAttempts.get(peer.did), Date.now()))
      await this.channel.sendRaw(peer.did, encodeForQr(buildConnectAck(this.hooks.state().me, this.ensureIdentity(), peer.reachOut === true)))
      const stored = this.peerByDid(peer.did)
      if (stored) { noteAckSent(stored, Date.now()); this.hooks.save() }
    } catch {
      /* the peer is saved; resendAcks tries again on the next connect of the drain (ack_retry.ts) */
    } finally {
      this.acking.delete(peer.did)
    }
  }

  /**
   * Wave 6f: re-sends the connect-ack to every connection that has not answered yet and is due (ack_retry.ts). Each one is checked again
   * right before its send (review 6f): two reconnects close together must not both send to the same peer from a list made earlier.
   */
  async resendAcks(): Promise<void> {
    if (!this.hooks.mayResendAck || !this.channel) return
    const dids = this.hooks.state().peers.map((p) => p.did)
    for (const did of dids) {
      const peer = this.peerByDid(did)
      if (peer && this.mayResendNow(peer, Date.now())) await this.sendAck(peer)
    }
  }

  /** Due by the record, allowed by this visit's attempts, and allowed by the app (never the demo flows). */
  private mayResendNow(peer: Peer, now: number): boolean {
    const may = this.hooks.mayResendAck
    return ackDue(peer, now) && attemptAllowed(this.ackAttempts.get(peer.did), now) && may !== undefined && may.call(this.hooks, peer)
  }

  /** Wave 6f: this phone heard from `peer` (they know us): no more connect-acks to them. */
  private heard(peer: Peer): void {
    if (noteHeard(peer, Date.now())) this.hooks.save()
  }

  /** Only a cleartext connect-ack is ever recognised here; every other wire is ciphertext. */
  private handleRaw(fromDid: string, payload: string): boolean {
    const env = decodeFromQr(payload)
    if (!env || env.t !== 'connect-ack' || env.did !== fromDid) return false
    const s = this.hooks.state()
    const known = this.peerByDid(env.did)
    const incoming: Peer = {
      id: env.from.id,
      displayName: cleanHelloName(env.from.displayName) || NAMELESS_PEER,
      did: env.did,
      ring: known?.ring ?? this.hooks.ringForNewPeer(),
      connectedAt: Date.now(),
    }
    if (known) {
      const peer = upsertPeer(s, incoming)
      noteHeard(peer, Date.now())
      this.hooks.save()
      this.hooks.onPeerConfirmed(peer)
      return true
    }
    if (this.hooks.holdPeer(incoming)) return true
    if (env.reachOut && this.hooks.refuseReachOut?.()) return true
    const peer = upsertPeer(s, { ...incoming, heardAt: Date.now(), ...(env.reachOut ? { ring: Ring.Intending, reachOut: true as const } : {}) })
    this.hooks.save()
    this.hooks.onPeerConnected(peer)
    return true
  }

  /** The owner allowed a held peer: store it and tell that phone (the same bootstrap wire, carrying no secret). */
  async admitPeer(held: Peer): Promise<Peer> {
    const s = this.hooks.state()
    const peer = upsertPeer(s, { ...held, connectedAt: Date.now() })
    this.hooks.save()
    await this.start()
    await this.sendAck(peer)
    return peer
  }

  private async handleEnvelope(env: Envelope, fromDid: string): Promise<void> {
    // It opened with the pair key: that phone knows this one.
    const from = this.peerByDid(fromDid)
    if (from) this.heard(from)
    if (env.t === 'answer') {
      const waiting = this.awaiting.get(env.qid)
      if (waiting) waiting(env)
      else if (from) await this.lateAnswer(env, from)
      return
    }
    if (env.t === 'query') await this.handleQuery(env, fromDid)
    if (env.t === 'chat') {
      const peer = this.peerByDid(fromDid)
      if (peer) this.hooks.onText(peer, env.text, env.ts, env.re)
    }
    if (env.t === 'ask-again' && from) await this.onAskAgain(from)
    // ping is deliberately ignored: no chat in this build, only a shared meeting's link.
  }

  /**
   * A short text to one connected peer, sealed with the pair key (apps/demo's chat envelope, 500 characters at most). `ts` defaults to now;
   * a retry of a waiting chat message passes its ORIGINAL ts so the receiver can drop a duplicate (chat.ts).
   */
  async sendText(peer: Peer, text: string, ts: number = Date.now(), re?: ChatRe): Promise<void> {
    await this.start()
    // Wave 6i: `re`, the ask this message answers (chat_re.ts makeRe built it), travels inside the same sealed envelope.
    const env: ChatEnvelope = { v: 1, t: 'chat', from: this.hooks.state().me, text, ts, ...(re ? { re } : {}) }
    const key = await this.pairKey(peer)
    if (!this.channel) throw new Error('relay not connected')
    await this.channel.send(peer.did, env, key)
  }

  /** Logs an ask the moment it is decided (before its answer leaves, as apps/demo's answer_log.ts does). */
  private log(peer: Peer, text: string, outcome: LogOutcome): LogEntry {
    const s = this.hooks.state()
    const entry: LogEntry = { id: randomId(8), at: Date.now(), from: peer.displayName, text, outcome, peerId: peer.id }
    s.log.unshift(entry)
    s.log = s.log.slice(0, 50)
    this.hooks.save()
    this.hooks.onLogChanged()
    return entry
  }

  /** Adds to a log entry what passing the ask on did (wave 6), once that is known. */
  private logHarvest(entry: LogEntry, got: HopHarvest): void {
    if (!got.asked) return
    entry.passedOn = got.asked
    if (got.items.length) entry.cameBack = got.items.length
    this.hooks.save()
    this.hooks.onLogChanged()
  }

  private async handleQuery(q: QueryEnvelope, fromDid: string): Promise<void> {
    if (this.seenQids.has(q.qid)) return
    const receivedAt = Date.now()
    const s = this.hooks.state()
    // Wave 6h: a prompt this phone already holds for it (the relay delivered it again after a reload) is not asked twice. Review 6h:
    // checked BEFORE the qid is marked seen, so a redelivery that comes in ahead of restoreHeldAsks does not hide the held prompt.
    if (liveHeldAsks(s.heldAsks, receivedAt).some((h) => h.qid === q.qid)) return
    this.seenQids.add(q.qid)
    const peer = this.peerByDid(fromDid)
    if (!peer || !this.channel) return
    const info = hopInfo(q)
    const text = q.freeText ?? ''
    // Wave 6h (ask_window.ts): the window the asker sent (120 s), or 30 s for an ask without one (an older asker, a front door).
    const windowMs = receivedWindowMs(q, this.windowMs)
    const lateMode = carriesWindow(q)
    // The same ask again by another path, a cycle back to this phone, or one that went further than
    // its asker allowed (direct_ask.ts / hops.ts): answered like no match, at the same moment, never shown.
    const repeat = this.roots.repeat(info.root, receivedAt)
    const cycle = info.travels && info.root !== null && info.seen.includes(await seenHash(info.root, s.me.id))
    // Wave 6i (reask.ts): an earlier ask its asker sent again after this phone tightened their ring. One already shown at this ring (or
    // a tighter one) is answered like no match, never shown again: a double tap or a lower-then-raise repeats no prompt. Review 6i: it
    // is remembered as shown only when its prompt is presented (earlierFields), so one that matched nothing may come again.
    const earlier = this.earlierOf(q, info, peer, receivedAt)
    const quietEarlier = earlier !== null && !showsEarlierAsk(s.reaskSeen, earlier.originalQid, peer.id, peer.ring, receivedAt)
    // Its asker stopped waiting long ago (this phone was closed or asleep). A repeat or a cycle stays as silent as it is live (review 6f).
    if (isAwayAsk(q.issuedAt, receivedAt, askTimeoutMs(info.maxHops, windowMs))) {
      if (repeat || cycle || quietEarlier) return
      // Wave 6h: the asker's build takes a late yes: the prompt still shows. Wave 6f for an older asker: no prompt (away_asks.ts).
      if (lateMode && receivedAt - q.issuedAt <= LATE_KEEP_MS) await this.handleLateArrival(q, peer, info, text, receivedAt, earlier)
      else this.handleAwayAsk(q, peer, info, text)
      return
    }
    const tpl = templateFor(text)
    // ONE answer moment, fixed by the envelope before anything is decided (hops.ts answerDelayMs).
    const deadline = receivedAt + answerDelayMs(info, windowMs)
    const silent = repeat || cycle || quietEarlier || !surfacesHere(q)
    const { threads, refs } = askSources(s, peer.ring, info.hop, this.hooks.askScope(peer), this.hooks.askerTags?.(peer))
    const match = text && !silent ? matchAsk(text, threads) : { hits: [], distinctAuthors: 0, aboveThreshold: false }
    const { surface } = classifyIncomingQuery(match, false, Boolean(text))
    const key = await this.pairKey(peer)
    // Passed on the moment it arrives, never waiting for the person here: the next step's answers are
    // in before this phone's own moment, whatever the person does.
    const harvest = !silent && mayCascade(q) && this.hooks.mayPassOnFrom(peer)
      ? this.passOn(q, info, peer, deadline, windowMs)
      : Promise.resolve(NO_HARVEST)
    const reply = this.replier(q.qid, tpl.id, peer, key, receivedAt, deadline, harvest)

    // A repeat or a cycle is not a new ask: answered (nothing, at the same moment) but not logged a second time. Wave 6i: nor is an
    // earlier ask that came again and still matches nothing (no log row, no card: one tightening must not bring twenty of them).
    if (repeat || cycle || (earlier !== null && !surface)) {
      await reply.atMoment([])
      return
    }
    if (!surface) {
      const entry = this.log(peer, text, LogOutcome.NoMatch)
      if (!silent) this.noteUnmatched(q, peer, info, text, receivedAt)
      this.logHarvest(entry, (await reply.atMoment([])).got)
      return
    }

    const matches = match.hits
      .map((h) => refs.get(h.threadId))
      .filter((r): r is LineRef => Boolean(r))
    this.present({
      qid: q.qid, peerId: peer.id, text, fromName: askerOf(info, peer.displayName),
      through: info.door ? [] : throughOf(info, peer.displayName),
      doorName: info.door ? peer.displayName : null,
      relayed: q.relayed === true && (info.door || !info.travels),
      matches, receivedAt, deadline, lateMode, ...this.earlierFields(earlier, peer, receivedAt),
    }, peer, reply)
  }

  /**
   * Wave 6i (reask.ts): the earlier ask an incoming ask repeats, read only on an ask straight from its asker that carries its window (a
   * re-ask is always direct and always carries it); anything else is an ordinary ask.
   */
  private earlierOf(q: QueryEnvelope, info: HopInfo, peer: Peer, receivedAt: number): EarlierAsk | null {
    if (!q.reask || !carriesWindow(q) || !this.straightFromAsker(q, info, peer)) return null
    // Review 6i: only from a connection this phone asked again (reask.ts acceptsReaskFrom); a marker nobody asked for is ignored, so it
    // can neither keep an ask out of the log nor take a card away.
    if (!acceptsReaskFrom(peer.askAgainSentAt, receivedAt)) return null
    return earlierAsk(q.reask, receivedAt)
  }

  /**
   * Wave 6i: the held prompt's fields for an earlier ask that is shown. Called only when its prompt is presented: it is remembered as
   * shown at the asker's ring now (reask.ts noteEarlierAsk); its old "nothing matched" card goes, and so does (review 6i) a prompt for
   * the first ask this phone still held (one ask, one prompt; a late yes to that one would still land, late_answers.ts findSent).
   */
  private earlierFields(earlier: EarlierAsk | null, peer: Peer, now: number): Pick<HeldAsk, 'earlierAt' | 'reaskOf'> {
    if (!earlier) return {}
    const s = this.hooks.state()
    s.reaskSeen = noteEarlierAsk(s.reaskSeen, earlier.originalQid, peer.id, peer.ring, now)
    if (Array.isArray(s.unmatchedAsks) && s.unmatchedAsks.some((a) => isUnmatchedFor(a, earlier.originalQid, peer.id))) {
      s.unmatchedAsks = dismissUnmatchedAsk(s.unmatchedAsks, earlier.originalQid, now)
    }
    if (liveHeldAsks(s.heldAsks, now).some((h) => h.qid === earlier.originalQid && h.peerId === peer.id)) {
      s.heldAsks = dropHeldAsk(s.heldAsks, earlier.originalQid, now)
    }
    this.hooks.save()
    return { reaskOf: earlier.originalQid, ...(earlier.at !== null ? { earlierAt: earlier.at } : {}) }
  }

  /**
   * Shows one prompt (and keeps it in the record until it is decided, held_asks.ts). In late mode an undecided prompt answers "nothing"
   * at its moment, together with whatever came back from the next step, and a yes after that leaves as a late answer; a no after it
   * sends nothing more. Without late mode (an older asker or a front door) the answer leaves at the moment or when decided, as before.
   */
  private present(held: HeldAsk, peer: Peer, reply: Replier): void {
    this.hold(held)
    let decided = false
    let atMoment: Promise<MomentResult> | null = null
    const sendMoment = (own: SharedItem[]): Promise<MomentResult> => {
      atMoment ??= reply.atMoment(own)
      return atMoment
    }
    // Review 6h: the moment leaves whatever happens before it (sendMoment is once only): a decision after the moment that came before
    // a timer a background tab delayed must not skip the moment's "nothing" (a decline would then read as a phone that was off).
    const momentDue = held.lateMode && !held.arrivedLate && Date.now() < held.deadline
    if (momentDue) void settleAt(Date.now(), held.deadline - Date.now()).then(() => { void sendMoment([]) })
    this.hooks.onAsk({
      qid: held.qid, fromName: held.fromName, text: held.text, matches: held.matches, receivedAt: held.receivedAt,
      relayed: held.relayed, through: held.through, doorName: held.doorName,
      deadline: held.deadline, lateMode: held.lateMode, arrivedLate: held.arrivedLate === true,
      askerPeerId: !held.relayed && held.doorName === null && held.through.length === 0 ? held.peerId : null,
      earlier: held.reaskOf !== undefined ? { at: held.earlierAt ?? null } : null,
      decide: async (share: boolean) => {
        if (decided) return
        decided = true
        const entry = this.log(peer, held.text, share ? LogOutcome.Shared : LogOutcome.Declined)
        if (held.arrivedLate) entry.away = true
        const own = share ? sharedItems(held.matches) : []
        const late = held.lateMode && (held.arrivedLate === true || atMoment !== null || Date.now() >= held.deadline)
        if (!late) {
          // Review 6h: a yes before the moment stays in the record until it has left (a tab closed right after the yes, a reload, the
          // drain in another tab): restoreHeldAsks sends it at its moment, or flushLateYes afterwards. A no has nothing to keep.
          if (share) this.hold({ ...held, yesAt: Date.now() })
          else this.unhold(held.qid)
          const moment = await sendMoment(own)
          if (share && moment.sent) this.unhold(held.qid)
          this.logHarvest(entry, moment.got)
          return
        }
        // Review 6h: the moment's "nothing" leaves FIRST (its timer may not have run yet), so the asker never takes the late yes for an
        // answer at the moment. An ask that arrived late has no moment.
        if (!held.arrivedLate) this.logHarvest(entry, (await sendMoment([])).got)
        if (!share) { this.unhold(held.qid); return }
        // Kept as decided until the relay took it (a tab without the drain, a phone offline): flushLateYes sends it on the next connect.
        this.hold({ ...held, yesAt: Date.now() })
        await this.sendLateYes(held, reply, false)
      },
    })
  }

  /** The answer of one ask: at its moment (with what the next step sent back), or later as a late answer. */
  private replier(qid: string, templateId: string, peer: Peer, key: CryptoKey, receivedAt: number, deadline: number, harvest: Promise<HopHarvest>): Replier {
    const myName = this.hooks.state().me.displayName
    return {
      atMoment: async (own: SharedItem[]): Promise<MomentResult> => {
        // Belt and braces: whatever the next step does, this phone answers at its moment.
        const got = await Promise.race([harvest, settleAt(receivedAt, deadline - receivedAt).then(() => NO_HARVEST)])
        await settleAt(receivedAt, deadline - receivedAt)
        const items = dedupeItems([...own, ...markThrough(got.items, myName)]).slice(0, MAX_SHARED)
        return { got, sent: await this.sendAnswer(qid, templateId, peer, key, items, true) }
      },
      late: async (own: SharedItem[]): Promise<boolean> => this.sendAnswer(qid, templateId, peer, key, dedupeItems(own).slice(0, MAX_SHARED), true),
    }
  }

  /** Seals and sends one answer (a fresh IV every time, gate.ts sealAnswerEnvelope). Resolves false when the relay did not take it. */
  private async sendAnswer(qid: string, templateId: string, peer: Peer, key: CryptoKey, items: SharedItem[], strict = false): Promise<boolean> {
    const payload: SharedPayload | null = items.length ? { from: this.hooks.state().me.displayName, templateId, items } : null
    const env = await sealRelayAnswer(qid, templateId, payload, { key, blocked: false })
    try {
      if (!this.channel) throw new Error('relay not connected')
      await this.channel.send(peer.did, env, key)
      return true
    } catch {
      /* the asker times out and sees "no match"; a yes that did not leave is kept and tried again (flushLateYes) */
      return !strict
    }
  }

  /**
   * A late yes: sent now; on success the held prompt goes, on failure it stays decided for the next connect. `momentFirst` (review 6h):
   * this phone may have sent nothing at the moment (closed, offline, the drain in another tab), so the moment's "nothing" goes first and
   * an asker still waiting never takes the yes as an answer at the moment (it lands as "answered later", shown on the asker's next open).
   */
  private async sendLateYes(held: HeldAsk, reply: Replier, momentFirst: boolean): Promise<void> {
    if (momentFirst && !(await reply.atMoment([])).sent) return
    if (await reply.late(sharedItems(held.matches))) this.unhold(held.qid)
  }

  /**
   * Wave 6h: late yeses the relay did not take yet (decided, kept with yesAt) leave now. Called whenever the drain connects. Review 6h:
   * only those past their moment; a yes before it leaves AT the moment (present, or restoreHeldAsks after a reload), never earlier.
   */
  async flushLateYes(): Promise<void> {
    if (!this.channel) return
    const now = Date.now()
    for (const held of liveHeldAsks(this.hooks.state().heldAsks, now).filter((h) => h.yesAt !== undefined && now >= h.deadline)) {
      const peer = this.hooks.state().peers.find((p) => p.id === held.peerId)
      if (!peer) { this.unhold(held.qid); continue }
      const key = await this.pairKey(peer)
      const reply = this.replier(held.qid, templateFor(held.text).id, peer, key, held.receivedAt, held.deadline, Promise.resolve(NO_HARVEST))
      await this.sendLateYes(held, reply, held.lateMode && held.arrivedLate !== true)
    }
  }

  /**
   * Wave 6h (Q5): the prompts kept in the record show again after a reload, a new build or a long sleep, still answerable: before their
   * moment as usual (nothing came back from the next step: that harvest is gone with the reload), after it as a late answer (late mode)
   * or at once (an older asker). Call once the drain is started. Prompts of connections that are gone are dropped.
   */
  restoreHeldAsks(): Promise<void> {
    // Review 6h: start() calls this on the drain's grant and main.ts once started: a second call while one runs waits for that one.
    this.restoring ??= this.restoreNow().finally(() => { this.restoring = null })
    return this.restoring
  }

  private async restoreNow(): Promise<void> {
    // Review 6h: only the tab that drains shows them (the others would show the same prompts again).
    if (this.lock && !this.lock.held()) return
    const now = Date.now()
    for (const held of liveHeldAsks(this.hooks.state().heldAsks, now)) {
      // seenQids: shown (or answered) in this visit already. A relay redelivery of a held ask never marks it (handleQuery).
      if (this.seenQids.has(held.qid)) continue
      const peer = this.hooks.state().peers.find((p) => p.id === held.peerId)
      if (!peer) { this.unhold(held.qid); continue }
      this.seenQids.add(held.qid)
      const key = await this.pairKey(peer)
      const reply = this.replier(held.qid, templateFor(held.text).id, peer, key, held.receivedAt, held.deadline, Promise.resolve(NO_HARVEST))
      // Review 6h: a yes given before the moment that had not left yet leaves at the moment; past it, flushLateYes sends it below.
      if (held.yesAt !== undefined) {
        if (now < held.deadline) void reply.atMoment(sharedItems(held.matches)).then((m) => { if (m.sent) this.unhold(held.qid) })
        continue
      }
      this.present(held, peer, reply)
    }
    await this.flushLateYes()
  }

  private hold(held: HeldAsk): void {
    const s = this.hooks.state()
    const now = Date.now()
    s.heldAsks = addHeldAsk(dropHeldAsk(s.heldAsks, held.qid, now), held, now)
    this.hooks.save()
  }

  private unhold(qid: string): void {
    const s = this.hooks.state()
    s.heldAsks = dropHeldAsk(s.heldAsks, qid, Date.now())
    this.hooks.save()
  }

  /** Straight from its asker: not through a front door, not passed on by a friend (so "Message <name>" reaches the person who asked). */
  private straightFromAsker(q: QueryEnvelope, info: HopInfo, peer: Peer): boolean {
    return !info.door && q.relayed !== true && askerOf(info, peer.displayName) === peer.displayName && throughOf(info, peer.displayName).length === 0
  }

  /**
   * Wave 6h: the ask of a direct contact matched nothing here. The asker hears the same "nothing" as ever; the ASKED person gets a quiet
   * card with the reason (unmatched_asks.ts), worked out on this phone from two wider matches that never answer anybody.
   */
  private noteUnmatched(q: QueryEnvelope, peer: Peer, info: HopInfo, text: string, now: number): void {
    if (!text.trim() || !this.straightFromAsker(q, info, peer) || this.hooks.keepsUnmatched?.(peer) !== true) return
    const s = this.hooks.state()
    const scope = this.hooks.askScope(peer)
    const anyRing = surfacesFor(text, askSources(s, Ring.Close, 0, scope).threads)
    const onlyMe = !anyRing && surfacesFor(text, askSources(withOnlyMeOpened(s), Ring.Close, 0, scope).threads)
    s.unmatchedAsks = addUnmatchedAsk(s.unmatchedAsks, {
      id: q.qid, at: now, peerId: peer.id, from: peer.displayName, text, reason: unmatchedReason(anyRing, onlyMe), ring: peer.ring,
    }, now)
    this.hooks.save()
    this.hooks.onUnmatchedAsk?.()
  }

  /**
   * Wave 6h: an ask that carried its window reached this phone after its asker stopped waiting (a laptop asleep, a phone off). Its
   * asker's app takes a late yes, so it is shown like a live one, marked as late; nothing leaves at a moment and it is never passed on.
   * Only straight from its asker (a late yes to a friend in between would reach nobody); otherwise it is logged like the 6f away ask.
   */
  private async handleLateArrival(q: QueryEnvelope, peer: Peer, info: HopInfo, text: string, receivedAt: number, earlier: EarlierAsk | null = null): Promise<void> {
    if (!text || !surfacesHere(q)) return
    if (!this.straightFromAsker(q, info, peer)) { this.handleAwayAsk(q, peer, info, text); return }
    const { threads, refs } = askSources(this.hooks.state(), peer.ring, info.hop, this.hooks.askScope(peer), this.hooks.askerTags?.(peer))
    const match = matchAsk(text, threads)
    if (!classifyIncomingQuery(match, false, true).surface) {
      // Wave 6i: an earlier ask that came again and still matches nothing stays silent (no log row, no card).
      if (earlier) return
      const entry = this.log(peer, text, LogOutcome.NoMatch)
      entry.away = true
      this.hooks.save()
      this.noteUnmatched(q, peer, info, text, receivedAt)
      return
    }
    const matches = match.hits.map((h) => refs.get(h.threadId)).filter((r): r is LineRef => Boolean(r))
    const key = await this.pairKey(peer)
    const tplId = templateFor(text).id
    this.present({
      qid: q.qid, peerId: peer.id, text, fromName: peer.displayName, through: [], doorName: null, relayed: false,
      matches, receivedAt, deadline: receivedAt, lateMode: true, arrivedLate: true, ...this.earlierFields(earlier, peer, receivedAt),
    }, peer, this.replier(q.qid, tplId, peer, key, receivedAt, receivedAt, Promise.resolve(NO_HARVEST)))
  }

  /**
   * An ask that arrived after its asker stopped waiting: logged (as no match, marked away), and kept for the person when it matched this
   * web AND came straight from its asker (so "Message <name>" reaches the person who asked, not a front door or a friend in between).
   * Nothing is sent, nothing is passed on. Wave 6h: one from a direct contact that matched nothing leaves the quiet card instead.
   */
  private handleAwayAsk(q: QueryEnvelope, peer: Peer, info: HopInfo, text: string): void {
    if (!text || !surfacesHere(q)) return
    const entry = this.log(peer, text, LogOutcome.NoMatch)
    entry.away = true
    this.hooks.save()
    if (!this.straightFromAsker(q, info, peer)) return
    const { threads } = askSources(this.hooks.state(), peer.ring, info.hop, this.hooks.askScope(peer), this.hooks.askerTags?.(peer))
    if (!surfacesFor(text, threads)) { this.noteUnmatched(q, peer, info, text, Date.now()); return }
    this.hooks.onAwayAsk?.({ id: q.qid, at: Date.now(), peerId: peer.id, from: peer.displayName, text: [...text].slice(0, AWAY_TEXT_MAX).join('') }, peer)
  }

  /**
   * Wave 6h, the asker's side: an answer this visit no longer waits for. When it answers an ask this phone sent to exactly that
   * connection (late_answers.ts) and opens to a share, it is kept as a late answer, silently: it shows on the next app open, never live.
   */
  private async lateAnswer(env: AnswerEnvelope, peer: Peer): Promise<void> {
    const s = this.hooks.state()
    const now = Date.now()
    const sent = sentAskFor(s.sentAsks, env.qid, peer.id, now)
    if (!sent) return
    const decoded = await interpret(env, await this.pairKey(peer))
    const items = decoded.outcome === 'shared' && decoded.shared ? sanitizeHopItems(decoded.shared.items) : []
    if (!items.length) return
    s.lateAnswers = addLateAnswer(s.lateAnswers, sent, peer.displayName, items, now)
    s.sentAsks = forgetSentAsk(s.sentAsks, env.qid, now)
    // Review 6h: one the relay handed over right after an open (it waited there while the app was closed) belongs to that open.
    const release = now <= this.releaseUntil
    if (release) s.lateAnswers = releaseLateAnswers(s.lateAnswers, now)
    this.hooks.save()
    if (release) this.hooks.onLateAnswersReleased?.()
  }

  /**
   * Review 6h: the app was just opened (started, or back in front after a long time away): late answers the relay hands over within
   * OPEN_DRAIN_GRACE_MS of the drain's next connect are part of this open (late_answers.ts openWindowUntil). The caller releases the
   * ones already kept itself.
   */
  markOpened(now: number = Date.now()): void {
    this.openedAt = now
  }

  private noteConnected(now: number): void {
    if (this.openedAt === null) return
    this.releaseUntil = Math.max(this.releaseUntil, openWindowUntil(this.openedAt, now))
    this.openedAt = null
  }

  /**
   * The next step: asks this phone's own contacts (not the sender, nobody in
   * `seen`, nobody only intended, closest rings first, at most MAX_FANOUT)
   * and gathers what they shared until shortly before this phone's moment.
   */
  private async passOn(q: QueryEnvelope, info: HopInfo, sender: Peer, deadline: number, windowMs: number): Promise<HopHarvest> {
    const s = this.hooks.state()
    const root = info.root
    if (!root) return NO_HARVEST
    const self = await seenHash(root, s.me.id)
    const fromSender = await seenHash(root, sender.id)
    const excluded = new Set([...info.seen, self, fromSender])
    const targets: Peer[] = []
    for (const p of [...s.peers].sort((a, b) => RINGS.indexOf(a.ring) - RINGS.indexOf(b.ring))) {
      if (targets.length >= MAX_FANOUT) break
      if (p.did === sender.did || p.ring === Ring.Intending || this.hooks.samePerson(p, sender)) continue
      if (excluded.has(await seenHash(root, p.id))) continue
      targets.push(p)
    }
    if (!targets.length) return NO_HARVEST
    // The sender's name as this phone knows it (from the connect, as on its own prompt), never the per-ask claim in `from`.
    // Wave 6h: the asker's window goes on with it, so the next step answers on the asker's schedule.
    const fields = { ...cascadeFields(q, info, [self, fromSender], sender.displayName), ...passOnWindowFields(q, windowMs) }
    const waitMs = Math.max(0, deadline - Date.now() - windowMs * HOP_COLLECT_LEAD)
    // Each target is bounded by waitMs on its own (sendAsk never waits on a send), so one stalled contact costs nothing but its line.
    const answers = await Promise.all(targets.map((p) => this.sendAsk(p, q.freeText ?? '', fields, waitMs)))
    const items = answers.flatMap((d) => (d?.outcome === 'shared' && d.shared ? sanitizeHopItems(d.shared.items) : []))
    return { asked: targets.length, items }
  }

  /** One ask to one peer; resolves with the decoded answer, or null when none came within `timeoutMs`. */
  private async sendAsk(
    peer: Peer, freeText: string, extra: Partial<QueryEnvelope>, timeoutMs: number, qid: string = randomId(12), onRefused?: () => void,
  ): Promise<DecodedAnswer | null> {
    const s = this.hooks.state()
    const q: QueryEnvelope = {
      v: 1, t: 'query', from: s.me,
      templateId: templateFor(freeText).id, templateVersion: 1,
      qid, issuedAt: Date.now(), freeText, ...extra,
    }
    const key = await this.pairKey(peer)
    const answered = new Promise<AnswerEnvelope | null>((resolve) => {
      const timer = setTimeout(() => { this.awaiting.delete(q.qid); resolve(null) }, timeoutMs)
      this.awaiting.set(q.qid, (env) => { clearTimeout(timer); this.awaiting.delete(q.qid); resolve(env) })
    })
    // The send is never awaited ahead of the reply's own timer: a relay POST that hangs must not hold the answer past timeoutMs.
    const channel = this.channel
    void (async () => {
      try {
        if (!channel) throw new Error('relay not connected')
        await channel.send(peer.did, q, key)
      } catch {
        onRefused?.()
        this.awaiting.get(q.qid)?.({ v: 1, t: 'answer', qid: q.qid, body: '' })
      }
    })()
    const env = await answered
    return env ? interpret(env, key) : null
  }

  /**
   * Ask every connected peer; resolves once every answer is in or has timed
   * out. With "Ask only my direct contacts" on, each ask says so (`direct`);
   * otherwise it carries the reach chosen under "How far?" (none for one step).
   * Wave 6h: every ask carries this phone's window, and is remembered per connection so a later yes can still land (late_answers.ts).
   */
  async ask(text: string): Promise<AskResult[]> {
    await this.start()
    const s = this.hooks.state()
    const freeText = text.trim().slice(0, FREE_TEXT_MAX_LEN)
    const reach = askReachOf(s)
    const root = randomId(12)
    const extra: Partial<QueryEnvelope> = {
      ...directFlag(s.askDirectOnly === true), ...askFields(reach, root, await seenHash(root, s.me.id)), ...windowFields(this.windowMs),
    }
    const timeoutMs = askTimeoutMs(reach, this.windowMs)
    const now = Date.now()
    const outgoing = askPeers(s).map((peer) => ({ peer, qid: randomId(12) }))
    s.sentAsks = addSentAsk(s.sentAsks, { id: root, text: freeText, at: now, to: outgoing.map(({ peer, qid }) => ({ peerId: peer.id, qid })) }, now)
    this.hooks.save()
    const results = await Promise.all(outgoing.map(async ({ peer, qid }): Promise<AskResult> => ({
      peerId: peer.id,
      peerName: peer.displayName,
      qid,
      decoded: await this.sendAsk(peer, freeText, extra, timeoutMs, qid),
    })))
    // Review 6h: who shared at the moment has answered; a second answer of theirs for this ask is not a late one.
    const answered = outgoing.filter((_, i) => results[i].decoded?.outcome === 'shared')
    if (answered.length) {
      const st = this.hooks.state()
      for (const { qid } of answered) st.sentAsks = forgetSentAsk(st.sentAsks, qid, Date.now())
      this.hooks.save()
    }
    return results
  }

  // -------------------------------------------------------------------------
  // Wave 6i (reask.ts): tightening a ring brings back the earlier asks
  // -------------------------------------------------------------------------

  /**
   * A's side: this phone's person just TIGHTENED `peer`'s ring (or asked for their earlier asks again): one sealed ask-again, nothing
   * else (no ring, no text). Kept on the peer (askAgainDue) until the relay took it, so a phone offline or a tab without the drain sends
   * it on the next connect. Never called for a loosening: lowering a ring sends nothing.
   */
  async askAgain(peer: Peer): Promise<boolean> {
    const stored = this.hooks.state().peers.find((p) => p.id === peer.id)
    if (!stored) return false
    stored.askAgainDue = Date.now()
    this.hooks.save()
    return this.sendAskAgain(stored)
  }

  private async sendAskAgain(peer: Peer): Promise<boolean> {
    if (!this.channel) return false
    const env: AskAgainEnvelope = { v: 1, t: 'ask-again' }
    // Review 6i: their asks marked as earlier are read as such from now on, for a while (reask.ts acceptsReaskFrom). Set BEFORE the
    // send: the other phone re-asks the moment the relay hands it over, and its first re-ask can arrive here before the relay's reply
    // to this send does (seen in conversation_flow b after the review). A send that fails puts the previous value back.
    const stored = this.peerByDid(peer.did)
    const before = stored?.askAgainSentAt
    if (stored) stored.askAgainSentAt = Date.now()
    try {
      await this.channel.send(peer.did, env, await this.pairKey(peer))
    } catch {
      if (stored) { if (before === undefined) delete stored.askAgainSentAt; else stored.askAgainSentAt = before }
      return false
    }
    if (stored) {
      delete stored.askAgainDue
      this.hooks.save()
    }
    return true
  }

  /** On every connect of the drain: the ask-agains the relay did not take yet leave now. */
  private async flushAskAgain(): Promise<void> {
    for (const peer of this.hooks.state().peers.filter((p) => p.askAgainDue !== undefined)) await this.sendAskAgain(peer)
  }

  /**
   * B's side: `peer` tightened this phone's ring. One round of re-asks per connection at a time and per ASK_AGAIN_COOLDOWN_MS, only where
   * the app allows it (mayReask); this phone shows nothing about it (A's ring is A's own).
   */
  private async onAskAgain(peer: Peer): Promise<void> {
    if (this.hooks.mayReask?.(peer) !== true || !this.channel) return
    const now = Date.now()
    if (!askAgainAllowed(this.askAgainAt.get(peer.id), this.reasking.has(peer.id), now)) return
    this.askAgainAt.set(peer.id, now)
    this.reasking.add(peer.id)
    try {
      const plans = reaskCandidates(this.hooks.state().sentAsks, peer.id, now, (qid) => this.awaiting.has(qid))
      const timeoutMs = askTimeoutMs(undefined, this.windowMs)
      await Promise.all(plans.map((plan) => this.reaskOne(peer, plan, timeoutMs)))
    } finally {
      this.reasking.delete(peer.id)
    }
  }

  /**
   * One earlier ask, again, to `peer` only: a fresh qid, direct, this phone's window, marked as earlier (reask.ts reaskFields). A share at
   * the moment is shown at once (this phone waited for it, like the dock); a later yes lands as an ordinary late answer.
   */
  private async reaskOne(peer: Peer, plan: ReaskPlan, timeoutMs: number): Promise<void> {
    const qid = randomId(12)
    const s = this.hooks.state()
    // Noted before it leaves, so an answer that comes at once finds it; undone when the relay refuses it (review 6i: the earlier qid
    // stays the one a late yes is matched to, and a failed try costs nothing of the per-ask budget).
    s.sentAsks = noteReasked(s.sentAsks, plan.askId, peer.id, qid, Date.now())
    this.hooks.save()
    const onRefused = (): void => {
      const st = this.hooks.state()
      st.sentAsks = undoReasked(st.sentAsks, plan.askId, peer.id, plan.prev, Date.now())
      this.hooks.save()
    }
    const decoded = await this.sendAsk(peer, reaskText(plan), { ...reaskFields(plan), ...windowFields(this.windowMs) }, timeoutMs, qid, onRefused)
    const items = decoded?.outcome === 'shared' && decoded.shared ? sanitizeHopItems(decoded.shared.items) : []
    if (!items.length) return
    const st = this.hooks.state()
    const now = Date.now()
    const sent = sentAskFor(st.sentAsks, qid, peer.id, now)
    if (!sent) return
    st.lateAnswers = addShownAnswer(st.lateAnswers, sent, peer.displayName, items, now)
    st.sentAsks = forgetSentAsk(st.sentAsks, qid, now)
    this.hooks.save()
    this.hooks.onLateAnswersReleased?.()
  }

  /**
   * Wave 6h (wake_watch.ts, Q1/Q2): the machine woke from a sleep or came back online. The socket this tab holds may be dead without
   * knowing it: open a fresh one when this tab drains; else queue for the drain without taking it from a tab in front of the person.
   */
  refresh(): void {
    if (!this.lock || !this.identity) return
    if (this.lock.held()) void this.openDrain(this.identity)
    else this.lock.request(false)
  }
}

/** Wave 6i: a kept "nothing matched" card for this ask from this connection. */
function isUnmatchedFor(a: unknown, id: string, peerId: string): boolean {
  return typeof a === 'object' && a !== null && (a as { id?: unknown }).id === id && (a as { peerId?: unknown }).peerId === peerId
}

/** What the answer at an ask's moment did: what came back from the next step, and whether the relay took the answer. */
interface MomentResult {
  got: HopHarvest
  sent: boolean
}

/** The two ways one ask is answered (net.ts present). */
interface Replier {
  /** At the ask's moment, with what came back from the next step. */
  atMoment(own: SharedItem[]): Promise<MomentResult>
  /** A late yes: now, own items only. Resolves false when the relay did not take it. */
  late(own: SharedItem[]): Promise<boolean>
}
