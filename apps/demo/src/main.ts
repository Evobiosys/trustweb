import './app.css'
import { initI18n, t, getLang, toggleLang } from './i18n'
import { el, clear, coarseWhen } from './ui/dom'
import { renderQr, keepAwake } from './ui/qr'
import { scanQr, cameraPlausible } from './ui/scanner'
import {
  loadState, saveState, resetAll, threadsInScope, upsertPeer, findPeerByDid, PERSONAS,
  deviceMode, applyModePosture,
} from './state'
import { logAndDispatch } from './answer_log'
import { answerKeyFor, sealRelayAnswer } from './answer_key'
import type { DeviceState, Peer, Mode } from './state'
import { renderProfile } from './screens/profile'
import { renderModePicker, modeTitleKey } from './screens/mode_picker'
import { renderInventory } from './screens/inventory'
import { detectAndParse } from './parse/index'
import { matchTemplate } from './match/lexical'
import { TEMPLATES, getTemplate } from './data/templates'
import { freeTextTemplate } from './data/free_text_query'
import { classifyIncomingQuery } from './incoming_query'
import { decide, interpret, settleAt, GATE_BUDGET_MS } from './gate'
import { derivePairKey, deriveEcdhPairKey, randomId } from './crypto'
import { encodeForQr, decodeFromQr } from './wire'
import type { Envelope } from './wire'
import { SEED_DIRECT_IOS } from './data/seed_direct'
import seedGroupRaw from './data/seed-wien-wohnen.txt?raw'
import type {
  ChatThread, QueryEnvelope, AnswerEnvelope, MatchResult, QueryTemplate, Identity,
  DecodedAnswer, LocalOutcome,
} from './types'
import { FREE_TEXT_MAX_LEN } from './types'
import { renderMessageList, renderComposer, renderSecurityInfo } from './screens/chat'
import type { ChatLogEntry } from './screens/chat'
import { wotMode, wotScenario } from './mode'
import { createRelayChannel } from './relay'
import type { RelayChannel, RelayStatus } from './relay'
import { ensureRelayIdentity } from './relay_identity'
import { ecdhSharedSecret } from './did'
import { storageIsEphemeral } from './db'
import { buildConnectAck, buildConnectLinkUrl, parseConnectLinkParams } from './connect_link'
import type { ConnectLinkParams } from './connect_link'
import { createWebrtcChannel, decodeRtcPayload, encodeAnswerPayload, encodeOfferPayload } from './webrtc'
import type { WebrtcChannel, WebrtcStatus } from './webrtc'
import {
  ACCOMMODATION_TEMPLATE, ACCOMMODATION_TEMPLATE_ID, accommodationAbstractText, accommodationPreviewDe,
  accommodationPreviewEn, matchAccommodation,
} from './match/accommodation'
import { SEED_GRAPH_NODES } from './data/geologengasse'
import type { GraphNode } from './data/geologengasse'
import { JAKOB_LADDER_INVENTORY_TEXT, A_NOTE_ABOUT_JAKOB_TEXT, A_NOTE_ABOUT_JAKOB_FLAT_TEXT } from './data/second_hop'
import { RELAY_DEADLINE_MS } from './gate'
import type { SharedItem, SharedPayload } from './types'
import type { SecondBrainNote } from './state'

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app') as HTMLElement
let state: DeviceState | null = null
let releaseWake: () => void = () => {}

type Screen = 'start' | 'modePick' | 'home' | 'chats' | 'profile' | 'inventory' | 'connect' | 'ask' | 'answer' | 'link' | 'graph' | 'log'
let screen: Screen = 'start'

/**
 * The mode currently selected on whichever onboarding screen is on view
 * (screenStart's persona flow, screenGeoNameEntry, screenSecondHopNameEntry,
 * screenModePick). One module-level var, not per-screen state, because only
 * one onboarding screen is ever live at a time on a given device -- same
 * convention as `pendingGeoQueries`/`geoCeremonyBusy` below. Defaults to
 * 'standard' (I9: a person who taps straight through, touching no radio at
 * all, gets the safe default).
 */
let onboardingMode: Mode = 'standard'

/**
 * Demo 20/21 only (mode.ts's geologengasse/secondHop scenarios): Jakob's own
 * laptop used to auto-seed straight to `home` in boot() below, with no
 * screen in between -- the one device in this app that never passed through
 * screenStart() at all, and therefore never got a chance to pick a mode.
 * The handover is explicit that Jakob picks his mode too, on every device
 * including his own, so boot() now defers the actual seed call until he has
 * (screenModePick, below) -- this remembers WHICH seed function to run once
 * he does. `null` means no seed is pending (the ordinary case for every
 * other scenario, and for a Jakob laptop that already has state on disk).
 */
let pendingJakobSeedKind: 'geo' | 'secondHop' | null = null

// ---------------------------------------------------------------------------
// relay mode: session, status, and the in-flight query/answer this device is
// waiting on. All of this is inert (never touched) when wotMode() === 'qr',
// which is demo 1's exact, unchanged default -- see mode.ts.
// ---------------------------------------------------------------------------

let relayChannel: RelayChannel | null = null
let relayStatus: RelayStatus = 'connecting'
let relayStatusAt = 0
/** The badge currently on screen, if any -- see mountRelayStatusBadge(). Reset
 *  by shell() on every screen transition so a stale reference is never
 *  written into a detached DOM node. */
let relayStatusBadgeEl: HTMLElement | null = null
/** Set by handleIncomingEnvelope() when a QueryEnvelope arrives before the
 *  user has navigated to 'answer' themselves; screenAnswer() consumes it.
 *  Default scenario only -- see `pendingGeoQueries` below for demo 20. */
let pendingIncomingQuery: QueryEnvelope | null = null
/**
 * Demo 20 only. Several people can query Jakob independently, so a second
 * query arriving while he is still mid-consent-ceremony for a first one
 * must not silently clobber it (the default scenario's single
 * `pendingIncomingQuery` slot would do exactly that). Queued, FIFO;
 * screenAnswer() and the "next request" action after answering both drain
 * it one at a time.
 */
let pendingGeoQueries: QueryEnvelope[] = []
/** True from the moment a geo consent ceremony starts (runConsentCeremony)
 *  until its answer has actually been sent (emitAnswer's promise settles).
 *  See handleIncomingEnvelope's query branch for why this, not `screen`, is
 *  the correct "is a human decision pending right now" signal. */
let geoCeremonyBusy = false
/**
 * Every query this device is currently waiting on an answer for, keyed by
 * qid. A plain Map rather than the single-slot `{qid,resolve}|null` this
 * replaced: askNetwork() (Ins Netzwerk rufen) sends a distinct qid to EACH
 * connected peer and waits on all of them concurrently, which the old single
 * slot could not represent (a second concurrent wait would silently steal
 * the first one's resolution). The single-peer ask functions
 * (askOverRelay/askOverWebrtc) use the exact same map with one entry, so
 * their behaviour is unchanged.
 */
const awaitingAnswers = new Map<string, (env: AnswerEnvelope) => void>()

/**
 * The one-scan connect link (connect_link.ts): parsed once, at module load,
 * from whatever URL opened this page. `null` on every ordinary visit.
 * Consumed exactly once, by `completeConnectLinkIfPending()` -- see that
 * function for the phone's half of the ceremony this feature exists for.
 * `typeof location` guards this the same way relay.ts's own
 * `resolveRelayOrigin` does, for a non-jsdom test/Node context with no
 * global `location`.
 */
let pendingConnectLink: ConnectLinkParams | null =
  typeof location !== 'undefined' ? parseConnectLinkParams(location.search) : null

/**
 * Demo 20 only (`wotScenario() === 'geologengasse'`): every connect-ack that
 * has arrived over the relay but that Jakob has not yet tapped "Anfrage
 * bestätigen" for. `handleRawWire` pushes onto this list instead of
 * upserting a peer straight away -- see that function's scenario branch.
 *
 * Demo 20 is not a two-device demo: several people (the one excited relative,
 * then her friends) each open the same connect link and each send their own
 * request. Every request waits here, visibly, confirmed SEPARATELY -- one
 * "Anfrage bestätigen" tap per person, never a bulk accept. Keyed by `did`
 * (unique per requester's relay identity); a second ack from a did already
 * pending replaces that one entry rather than adding a duplicate card.
 */
let pendingAcceptRequests: { did: string; from: Identity }[] = []

// ---------------------------------------------------------------------------
// webrtc mode (demo 3) and ladder mode (demo 6): rung 2, a data channel with
// no server in the path. Inert (never created) when wotMode() is 'qr' or
// 'relay'. See webrtc.ts's module doc for what this rung does and does not
// protect, and webrtc_sdp.ts for why an SDP fits a QR at all.
// ---------------------------------------------------------------------------

let webrtcChannel: (WebrtcChannel & {
  createOffer: () => Promise<import('./webrtc_sdp').TightIceOffer>
  acceptAnswer: (a: import('./webrtc_sdp').TightIceOffer) => Promise<void>
  acceptOffer: (o: import('./webrtc_sdp').TightIceOffer) => Promise<import('./webrtc_sdp').TightIceOffer>
}) | null = null
let webrtcStatusBadgeEl: HTMLElement | null = null

/**
 * Set by demo 3's "über den Server versuchen" escape hatch (webrtc connect
 * failed or timed out) and by ladder mode's per-ask automatic fall-through.
 * Once true, ask/answer route over the relay for the rest of the session --
 * demo 3 never silently retries webrtc after a human has explicitly opted
 * out of the "no server" claim for this pairing.
 */
let useRelayFallback = false

/** Which rung actually carried the last ask/answer -- ladder mode's whole
 *  point is making this visible, not just true. */
type Rung = 'qr' | 'webrtc' | 'relay'
let lastRung: Rung | null = null

function webrtcStatusText(status: WebrtcStatus): string {
  switch (status) {
    case 'gathering-offer':
    case 'gathering-answer':
      return t('webrtcGathering')
    case 'awaiting-answer':
    case 'connecting':
      return t('webrtcConnecting')
    case 'open':
      return t('webrtcOpen')
    case 'failed':
      return t('webrtcFailedTitle')
    default:
      return t('noConnection')
  }
}

function mountWebrtcStatusBadge(): HTMLElement {
  const badge = el('p', { class: 'note' }, [webrtcChannel ? webrtcStatusText(webrtcChannel.status()) : t('noConnection')])
  webrtcStatusBadgeEl = badge
  return badge
}

function updateWebrtcStatusBadge(): void {
  if (webrtcStatusBadgeEl && webrtcChannel) webrtcStatusBadgeEl.textContent = webrtcStatusText(webrtcChannel.status())
}

function rungBadgeText(rung: Rung): string {
  if (rung === 'webrtc') return t('rungWebrtc')
  if (rung === 'relay') return useRelayFallback && webrtcChannel ? t('rungRelayAfterWebrtc') : t('rungRelay')
  return t('rungQr')
}

function relayStatusText(): string {
  const label =
    relayStatus === 'connected' ? t('relayConnected')
    : relayStatus === 'connecting' ? t('relayConnecting')
    : t('relayDisconnected')
  if (!relayStatusAt) return label
  const time = new Date(relayStatusAt).toLocaleTimeString(getLang() === 'de' ? 'de-AT' : 'en-GB')
  return `${label} (${t('relaySince')} ${time})`
}

/** Renders a live status line. Kept up to date by relayChannel's onStatus
 *  callback DIRECTLY MUTATING this element's textContent -- never by calling
 *  render() from a background event, which would tear down whatever the user
 *  is currently doing (a camera stream, a QR code holding a wake lock). */
function mountRelayStatusBadge(): HTMLElement {
  const badge = el('p', { class: 'note' }, [relayStatusText()])
  relayStatusBadgeEl = badge
  return badge
}

function updateRelayStatusBadge(): void {
  if (relayStatusBadgeEl) relayStatusBadgeEl.textContent = relayStatusText()
}

/**
 * (Re-)registers the drain sink. Must be called again whenever a pair key
 * can have changed -- a real connect ceremony overwrites nonceSelf/noncePeer
 * (or adds a new peer), and onEnvelope() only ever keeps one registration
 * (relay.ts), so a stale registration here means inbound wires silently
 * fail to decrypt and are never acked.
 *
 * ALWAYS uses relay.ts's `PairKeyResolver` shape (a function that looks the
 * right peer up by the wire's cleartext sender DID and derives THEIR pair
 * key), not a single fixed key for `peers[0]`. Originally this branched by
 * scenario -- every other demo pinned one peer, only demo 20's geologengasse
 * scenario (Jakob's laptop, which can hold several peers at once, each
 * pairing separately -- see the coordinator's scope note this function
 * exists to satisfy) used the resolver. "Call into the web" (Ins Netzwerk rufen
 * fragen, main.ts's askNetwork()) needs the SAME multi-peer capability in
 * the DEFAULT scenario too -- an asker can be paired to more than one holder
 * and broadcast to all of them -- so the resolver is now unconditional. It
 * closes over `state` (not a copy of `state.peers`), so peers accepted after
 * this registration are found too without needing to re-register --
 * `acceptPendingRequest()` still calls this again anyway, belt-and-suspenders,
 * see its own doc comment. For the single-peer case (every demo before this
 * change) this is behaviourally identical to the old fixed-key branch: the
 * resolver finds the one peer by did and derives the one key, same as
 * before.
 */
async function registerRelaySink(): Promise<void> {
  if (!relayChannel || !state) return
  const s = state
  relayChannel.onEnvelope(async (fromDid: string) => {
    const peer = findPeerByDid(s, fromDid)
    if (!peer) return null
    return pairKey(peer)
  }, handleIncomingEnvelope)
}

/**
 * The conversation and the probe.
 *
 * Deliberately in memory only. This is a demo of a live link, not a messenger:
 * persisting it would mean deciding what happens to it on a device that blocks
 * storage (see db.ts), and none of that teaches anyone anything about whether
 * the connection works. Closing the tab ends the conversation, which is also
 * the honest thing to tell someone.
 */
const chatLog: ChatLogEntry[] = []
let unreadChat = 0
let pendingPing: { id: string; sentAt: number; resolve: (ms: number) => void } | null = null

/**
 * Send one envelope over whichever transport is currently up, without the
 * caller having to know which. Prefers the direct data channel when it is
 * open, because a message that never touches a server is the better
 * demonstration when both are available.
 *
 * Throws when nothing is connected, so a caller can say so rather than
 * silently dropping the message.
 */
/**
 * Send to ONE named peer, rather than to whoever happens to be `peers[0]`.
 *
 * Needed the moment several people are paired at once: accepting Kaja has to
 * tell Kaja, not whoever joined first. `sendOverActiveTransport` below stays
 * as the convenience wrapper for the single-peer demos.
 */
async function sendToPeer(peer: Peer, env: Envelope): Promise<void> {
  if (webrtcChannel && webrtcChannel.isOpen()) { webrtcChannel.send(env); return }
  if (!relayChannel || !peer.did) throw new Error(t('noConnection'))
  await relayChannel.send(peer.did, env, await pairKey(peer))
}

async function sendOverActiveTransport(env: Envelope): Promise<'webrtc' | 'relay'> {
  if (webrtcChannel && webrtcChannel.isOpen()) {
    webrtcChannel.send(env)
    return 'webrtc'
  }
  const s = state
  const peer = s?.peers[0]
  if (!relayChannel || !peer?.did) throw new Error(t('noConnection'))
  await relayChannel.send(peer.did, env, await pairKey(peer))
  return 'relay'
}

/** Dispatches a decrypted, validated inbound envelope. Registered as the
 *  inbound sink for BOTH relay.ts's `onEnvelope(key, cb)` (2-arg,
 *  `fromDid` unused here -- routing already narrowed to "the one paired
 *  peer", see below) and webrtc.ts's `onEnvelope(cb)` (1-arg) -- `_fromDid`
 *  is therefore optional, not just unused, so this one function satisfies
 *  both channel shapes. Never called at all when wotMode() === 'qr' (no
 *  channel is ever created there). */
function handleIncomingEnvelope(env: Envelope, _fromDid?: string): void {
  if (env.t === 'answer') {
    const resolve = awaitingAnswers.get(env.qid)
    if (resolve) resolve(env)
    return
  }
  if (env.t === 'query') {
    // Ambient arrival (relay/webrtc, nobody chose to scan anything): matched
    // first, interrupted only if that match earns it. See
    // handleAmbientQuery's own doc comment and incoming_query.ts.
    void handleAmbientQuery(env)
    return
  }
  if (env.t === 'chat') {
    chatLog.push({ kind: 'text', mine: false, text: env.text, at: Date.now() })
    // Only redraw if the person is looking at the conversation. Yanking them
    // out of a consent screen because a message arrived would be worse than
    // the message waiting.
    if (screen === 'link') render()
    else unreadChat += 1
    return
  }
  if (env.t === 'ping') {
    // Demo 20, guest side. This device sent a request and then had no way to
    // learn it had been confirmed, so it sat on "Anfrage gesendet" while it
    // was already connected. The first thing that arrives from a DID it knows
    // can only mean the other side accepted, so treat it as the signal and
    // land the person in the conversation with the name of who confirmed.
    const st = state
    if (wotScenario() === 'geologengasse' && st && st.me.id !== 'jakob' && screen !== 'link') {
      const from = st.peers.find((x) => x.did === _fromDid) ?? st.peers[0]
      justAccepted = from?.displayName ?? null
      go('link')
    }
    if (!env.back) {
      // Someone is testing the line. Answer immediately and say nothing about
      // it on screen: the test belongs to whoever pressed the button.
      void sendOverActiveTransport({ v: 1, t: 'ping', id: env.id, back: true })
    } else if (pendingPing && pendingPing.id === env.id) {
      pendingPing.resolve(Date.now() - pendingPing.sentAt)
    }
    return
  }
  // A ConnectEnvelope never travels over the relay in this app -- pairing is
  // QR-only (handover's Task 2/3 split) -- so this is unreachable in
  // practice; ignored rather than asserted, matching wire.ts's "never throw
  // on unexpected shape" posture.
}

/**
 * The relay channel's `onRawWire` sink (registered in bringUpRelayChannel):
 * fires for the CLEARTEXT `from`/`payload` of every drained wire, decrypted
 * or not -- see relay.ts's `onRawWire` doc comment for why. The only shape
 * this ever recognises is a `connect-ack` (connect_link.ts's module
 * header); every ordinary query/answer/chat/ping wire is AES-GCM ciphertext
 * base64url, which `decodeFromQr`'s `JSON.parse` fails on harmlessly, so
 * this is a silent no-op for all of them, exactly matching wire.ts's own
 * "never throw on unexpected shape" posture.
 *
 * This is the LAPTOP's half of the one-scan ceremony: the phone's
 * `completeConnectLinkIfPending()` sends this; receiving it here is what
 * lets the laptop finally learn who scanned its link and complete the
 * pairing on receipt, live, without a reload (screenConnect() re-renders
 * because `screen` never left `'connect'` while the link/QR was on
 * screen -- see showConnectLinkCode()).
 *
 * RETURNS `true` only on the paths that genuinely recognised this wire as a
 * connect-ack meant for this device (root-caused 2026-09-05, see relay.ts's
 * `onRawWire` doc comment): every early `return` below -- not a connect-ack,
 * a `did` mismatch, no `state` yet -- returns `false`/`void`, which
 * `handleWire` now treats as "not handled", leaving the wire un-acked so an
 * un-acked ordinary encrypted wire (this function's silent no-op case, by
 * far the common one) is correctly redelivered instead of silently and
 * permanently dropped.
 */
function handleRawWire(fromDid: string, payload: string): boolean {
  const env = decodeFromQr(payload)
  if (!env || env.t !== 'connect-ack') return false
  // The outer wire's cleartext `from` (relay.ts's routing field) must match
  // what the envelope itself claims -- a mismatch is either a relay bug or
  // tampering, either way not something to trust silently.
  if (env.did !== fromDid) return false
  const s = state
  if (!s) return false
  if (wotScenario() === 'geologengasse') {
    // Demo 20: nobody joins Jakob's graph without an explicit tap on
    // "Anfrage bestätigen" -- see acceptPendingRequest() below. Several
    // people can have a request open at once; each one is confirmed
    // separately. A did already accepted (a resend of the same ack, e.g.
    // after a reload) never re-queues -- just make sure the multi-peer sink
    // still covers it.
    if (s.peers.some((p) => p.did === env.did)) {
      void registerRelaySink()
      return true
    }
    const req = { did: env.did, from: env.from }
    const idx = pendingAcceptRequests.findIndex((r) => r.did === env.did)
    if (idx >= 0) pendingAcceptRequests[idx] = req
    else pendingAcceptRequests.push(req)
    // Full re-render only where the card itself lives (unchanged: still
    // avoids wiping an in-progress chat draft elsewhere -- see
    // pendingRequestBubble()'s doc comment). The bubble refresh below is
    // unconditional, so the request is visible from EVERY screen, not just
    // these two, even when no full render happens.
    if (screen === 'connect' || screen === 'home') render()
    else refreshPendingRequestBubble()
    return true
  }
  upsertPeer(s, {
    id: env.from.id,
    displayName: env.from.displayName,
    // Unused placeholders: this peer's `pairing: 'ecdh'` means pairKey()
    // never reads these -- see state.ts's `Peer.pairing` doc comment. Filled
    // anyway because the Peer type still requires a value.
    nonceSelf: randomId(16),
    noncePeer: randomId(16),
    connectedAt: Date.now(),
    blocked: false,
    seeded: false,
    did: env.did,
    pairing: 'ecdh',
  })
  void saveState(s).then(() => registerRelaySink())
  if (screen === 'connect') render()
  return true
}

/**
 * Demo 20's accept gesture: the button labelled "Anfrage bestätigen" on ONE
 * person's pending-request card. Only after this runs does that requester
 * become one of `state.peers` (appended -- see state.ts's `upsertPeer`,
 * which pushes rather than replaces) AND does the graph screen show them as
 * a live, first-ring bubble -- see screenGraph()'s doc comment on why it
 * reads `state.peers` directly rather than a separate list.
 *
 * All three steps matter and must happen in this order: upsert the peer,
 * persist it, THEN re-register the relay sink. Skipping the third step is
 * the failure mode that looks like it worked -- the bubble appears, but the
 * multi-peer resolver (registerRelaySink()'s geologengasse branch) has
 * nothing telling it a new pair key now exists, so every query the newly
 * accepted person sends afterwards silently fails to decrypt and is never
 * acked. In practice `registerRelaySink()`'s resolver closes over `state`
 * itself and re-reads `state.peers` on every inbound wire, so a single
 * registration already covers peers accepted later too -- this call is
 * belt-and-suspenders, not load-bearing on every acceptance, but kept
 * explicit so that invariant is never assumed silently.
 */
async function acceptPendingRequest(did: string): Promise<void> {
  const s = state
  const idx = pendingAcceptRequests.findIndex((r) => r.did === did)
  if (!s || idx < 0) return
  const req = pendingAcceptRequests[idx]
  pendingAcceptRequests.splice(idx, 1)
  upsertPeer(s, {
    id: req.from.id,
    displayName: req.from.displayName,
    nonceSelf: randomId(16),
    noncePeer: randomId(16),
    connectedAt: Date.now(),
    blocked: false,
    seeded: false,
    did: req.did,
    pairing: 'ecdh',
  })
  await saveState(s)
  await registerRelaySink()

  // Tell the person they are in. Until this, the guest device had no signal at
  // all that the tap had happened, so it sat on a "request sent" screen
  // indefinitely while it was in fact already connected. Any envelope from a
  // DID the guest knows is proof of acceptance, so a probe is enough and no
  // new wire type is needed.
  const accepted = s.peers.find((x) => x.did === req.did)
  if (accepted) {
    try { await sendToPeer(accepted, { v: 1, t: 'ping', id: randomId(10), back: false }) }
    catch { /* the bubble and the peer are already real; a lost hello is not fatal */ }
  }
  justAccepted = req.from.displayName
  go('link')
}

/** Name of the person accepted a moment ago, so the chat screen can open with
 *  "Verbunden mit X" instead of silently appearing. Cleared once shown. */
let justAccepted: string | null = null

function declinePendingRequest(did: string): void {
  pendingAcceptRequests = pendingAcceptRequests.filter((r) => r.did !== did)
  render()
}

/**
 * The PHONE's half of the one-scan ceremony (connect_link.ts): if this page
 * was opened from a connect link, ensure this device's own relay identity
 * and relay channel exist, replace the seeded/previous peer with the real
 * one the link named, tell the laptop who we are (a `connect-ack`, sent
 * UNENCRYPTED via `sendRaw` -- see connect_link.ts's module header for why
 * that is safe here and nowhere else), and land on the connect screen so
 * this device ALSO shows "verbunden mit …" without a reload.
 *
 * A no-op with nothing pending, or outside relay mode -- the one-scan
 * ceremony is relay-only (the handover for this feature: "which demos get
 * this: demo 2 at minimum"). Called from boot() (a returning session that
 * happens to have been opened via a connect link -- unusual, but a device
 * already paired to someone else can still be re-pointed at a new peer) and
 * from seedPersona() (the ordinary first-visit case: a brand-new phone,
 * still on the persona picker, opened this exact link).
 */
async function completeConnectLinkIfPending(): Promise<void> {
  const params = pendingConnectLink
  if (!params || wotMode() !== 'relay' || !state) return
  pendingConnectLink = null
  // One-shot: a reload of this same tab must not re-send a stale ack, and
  // the peer's DID/id have no reason to sit in browser history once used.
  if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname)

  const s = state
  const didIdentity = await ensureRelayIdentity(s)
  upsertPeer(s, {
    id: params.from.id,
    displayName: params.from.displayName,
    nonceSelf: randomId(16),
    noncePeer: randomId(16),
    connectedAt: Date.now(),
    blocked: false,
    seeded: false,
    did: params.did,
    pairing: 'ecdh',
  })
  await saveState(s)

  if (!relayChannel) await bringUpRelayChannel(s)
  await registerRelaySink()
  const ack = buildConnectAck(s.me, didIdentity)
  try {
    await relayChannel?.sendRaw(params.did, encodeForQr(ack))
  } catch {
    // The peer record above is already saved either way, so the laptop
    // learning about this pairing is only delayed, not lost -- a
    // reconnect's fresh registerRelaySink()/onRawWire registration (or the
    // laptop re-showing its link) can still complete it. Nothing to surface
    // here beyond what the connect screen's relay status badge already says.
  }
  go('connect')
}

/**
 * Opens this device's relay drain connection, once. A no-op in qr mode
 * (wotMode() !== 'relay') and a no-op if already initialised -- safe to call
 * from both boot() (a returning session) and seedPersona() (a fresh one).
 * Fire-and-forget on purpose: the caller does not await this, so the home
 * screen renders immediately and the connection catches up in the
 * background, its status reflected by the badge, never a blocking spinner.
 */
async function initRelaySession(): Promise<void> {
  // Ladder mode (demo 6) needs the relay live from the start -- it is rung
  // 3, the automatic fall-through, not something a human opts into. Webrtc
  // mode (demo 3) never calls this from boot/seedPersona; there the relay
  // is only ever brought up on demand, by ensureRelayFallback() below, once
  // a person has explicitly tapped "über den Server versuchen".
  if ((wotMode() !== 'relay' && wotMode() !== 'ladder') || !state || relayChannel) return
  await bringUpRelayChannel(state)
}

/**
 * Single-flight guard for {@link bringUpRelayChannel} -- root-caused
 * 2026-09-04 (the "second guest" relay reliability bug). Every caller
 * (`initRelaySession()`, `ensureRelayFallback()`,
 * `completeConnectLinkIfPending()`) used to guard its own call with a plain
 * `if (relayChannel) return`, but `bringUpRelayChannel` does not assign the
 * module-level `relayChannel` until AFTER its first `await`
 * (`ensureRelayIdentity`). That left a window, between "check passed" and
 * "`relayChannel` actually set", in which a SECOND caller's identical guard
 * also passed -- exactly what happened on Jakob's laptop: `seedJakob()`
 * fires `initRelaySession()` without awaiting it, and `boot()`
 * unconditionally fires `initRelaySession()` again immediately afterward for
 * the same fresh boot. Both calls landed in that window, so `main.ts` built
 * TWO independent `RelayChannel` instances -- two independent WebSocket
 * drains, each separately authenticating as the SAME did:peer:2 (once
 * `relay_identity.ts`'s own single-flight fix closed the identity half of
 * this race). `relay_server.ts` keeps exactly one live drain per DID and
 * closes the prior connection the moment a new one authenticates
 * (`handleAuth`'s `prior.close()`), so the two channels then fought
 * indefinitely over that one slot -- reconnecting, displacing each other,
 * and racing their own un-acked-wire redelivery -- which is what actually
 * produced the observed symptoms: a pending-request card that sometimes
 * never renders, and a broadcast query that sometimes never reaches, or
 * reaches twice, whichever peer's wire happened to land mid-fight. Proven
 * live: instrumenting `WebSocket` in a real two-guest Playwright run against
 * the deployed demo showed Jakob's page opening a second `/relay/drain`
 * socket 9ms after the first, both authenticating, the first getting
 * displaced and closed, then reconnecting a third time ~1s later on its own
 * backoff -- all before any guest had even sent a wire.
 *
 * The fix: `bringUpRelayChannel` itself is now single-flight, keyed on a
 * promise created and stored SYNCHRONOUSLY (no await before the store), so a
 * second call landing anywhere inside the first call's execution -- no
 * matter which caller, present or future -- awaits and returns the exact
 * same channel instead of building a second one. The callers' own
 * `if (relayChannel)` guards are left in place as a harmless fast path (skip
 * the call entirely once a channel already exists), not because they are
 * still load-bearing for correctness.
 */
let relayChannelReady: Promise<void> | null = null

/** Shared by initRelaySession() (relay/ladder mode, automatic) and
 *  ensureRelayFallback() (webrtc mode, manual escape hatch). Single-flight --
 *  see {@link relayChannelReady}'s doc comment. */
async function bringUpRelayChannel(s: DeviceState): Promise<void> {
  if (relayChannelReady) return relayChannelReady
  relayChannelReady = (async () => {
    const identity = await ensureRelayIdentity(s)
    const channel = createRelayChannel()
    relayChannel = channel
    channel.onStatus((status, at) => {
      relayStatus = status
      relayStatusAt = at
      updateRelayStatusBadge()
    })
    // The one-scan connect-link ceremony's bootstrap sink (connect_link.ts) --
    // harmless to register unconditionally: it only ever recognises a
    // `connect-ack` payload, and every ordinary encrypted wire fails that
    // check silently (see handleRawWire's doc comment).
    channel.onRawWire(handleRawWire)
    await registerRelaySink()
    try {
      await channel.connect(identity)
    } catch {
      // The status badge already reflects this ('disconnected'); relay.ts's
      // channel keeps retrying with backoff in the background regardless, and
      // onStatus will report 'connected' the moment a later attempt succeeds.
    }
  })()
  return relayChannelReady
}

/**
 * Demo 3's manual escape hatch: brings up the exact same relay channel
 * relay/ladder mode use, on demand, the first time a person taps "über den
 * Server versuchen" after a webrtc connect failure or timeout. Idempotent --
 * a second tap (e.g. after backing out and returning) does not open a
 * second channel.
 */
async function ensureRelayFallback(): Promise<void> {
  useRelayFallback = true
  if (relayChannel || !state) return
  await bringUpRelayChannel(state)
}

/**
 * Races a relay send against an inbound answer for `qid` and a timeout.
 * `cancel()` tears down the wait without resolving -- used when the user
 * backs out or switches to the QR fallback, so a late answer does not fire
 * into a screen that has moved on.
 */
// Three minutes, not twenty seconds.
//
// This is not a network timeout, it is how long the ASKING device waits for a
// PERSON to make up their mind. Twenty seconds is fine for a machine and far
// too short for someone who is mid-conversation, looking at the preview and
// deciding whether to give a stranger their address. Live, the asker saw
// "Keine Antwort übers Netz" while the answer was still being considered --
// which reads as broken, and worse, invites the asker to conclude something
// about a decision that had not been made yet.
const RELAY_ANSWER_TIMEOUT_MS = 180_000

/** How long to wait for an answer over an already-open webrtc data channel
 *  before treating it as failed. Shorter than the relay's timeout: there is
 *  no network hop or server queue to account for, only the other device's
 *  own machine-time-equalisation budget (gate.ts's GATE_BUDGET_MS, 900ms)
 *  plus however long a person takes to look at the consent prompt and tap
 *  yes/no -- 20s stays generous for that human factor while still failing
 *  fast enough that the ladder's automatic fall-through (or demo 3's manual
 *  escape hatch) is not itself a bad experience. */
const WEBRTC_ANSWER_TIMEOUT_MS = 180_000 // same reasoning as RELAY_ANSWER_TIMEOUT_MS above

function waitForAnswer(qid: string, timeoutMs: number): { promise: Promise<AnswerEnvelope | null>; cancel: () => void } {
  let done = false
  let resolveFn: (env: AnswerEnvelope | null) => void = () => {}
  const promise = new Promise<AnswerEnvelope | null>((resolve) => { resolveFn = resolve })
  const timer = setTimeout(() => {
    if (done) return
    done = true
    awaitingAnswers.delete(qid)
    resolveFn(null)
  }, timeoutMs)
  awaitingAnswers.set(qid, (env) => {
    if (done) return
    done = true
    clearTimeout(timer)
    awaitingAnswers.delete(qid)
    resolveFn(env)
  })
  const cancel = (): void => {
    if (done) return
    done = true
    clearTimeout(timer)
    awaitingAnswers.delete(qid)
    resolveFn(null)
  }
  return { promise, cancel }
}

function shell(title: string, body: HTMLElement, opts: { back?: () => void } = {}): void {
  releaseWake()
  releaseWake = () => {}
  relayStatusBadgeEl = null
  webrtcStatusBadgeEl = null
  clear(root)
  const lang = getLang()
  const bar = el('div', { class: 'topbar' }, [
    opts.back
      ? el('button', { class: 'langtoggle', onclick: opts.back, 'aria-label': t('back') }, ['←'])
      : null,
    el('div', { class: 'who' }, [
      title,
      state ? el('small', {}, [state.me.displayName + ' · ' + t('appName')]) : null,
    ]),
    el('button', {
      class: 'langtoggle',
      onclick: () => { toggleLang(); render() },
      'aria-label': 'Sprache wechseln / switch language',
    }, [
      lang === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
      document.createTextNode(' / '),
      lang === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
    ]),
  ])
  const nb = netBubble()
  root.append(bar, el('main', {}, [body]))
  if (nb) root.append(nb)
  const prb = pendingRequestBubble()
  if (prb) root.append(prb)
}


/**
 * The little corner marker showing the web growing.
 *
 * Deliberately a small thing at the edge, not a banner across the top: the
 * owner asked for something "not on top of everything, but a bubble on the
 * side". It pulses when the count goes up, which is the only moment it has
 * anything to say, and a tap opens the full graph. Demo 20 only, since it is
 * the only scenario where the number can be more than one.
 */
let lastPeerCount = 0
function netBubble(): HTMLElement | null {
  if (wotScenario() !== 'geologengasse' || !state) return null
  const n = state.peers.length
  if (n === 0) return null
  const grew = n > lastPeerCount
  lastPeerCount = n
  const bubble = el('button', {
    // The chat screen now pins a composer to the bottom (chat-signal
    // handover, item 4) -- lift the bubble clear of it there, same fixed
    // corner everywhere else.
    class: 'netbubble' + (grew ? ' grew' : '') + (screen === 'link' ? ' above-composer' : ''),
    onclick: () => go('graph'),
    'aria-label': t('netGrew'),
  }, [
    el('b', {}, [String(n)]),
    el('small', {}, [n === 1 ? t('netGrew') : t('netPeople')]),
  ])
  return bubble
}

/**
 * A second corner marker, root-caused 2026-09-05 alongside the ack fix
 * (relay.ts's onRawWire doc comment): `pendingRequestCard()` only ever
 * renders on `screenHome()`/`screenConnect()`, and the wire that queues an
 * entry into `pendingAcceptRequests` (`handleRawWire`) only calls `render()`
 * when `screen === 'connect' || screen === 'home'` -- deliberately, because
 * `render()` fully rebuilds the DOM (`shell()`'s `clear(root)`), which would
 * wipe an in-progress, unsent chat composer draft (`renderComposer()` in
 * screens/chat.ts is a plain uncontrolled `<textarea>`, not backed by any
 * JS state -- see that module).
 *
 * The bug this shipped as: the ONE screen a person is overwhelmingly likely
 * to be on when a SECOND guest's request arrives is exactly the one that
 * gate excludes -- `'link'`, the chat screen `acceptPendingRequest()` sends
 * the FIRST guest's acceptor to (`go('link')`). The wire was correctly
 * received and queued (and, after the ack fix above, correctly acked
 * because it WAS genuinely handled) -- it simply never became visible,
 * because nothing ever re-rendered `screenHome()`/`screenConnect()` to show
 * it, and `pendingAcceptRequests` is plain in-memory state (never persisted
 * via `saveState`), so even a reload could not recover it: reproduced live,
 * deterministically (5/5), against the deployed build.
 *
 * The fix: a second bubble, exactly like `netBubble()` above but for
 * `pendingAcceptRequests` instead of `state.peers`, mounted the same way
 * (returned from here, appended by `shell()`) SO IT APPEARS ON EVERY
 * SCREEN'S NEXT NATURAL RENDER -- but that alone still requires a render to
 * happen. `refreshPendingRequestBubble()` below is the other half: it
 * inserts/updates/removes this exact element DIRECTLY in the live DOM,
 * without calling `render()`, so a request that arrives while the person
 * sits on `'link'` (or any other screen) becomes visible IMMEDIATELY without
 * touching -- and therefore without clearing -- whatever they were doing.
 */
function pendingRequestBubble(): HTMLElement | null {
  if (wotScenario() !== 'geologengasse' || pendingAcceptRequests.length === 0) return null
  const n = pendingAcceptRequests.length
  return el('button', {
    class: 'netbubble pending' + (screen === 'link' ? ' above-composer' : ''),
    onclick: () => go('home'),
    'aria-label': t('geoPendingTitle'),
  }, [
    el('b', {}, [String(n)]),
    el('small', {}, [t('geoPendingTitle')]),
  ])
}

/** Out-of-band counterpart to {@link pendingRequestBubble} -- see its doc
 *  comment. Mutates the live DOM directly (insert/update/remove one
 *  `.netbubble.pending` element) instead of going through `render()`, so
 *  calling this is always safe, from any code path, on any screen, without
 *  the composer-wipe risk a full re-render carries. Idempotent: safe to
 *  call after every change to `pendingAcceptRequests` (add, accept,
 *  decline), whether or not a `render()` is ALSO about to happen for other
 *  reasons -- the next `shell()` call will simply reconcile to the same
 *  element via `pendingRequestBubble()`. */
function refreshPendingRequestBubble(): void {
  const existing = root.querySelector('.netbubble.pending')
  const next = pendingRequestBubble()
  if (!next) {
    existing?.remove()
    return
  }
  if (existing) existing.replaceWith(next)
  else root.appendChild(next)
}

function go(s: Screen): void { screen = s; render() }

function render(): void {
  // Jakob's own laptop bootstrap (demo 20/21, pendingJakobSeedKind's own
  // doc comment): `state` stays null until finishJakobOnboarding actually
  // seeds it, so the ordinary "`!state` means screenStart()" shortcut below
  // would otherwise route here every re-render (langtoggle included) and
  // never show screenModePick at all. Checked BEFORE the `!state` shortcut,
  // not folded into the switch, for the exact same reason that shortcut
  // exists in the first place: `screen` alone is not the source of truth
  // for what a state-less boot shows.
  if (!state && pendingJakobSeedKind) return void screenModePick()
  if (!state) return void screenStart()
  // 'modePick' has no case here: it only ever renders through the `!state`
  // guard above, never through this switch (by the time `state` exists,
  // finishJakobOnboarding has already called go('home')).
  switch (screen) {
    case 'chats':     return screenChats()
    case 'profile':   return screenProfile()
    case 'inventory': return screenInventory()
    case 'connect': return screenConnect()
    case 'ask':     return screenAsk()
    case 'answer':  return screenAnswer()
    case 'link':    return screenLink()
    case 'graph':   return screenGraph()
    case 'log':     return screenLog()
    default:        return screenHome()
  }
}

// ---------------------------------------------------------------------------
// start: pick a persona, seed the device
// ---------------------------------------------------------------------------

/**
 * Demo 20's start screen: no persona picker, ever.
 *
 * By construction this only ever renders on an INVITED device (a phone that
 * opened the connect link) -- boot() auto-seeds Jakob's own laptop straight
 * to `home` the moment it sees geologengasse scenario + no pending link +
 * no existing state, so the laptop never shows a start screen at all. See
 * boot()'s doc comment.
 *
 * "The invited device asks for a NAME, free text, and uses it as their
 * identity" (handover). Reuses `completeConnectLinkIfPending()` completely
 * unmodified for the actual pairing -- this only decides WHAT identity gets
 * created before that runs.
 */
function screenGeoNameEntry(): void {
  const invitedBy = pendingConnectLink?.from.displayName ?? ''
  const nameInput = el('input', {
    type: 'text',
    class: 'field',
    placeholder: t('geoNamePh'),
    autofocus: true,
    style: 'width:100%;border-radius:14px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);padding:12px;font:inherit;margin-bottom:14px',
  }) as HTMLInputElement
  const placeInput = el('input', {
    type: 'text',
    class: 'field',
    placeholder: t('geoPlacePh'),
    style: 'width:100%;border-radius:14px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);padding:12px;font:inherit;margin-bottom:14px',
  }) as HTMLInputElement
  const submit = (): void => { void seedGeoGuest(nameInput.value, placeInput.value, onboardingMode) }
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  placeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  const body = el('div', {}, [
    el('h1', {}, [t('geoNameTitle')]),
    el('div', { class: 'card' }, [
      el('h3', {}, [t('invitedBy') + ' ' + invitedBy]),
      el('p', {}, [t('geoInvitedNote')]),
    ]),
    nameInput,
    placeInput,
    el('p', { class: 'note' }, [t('geoNameOptional')]),
    // Chosen on THIS device, by the guest, not inherited from Jakob who
    // invited her (handover: that would be exactly the coercion this
    // feature exists to prevent). Inline on the same screen so accepting
    // the invitation costs no extra tap beyond what "Anfrage senden"
    // already was -- see onboardingMode's own doc comment.
    el('h2', {}, [t('modePickerLead')]),
    renderModePicker(onboardingMode, (m) => { onboardingMode = m }, 'wot-mode-geo'),
    el('p', { class: 'note' }, [t('modePickerNote')]),
    el('button', { class: 'btn primary', onclick: submit }, [t('geoNameSend')]),
  ])
  clear(root)
  root.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'who' }, [t('appName')]),
      el('button', { class: 'langtoggle', onclick: () => { toggleLang(); render() } }, [
        getLang() === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
        document.createTextNode(' / '),
        getLang() === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
      ]),
    ]),
    el('main', {}, [body]),
  )
}

function screenStart(): void {
  if (wotScenario() === 'geologengasse') { screenGeoNameEntry(); return }
  if (wotScenario() === 'secondHop') { screenSecondHopNameEntry(); return }
  const lang = getLang()
  // A device that arrived by connect link lands HERE first, not on a
  // connection. Without this line it reads as a plain start screen and the
  // person has no idea a pairing is waiting on the other side of the choice.
  const invitedBy = pendingConnectLink?.from.displayName
  const body = el('div', {}, [
    el('h1', {}, [t('whoAreYou')]),
    invitedBy
      ? el('div', { class: 'card' }, [
          el('h3', {}, [t('invitedBy') + ' ' + invitedBy]),
          el('p', {}, [t('invitedByNote')]),
        ])
      : null,
    el('p', { class: 'lead' }, [t('pickPersona')]),
    ...PERSONAS.map((p) =>
      el('div', { class: 'card' }, [
        el('h3', {}, [p.displayName]),
        el('p', {}, [p.blurb[lang]]),
        el('button', {
          class: 'btn primary',
          onclick: () => void seedPersona(p.id, p.displayName, p.role, onboardingMode),
        }, [t('continueAs') + ' ' + p.displayName]),
      ]),
    ),
    // Inline on the same screen, same reasoning as screenGeoNameEntry's own
    // picker: "Weiter als Marlene" reads onboardingMode at the moment it is
    // clicked, so choosing a mode (or leaving Standard preselected, I9)
    // costs no extra tap and no extra screen.
    el('h2', {}, [t('modePickerLead')]),
    renderModePicker(onboardingMode, (m) => { onboardingMode = m }, 'wot-mode-start'),
  ])
  clear(root)
  root.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'who' }, [t('appName')]),
      el('button', { class: 'langtoggle', onclick: () => { toggleLang(); render() } }, [
        getLang() === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
        document.createTextNode(' / '),
        getLang() === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
      ]),
    ]),
    el('main', {}, [body]),
  )
}

async function seedPersona(id: string, displayName: string, role: 'holder' | 'seeker', mode: Mode): Promise<void> {
  const persona = PERSONAS.find((p) => p.id === id)
  const threads: ChatThread[] = []
  if (role === 'holder') {
    // The holder carries the neighbourhood group, and one direct chat that is
    // excluded by default so the opt-out is visible rather than asserted.
    //
    // Sicher (handover): "inventory not in scope until you put something in
    // it deliberately". A seeded demo group is fixture content she did not
    // just sit down and type, same reasoning the inventorySeed override
    // below applies -- so it starts OFF for a Sicher pick, not on. Standard
    // and Pro keep the app's own existing default (a group starts visible;
    // see types.ts's ChatThread.included doc comment for why that default
    // is deliberately the opposite of a 1-on-1 thread's).
    const group = detectAndParse('Otta Graetzl & Alltag.txt', seedGroupRaw)
    group.title = 'Otta Grätzl & Alltag'
    group.included = mode !== 'sicher'
    threads.push(group)
    const direct = detectAndParse('Klaus.txt', SEED_DIRECT_IOS)
    direct.title = 'Klaus'
    direct.included = false
    threads.push(direct)
  }
  // The connection is PRE-SEEDED on purpose.
  //
  // The QR ceremony is worth showing, but it is theatre: the query is the
  // product. If a camera misbehaves in the room, the demo must still reach the
  // part that matters. Both devices seed the same fixed nonce pair, so both
  // derive the same key with or without the ceremony, and re-running the
  // ceremony for real simply overwrites these with fresh nonces.
  //
  // `seeded: true` is what keeps this convenience from becoming a lie. Every
  // screen that mentions the pairing reads this flag and says "vorgekoppelt
  // für diese Demo" instead of "verbunden mit". An app whose whole pitch is
  // that you can trust what it tells you cannot open by telling you something
  // that is not so.
  const other = PERSONAS.find((p) => p.id !== id)
  const peers = other
    ? [{
        id: other.id,
        displayName: other.displayName,
        nonceSelf: DEMO_NONCE[id] ?? randomId(16),
        noncePeer: DEMO_NONCE[other.id] ?? randomId(16),
        connectedAt: Date.now(),
        blocked: false,
        seeded: true,
      }]
    : []
  // Deep-copy the persona's seed profile/inventory rather than referencing
  // PERSONAS directly: PERSONAS is a module-level constant, shared across
  // every seedPersona() call (including a demo reset), and inventory rows
  // get their own id/createdAt fresh each time rather than reusing the
  // template's.
  const profile = persona ? { ...persona.profile, languages: [...persona.profile.languages] } : { displayName, bio: '', neighbourhood: '', languages: [] }
  // Same Sicher reasoning as the group thread above: a seeded inventory
  // entry is fixture content, not something she just typed in herself, so
  // it starts OFF for Sicher. addInventoryItem() (state.ts) -- what runs
  // when she types a NEW entry in later, on any mode -- is deliberately
  // untouched by this: that one really is typed in on purpose, just now.
  const inventory = (persona?.inventorySeed ?? []).map((seed) => ({
    ...seed,
    id: randomId(8),
    createdAt: new Date().toISOString(),
    included: mode === 'sicher' ? false : seed.included,
  }))
  state = { me: { id, displayName }, threads, peers, profile, inventory, queryLog: [] }
  applyModePosture(state, mode)
  await saveState(state)
  // The ordinary first-visit case for the one-scan connect-link ceremony
  // (connect_link.ts): a brand-new phone was still on the persona picker
  // when it opened the link (no state existed yet for boot() to find it),
  // so this is the first point a persona -- and therefore a relay identity
  // and a peer list -- exists to attach the pairing to. Completing it here
  // instead of after `go('home')` avoids a home-screen flash before jumping
  // straight to 'connect'.
  if (pendingConnectLink) {
    await completeConnectLinkIfPending()
  } else {
    void initRelaySession()
    go('home')
  }
}

/** Fixed demo nonces so both devices start out already paired. See seedPersona. */
const DEMO_NONCE: Record<string, string> = {
  marlene0: 'demo-nonce-marlene-2026',
  nora0000: 'demo-nonce-nora-2026',
}

// ---------------------------------------------------------------------------
// demo 20: Jakob's own device, and an invited guest's device. Two separate
// seed functions instead of PERSONAS -- see PERSONAS' own doc comment ("the
// two demo personas") for why that list is deliberately not reused here:
// this scenario is the owner's real flat, not a fictional persona, and the
// invited side's identity is typed in by a real person, not picked from a
// list.
// ---------------------------------------------------------------------------

/**
 * Jakob's own laptop. No pre-seeded peer -- unlike seedPersona()'s two
 * personas, which pair with each other before any ceremony runs, Jakob
 * starts with `peers: []`. Every peer he ever has came from a real connect
 * link and a real tap on "Anfrage bestätigen" (acceptPendingRequest()) --
 * there is no fictional counterpart to fake a pairing with. Called from
 * boot() the moment a fresh visit has geologengasse scenario, no state yet,
 * and no pending connect link -- i.e. this IS the laptop opening the demo
 * for the first time, not a phone that just scanned a link (that case is
 * seedGeoGuest() below).
 *
 * Deliberately does NOT itself call `initRelaySession()`. It used to
 * (`void initRelaySession()` at the end, fire-and-forget) -- but `boot()`
 * ALSO calls `initRelaySession()` unconditionally right after `await
 * seedJakob()` returns (its trailing `if (state && pendingConnectLink) {…}
 * else { void initRelaySession() }`, and `pendingConnectLink` is always null
 * whenever `seedJakob()` runs at all -- see boot()'s own guard). Firing it
 * from both places raced two concurrent `bringUpRelayChannel()` calls on
 * the SAME boot, which is what actually caused the "second guest" relay bug
 * (root-caused 2026-09-04 -- see `relayChannelReady`'s doc comment for the
 * full mechanism). `bringUpRelayChannel()` is now single-flight regardless,
 * so a second call here would be harmless, not merely redundant -- but
 * calling `initRelaySession()` from two places for the one boot event this
 * function exists to handle was always the wrong shape, so it is removed at
 * the source rather than left as a now-inert duplicate.
 *
 * `mode`: as of the three-modes feature, Jakob picks his own mode too, on
 * screenModePick, BEFORE this runs -- boot() no longer calls this directly;
 * see pendingJakobSeedKind's own doc comment. He starts with no threads and
 * no inventory here, so a mode choice has nothing to apply a seed-time
 * default to yet; it still governs everything he does from `home` onward
 * (screenAsk's free-text card, incoming free-text asks, and -- once he has
 * a real trust edge to a second-brain-holding peer, not this scenario --
 * whether a second hop is offered).
 */
async function seedJakob(mode: Mode): Promise<void> {
  state = {
    me: { id: 'jakob', displayName: 'Jakob' },
    threads: [],
    peers: [],
    profile: { displayName: 'Jakob', bio: '', neighbourhood: 'Wien', languages: ['Deutsch'] },
    inventory: [],
    queryLog: [],
  }
  applyModePosture(state, mode)
  await saveState(state)
}

/**
 * An invited phone, after it types in a free-text name (screenGeoNameEntry
 * above) and taps "Anfrage senden". Also starts with `peers: []` --
 * `completeConnectLinkIfPending()` (unmodified, reused exactly) adds Jakob
 * as this device's own peer once the connect-ack is sent, which is a
 * separate step from Jakob accepting THIS device on his side (see
 * acceptPendingRequest()'s doc comment on why that asymmetry is correct:
 * the guest already knows who they are requesting to connect to; Jakob is
 * the one who has to decide whether to let them in).
 */
/**
 * What to call a connection nobody named.
 *
 * The name is optional on purpose: someone scanning a stranger's code at an
 * event may not want to type a name, and forcing one is both a friction and a
 * small coercion. So an unnamed connection is labelled by WHEN it was made,
 * and by WHERE only if the person typed a place themselves.
 *
 * No geolocation. Turning coordinates into a place name means asking a third
 * party where this person is, which is precisely the thing this app tells
 * people it does not do. A free-text "beim Konzert" is more useful anyway,
 * and it stays on the device.
 */
function unnamedConnectionLabel(place: string): string {
  const when = new Date().toLocaleString(getLang() === 'de' ? 'de-AT' : 'en-GB',
    { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
  return place ? `${t('geoMetAt')} ${place}, ${when}` : `${t('geoMetOn')} ${when}`
}

async function seedGeoGuest(rawName: string, rawPlace = '', mode: Mode): Promise<void> {
  const place = rawPlace.trim().slice(0, 40)
  const displayName = rawName.trim().slice(0, 60) || unnamedConnectionLabel(place)
  state = {
    me: { id: randomId(8), displayName },
    threads: [],
    peers: [],
    profile: { displayName, bio: '', neighbourhood: '', languages: [] },
    inventory: [],
    queryLog: [],
  }
  applyModePosture(state, mode)
  await saveState(state)
  if (pendingConnectLink) {
    await completeConnectLinkIfPending()
  } else {
    // Should not happen -- screenGeoNameEntry only renders when a connect
    // link is pending -- but a demo must never hang on an impossible state.
    void initRelaySession()
    go('home')
  }
}

// ---------------------------------------------------------------------------
// demo 21: Jakob's laptop (the root, same device demo 20 shows -- but this
// is a SEPARATE scenario build, see mode.ts's doc comment: it does not
// affect and is not affected by wotScenario() === 'geologengasse'), and the
// two invited devices, A and B, that complete the three-device chain the
// handover asks for. See DEVLOG/handover-demo21-two-hop.md and
// data/second_hop.ts for the story these seed.
// ---------------------------------------------------------------------------

/**
 * Jakob's own laptop. Mirrors seedJakob() exactly -- no pre-seeded peer,
 * every peer comes from a real connect link -- except for one inventory
 * entry, so his own device answers a relayed question through the SAME
 * threadsInScope()/matchTemplate() path every other demo already uses. No
 * special-casing on his side at all: from his device's point of view, a
 * question that arrived via A's relay looks exactly like a question A asked
 * directly (see main.ts's `forwardToOwner`, which composes an ordinary
 * QueryEnvelope -- I8's "no hop reveals more than a direct request" made
 * concrete in code, not just in the wire schema).
 */
async function seedSecondHopRoot(mode: Mode): Promise<void> {
  state = {
    me: { id: 'jakob', displayName: 'Jakob' },
    threads: [],
    peers: [],
    profile: { displayName: 'Jakob', bio: '', neighbourhood: 'Wien', languages: ['Deutsch'] },
    inventory: [{
      id: randomId(8),
      text: JAKOB_LADDER_INVENTORY_TEXT,
      createdAt: new Date().toISOString(),
      // Same Sicher reasoning as seedPersona's inventorySeed override: this
      // is fixture content standing in for "Jakob's real ladder", not
      // something he just typed in this session, so a Sicher pick starts it
      // OFF until he deliberately switches it on.
      included: mode !== 'sicher',
    }],
    queryLog: [],
  }
  applyModePosture(state, mode)
  await saveState(state)
  void initRelaySession()
}

/**
 * An invited device, after typing a free-text name (screenSecondHopNameEntry
 * below). WHICH of the two remaining roles it gets -- the first hop (A, who
 * gets the second-brain note) or the second hop (B, who gets none) -- is
 * decided by WHO invited it, never by a separate picker: `pendingConnectLink`
 * still names the exact link this device opened (screenStart() only ever
 * reaches this function while one is pending). `from.id === 'jakob'` means
 * this device scanned JAKOB's OWN link, so it is the first hop; any other
 * inviter means it scanned the FIRST hop's own link (A's, shown from HER
 * screenConnect() exactly the same way Jakob's is -- see that screen's own
 * doc comment on why no new UI was needed there), so it is the second hop.
 * A device that is neither -- unreachable in practice, screenStart() only
 * routes here with a pending link -- gets no note either, the same safe
 * default as B.
 */
async function seedSecondHopGuest(rawName: string, mode: Mode): Promise<void> {
  const displayName = rawName.trim().slice(0, 60) || unnamedConnectionLabel('')
  const isFirstHop = pendingConnectLink?.from.id === 'jakob'
  state = {
    me: { id: randomId(8), displayName },
    threads: [],
    peers: [],
    profile: { displayName, bio: '', neighbourhood: '', languages: [] },
    inventory: [],
    queryLog: [],
    ...(isFirstHop
      ? {
          // Two separate notes -- scenario B (the ladder) and scenario A
          // (the flat, reusing demo 20's own material) -- see
          // data/second_hop.ts's module doc for why these stay two notes
          // rather than one fused sentence.
          secondBrainNotes: [
            {
              id: randomId(8),
              text: A_NOTE_ABOUT_JAKOB_TEXT,
              createdAt: new Date().toISOString(),
              ownerPeerId: 'jakob',
              ownerDisplayName: 'Jakob',
            },
            {
              id: randomId(8),
              text: A_NOTE_ABOUT_JAKOB_FLAT_TEXT,
              createdAt: new Date().toISOString(),
              ownerPeerId: 'jakob',
              ownerDisplayName: 'Jakob',
            },
          ],
        }
      : {}),
  }
  applyModePosture(state, mode)
  await saveState(state)
  if (pendingConnectLink) {
    await completeConnectLinkIfPending()
  } else {
    void initRelaySession()
    go('home')
  }
}

/**
 * Demo 21's own name-entry screen -- deliberately a SEPARATE function from
 * screenGeoNameEntry rather than a shared one branching on scenario. The two
 * scenarios' seed functions build genuinely different DeviceState shapes
 * (one may carry secondBrainNotes, one never queues pending requests), and
 * keeping the entry points apart is what makes it impossible for a future
 * edit to one scenario's ceremony to silently reach the other's -- see
 * mode.ts's own doc comment on why `secondHop` is a third value, not a
 * modifier on `geologengasse`.
 */
function screenSecondHopNameEntry(): void {
  const invitedBy = pendingConnectLink?.from.displayName ?? ''
  const nameInput = el('input', {
    type: 'text',
    class: 'field',
    placeholder: t('geoNamePh'),
    autofocus: true,
    style: 'width:100%;border-radius:14px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);padding:12px;font:inherit;margin-bottom:14px',
  }) as HTMLInputElement
  const submit = (): void => { void seedSecondHopGuest(nameInput.value, onboardingMode) }
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  const body = el('div', {}, [
    el('h1', {}, [t('geoNameTitle')]),
    el('div', { class: 'card' }, [
      el('h3', {}, [t('invitedBy') + ' ' + invitedBy]),
      el('p', {}, [t('secondHopInvitedNote')]),
    ]),
    nameInput,
    el('p', { class: 'note' }, [t('geoNameOptional')]),
    el('h2', {}, [t('modePickerLead')]),
    renderModePicker(onboardingMode, (m) => { onboardingMode = m }, 'wot-mode-secondhop'),
    el('p', { class: 'note' }, [t('modePickerNote')]),
    el('button', { class: 'btn primary', onclick: submit }, [t('geoNameSend')]),
  ])
  clear(root)
  root.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'who' }, [t('appName')]),
      el('button', { class: 'langtoggle', onclick: () => { toggleLang(); render() } }, [
        getLang() === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
        document.createTextNode(' / '),
        getLang() === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
      ]),
    ]),
    el('main', {}, [body]),
  )
}

/**
 * Demo 20/21 only (mode.ts's geologengasse/secondHop scenarios): Jakob's own
 * laptop, the one device in this app that used to auto-seed straight to
 * `home` with no screen in between at all (boot() below). He picks his mode
 * here, exactly as a guest picks hers on the name-entry screens above --
 * see pendingJakobSeedKind's own doc comment for why the actual seed call is
 * deferred until now. Only ever renders on a fresh device (no state on
 * disk) or right after "Demo zurücksetzen"; a returning session's `state`
 * already exists, so boot() sends it straight to `home` as before and this
 * screen never appears.
 */
function screenModePick(): void {
  const submit = (): void => { void finishJakobOnboarding(onboardingMode) }
  const body = el('div', {}, [
    el('h1', {}, [t('modePickerLead')]),
    renderModePicker(onboardingMode, (m) => { onboardingMode = m }, 'wot-mode-jakob'),
    el('p', { class: 'note' }, [t('modePickerNote')]),
    el('button', { class: 'btn primary', onclick: submit }, [t('modePickerContinue')]),
  ])
  clear(root)
  root.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'who' }, [t('appName')]),
      el('button', { class: 'langtoggle', onclick: () => { toggleLang(); render() } }, [
        getLang() === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
        document.createTextNode(' / '),
        getLang() === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
      ]),
    ]),
    el('main', {}, [body]),
  )
}

/** Runs the seed function boot() deferred, now that Jakob has actually
 *  picked a mode -- see pendingJakobSeedKind's own doc comment. Mirrors
 *  boot()'s own former sequence exactly (seed, then bring up the relay,
 *  then go home) so demo 20/21's post-boot behaviour is unchanged, only its
 *  timing relative to this one extra screen. */
async function finishJakobOnboarding(mode: Mode): Promise<void> {
  const kind = pendingJakobSeedKind
  pendingJakobSeedKind = null
  if (kind === 'geo') await seedJakob(mode)
  else if (kind === 'secondHop') await seedSecondHopRoot(mode)
  // seedSecondHopRoot() already brings its own relay channel up; seedJakob()
  // deliberately does not (see that function's own doc comment on the past
  // double-init bug). bringUpRelayChannel() is single-flight regardless, so
  // calling this unconditionally here is harmless for both, and is what
  // boot() itself used to guarantee before this screen existed.
  void initRelaySession()
  go('home')
}

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------

/**
 * The one sentence every screen uses to describe the pairing.
 *
 * Three states, three different sentences, and they must not blur into each
 * other: no peer at all, a seeded peer (the demo put it there), and a peer two
 * people actually created by holding phones up to each other. Centralised so a
 * new screen cannot accidentally reintroduce the claim we just removed.
 */
function peerStatusLine(peer: Peer | undefined): string {
  if (!peer) return t('noConnection')
  if (peer.seeded) return t('seededWith') + ' ' + peer.displayName
  return t('connectedWith') + ' ' + peer.displayName
}

/**
 * One pending request card: name, and its own separate "Anfrage
 * bestätigen"/"Ablehnen" pair. Rendered once per entry in
 * `pendingAcceptRequests` -- several people can be waiting at once (the one
 * excited relative, then her friends), and each is confirmed on its own,
 * never in bulk.
 */
function pendingRequestCard(req: { did: string; from: Identity }): HTMLElement {
  return el('div', { class: 'card' }, [
    el('h3', {}, [t('geoPendingTitle')]),
    el('p', {}, [
      el('b', {}, [req.from.displayName]),
      document.createTextNode(' ' + t('geoPendingBody')),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn', onclick: () => declinePendingRequest(req.did) }, [t('geoDeclineBtn')]),
      el('button', { class: 'btn primary', onclick: () => void acceptPendingRequest(req.did) }, [t('geoAcceptBtn')]),
    ]),
  ])
}

function screenHome(): void {
  const s = state as DeviceState
  const peer = s.peers[0]
  const geo = wotScenario() === 'geologengasse'
  const body = el('div', {}, [
    el('h1', {}, [t('appName')]),
    // Visible "without hunting for it" (handover's own requirement), one
    // tap from wherever it can actually be changed. Same modeTitleKey()
    // helper screens/profile.ts uses for its own heading, so the two never
    // drift apart.
    el('button', {
      class: 'btn quiet',
      style: 'text-align:left',
      onclick: () => go('profile'),
    }, [t('modeCurrentLabel') + ': ' + t(modeTitleKey(deviceMode(s)))]),
    ...(geo ? pendingAcceptRequests.map(pendingRequestCard) : []),
    geo
      ? el('div', { class: 'card' }, [
          el('h3', {}, [t('geoGraphNav')]),
          el('p', {}, [
            s.peers.length
              ? `${s.peers.length} ${s.peers.length === 1 ? t('geoNetworkCountOne') : t('geoNetworkCount')}`
              : t('noConnection'),
          ]),
          el('div', { class: 'btnrow' }, [
            el('button', { class: 'btn', onclick: () => go('connect') }, [t('navConnect')]),
            el('button', { class: 'btn primary', onclick: () => go('graph') }, [t('geoGraphNav')]),
          ]),
        ])
      : el('div', { class: 'card' }, [
          el('h3', {}, [t('navConnect')]),
          el('p', {}, [peerStatusLine(peer)]),
          peer?.seeded ? el('p', { class: 'seeded' }, [t('seededNote')]) : null,
          el('button', { class: 'btn', onclick: () => go('connect') }, [t('navConnect')]),
        ]),
    // Demo 21 (secondHop) only, and only on the ONE device where either
    // setting means anything: A's own, the sole holder of a second-brain
    // note in this cast. TWO INDEPENDENT switches (DECISIONS.md D28/D30),
    // held by two different roles this device plays -- see state.ts's own
    // doc comment for the full reasoning on why the defaults point in
    // opposite directions. Both persisted immediately on toggle, read
    // fresh by createRelayDispatch the next time a query actually arrives.
    wotScenario() === 'secondHop' && s.secondBrainNotes?.length
      ? el('div', { class: 'card' }, [
          el('label', { class: 'row', style: 'display:flex;align-items:center;gap:10px' }, [
            el('input', {
              type: 'checkbox',
              ...(s.secondHopUniformModeDirect ? { checked: true } : {}),
              onchange: (e: Event) => {
                s.secondHopUniformModeDirect = (e.currentTarget as HTMLInputElement).checked
                void saveState(s)
              },
            }),
            el('span', {}, [t('secondHopUniformModeDirectLabel')]),
          ]),
          el('p', { class: 'note' }, [t('secondHopUniformModeDirectHelp')]),
          el('label', { class: 'row', style: 'display:flex;align-items:center;gap:10px;margin-top:10px' }, [
            el('input', {
              type: 'checkbox',
              ...(s.secondHopRevealRelay ? { checked: true } : {}),
              onchange: (e: Event) => {
                s.secondHopRevealRelay = (e.currentTarget as HTMLInputElement).checked
                void saveState(s)
              },
            }),
            el('span', {}, [t('secondHopRevealRelayLabel')]),
          ]),
          el('p', { class: 'note' }, [t('secondHopRevealRelayHelp')]),
        ])
      : null,
    el('button', { class: 'btn primary', onclick: () => go('ask') }, [t('navAsk')]),
    el('button', { class: 'btn', onclick: () => go('answer') }, [t('navAnswer')]),
    // Only in the modes that actually hold a connection. In qr mode there is
    // nothing to test and nothing to type into.
    // Straight into the conversation. The fastest way to believe a connection
    // is real is to type a word on one device and see it on the other, so this
    // is one tap from the first screen, not buried.
    wotMode() !== 'qr' && peer
      ? el('button', { class: 'btn primary', onclick: () => go('link') }, [
          t('navChatNow') + (unreadChat ? ` (${unreadChat})` : ''),
        ])
      : null,
    el('button', { class: 'btn quiet', onclick: () => go('chats') }, [
      t('navChats') + ' (' + s.threads.length + ')',
    ]),
    el('button', { class: 'btn quiet', onclick: () => go('inventory') }, [
      t('navInventory') + ' (' + s.inventory.length + ')',
    ]),
    el('button', { class: 'btn quiet', onclick: () => go('profile') }, [t('navProfile')]),
    el('button', { class: 'btn quiet', onclick: () => go('log') }, [
      t('navLog') + ' (' + s.queryLog.length + ')',
    ]),
    el('div', { class: 'note' }, [
      el('button', {
        class: 'btn danger',
        onclick: () => { if (confirm(t('resetConfirm'))) void resetAll().then(() => location.reload()) },
      }, [t('reset')]),
    ]),
  ])
  shell(t('appName'), body)
}

// ---------------------------------------------------------------------------
// chats: the 1-on-1 opt-out lives here
// ---------------------------------------------------------------------------

function threadRow(th: ChatThread): HTMLElement {
  const s = state as DeviceState
  const box = el('input', { type: 'checkbox', ...(th.included ? { checked: true } : {}) }) as HTMLInputElement
  const stateLabel = el('small', { class: 'state', style: 'margin-left:10px' }, [
    th.included ? t('included') : t('excluded'),
  ])
  box.addEventListener('change', () => {
    th.included = box.checked
    void saveState(s)
    stateLabel.textContent = th.included ? t('included') : t('excluded')
  })
  const humans = th.messages.filter((m) => !m.system).length
  const row = el('div', { class: 'thread' }, [
    el('div', { class: 'meta' }, [
      el('b', {}, [th.title]),
      el('small', {}, [
        humans + ' ' + t('msgCount') + ' · ' + th.participants.length + ' ' + t('people'),
      ]),
      el('div', {}, [
        el('span', { class: 'kind' }, [th.kind === 'group' ? t('kindGroup') : t('kindDirect')]),
        stateLabel,
      ]),
    ]),
    el('label', { class: 'sw' }, [box, el('span', {})]),
  ])
  return row
}

function screenChats(): void {
  const s = state as DeviceState
  const groups = s.threads.filter((x) => x.kind === 'group')
  const directs = s.threads.filter((x) => x.kind === 'direct')

  const fileInput = el('input', {
    type: 'file',
    accept: '.txt,.json,.zip,text/plain,application/json',
    style: 'display:none',
  }) as HTMLInputElement
  fileInput.addEventListener('change', () => { void onImport(fileInput) })

  const body = el('div', {}, [
    el('h1', {}, [t('chatsTitle')]),
    el('p', { class: 'lead' }, [t('chatsLead')]),
    el('h2', {}, [t('groupChats')]),
    ...groups.map(threadRow),
    el('h2', {}, [t('directChats')]),
    el('p', {}, [t('directOff')]),
    ...(directs.length ? directs.map(threadRow) : [el('p', {}, [t('noDirect')])]),
    el('h2', {}, [t('importChat')]),
    el('p', {}, [t('importHow')]),
    fileInput,
    el('button', { class: 'btn', onclick: () => fileInput.click() }, [t('importChat')]),
  ])
  shell(t('navChats'), body, { back: () => go('home') })
}

async function onImport(input: HTMLInputElement): Promise<void> {
  const f = input.files?.[0]
  if (!f) return
  const s = state as DeviceState
  try {
    const raw = await f.text()
    const th = detectAndParse(f.name, raw)
    if (!th.messages.length) throw new Error('no messages')
    th.title = f.name.replace(/\.[^.]+$/, '').replace(/^WhatsApp Chat (mit|with) /i, '')
    // Sicher (handover): "inventory not in scope until you put something in
    // it deliberately". A bulk import adds a whole thread's worth of
    // messages at once, none individually curated -- the opposite of typing
    // one inventory line on purpose -- so it starts OFF for a Sicher
    // device, overriding the parser's own group/direct default (see
    // parse/*.ts's own `included = kind !== 'direct'`). Standard and Pro
    // keep that existing default unchanged.
    if (deviceMode(s) === 'sicher') th.included = false
    s.threads.push(th)
    await saveState(s)
  } catch {
    alert(t('importFailed'))
  }
  input.value = ''
  render()
}

// ---------------------------------------------------------------------------
// profile and inventory: thin wrappers, real content lives in src/screens/
// ---------------------------------------------------------------------------

function screenProfile(): void {
  const s = state as DeviceState
  const body = renderProfile(
    s,
    () => void saveState(s),
    () => { void saveState(s); render() /* topbar name may have changed */ },
  )
  shell(t('navProfile'), body, { back: () => go('home') })
}

function screenInventory(): void {
  const s = state as DeviceState
  const body = renderInventory(s, () => void saveState(s), () => go('inventory'))
  shell(t('navInventory'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// Protokoll: the local, never-transmitted query log (I6 Auditability)
// ---------------------------------------------------------------------------

function logOutcomeLabel(o: LocalOutcome): string {
  switch (o) {
    case 'shared': return t('logOutcomeShared')
    case 'declined': return t('logOutcomeDeclined')
    case 'below-k': return t('logOutcomeBelowK')
    case 'no-match': return t('logOutcomeNoMatch')
    case 'blocked': return t('logOutcomeBlocked')
    // Demo 21 (secondHop) only -- see types.ts's LocalOutcome doc comment.
    case 'relayed': return t('logOutcomeRelayed')
    case 'relay-nothing': return t('logOutcomeRelayNothing')
  }
}

/**
 * "Protokoll": every query this device has been asked, newest first, and
 * what this device did about it. Nothing here was ever sent anywhere -- see
 * types.ts's QueryLogEntry doc comment and this feature's report for the
 * full argument that this screen cannot become a side channel. No refresh
 * button and no polling: emitAnswer() re-renders this screen live if it is
 * already open when an entry is appended, same convention as the chat
 * screen's incoming-message handling.
 */
function screenLog(): void {
  const s = state as DeviceState
  const lang = getLang()
  const entries = [...s.queryLog].reverse()
  const fmt = (at: number): string =>
    new Date(at).toLocaleString(lang === 'de' ? 'de-AT' : 'en-GB', {
      day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  const body = el('div', {}, [
    el('h1', {}, [t('navLog')]),
    el('p', { class: 'lead' }, [t('logLead')]),
    entries.length
      ? el('div', {}, entries.map((e) =>
          el('div', { class: 'card' }, [
            el('p', {}, [
              el('b', {}, [e.fromDisplayName]),
              document.createTextNode(' · ' + fmt(e.at)),
            ]),
            el('p', { class: 'quote' }, ['„' + e.text + '“']),
            el('p', { class: 'note' }, [logOutcomeLabel(e.outcome)]),
          ]),
        ))
      : el('p', {}, [t('logEmpty')]),
  ])
  shell(t('navLog'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

function screenConnect(): void {
  const s = state as DeviceState
  const peer = s.peers[0]
  const relay = wotMode() === 'relay'
  const webrtc = wotMode() === 'webrtc' || wotMode() === 'ladder'
  const geo = wotScenario() === 'geologengasse'
  const isJakob = geo && s.me.id === 'jakob'
  // Demo 21's own first hop (A) routinely holds two peers at once (Jakob
  // and B) -- the same "several peers, plain list" display Jakob's own
  // laptop already needed in demo 20, generalised to a second scenario
  // rather than duplicated: see mode.ts's own doc comment on why the two
  // scenarios stay independently gated even where their needs coincide.
  const multiPeerDisplay = isJakob || (wotScenario() === 'secondHop' && s.peers.length > 1)
  const body = el('div', {}, [
    el('h1', {}, [t('connectTitle')]),
    el('p', { class: 'lead' }, [t('connectLead')]),
    relay ? el('p', { class: 'note' }, [t('relayExplain')]) : null,
    relay ? el('div', { class: 'card' }, [mountRelayStatusBadge()]) : null,
    wotMode() === 'ladder' ? el('p', { class: 'note' }, [t('ladderExplain')]) : null,
    // Demo 20, Jakob's side: every pending request, each confirmed
    // separately -- see pendingRequestCard()'s doc comment.
    ...(isJakob ? pendingAcceptRequests.map(pendingRequestCard) : []),
    // Several peers at once: a plain list, not the single-peer card below.
    // Every other case (every other demo, a demo-20 GUEST device, and a
    // demo-21 device that has only paired one hop so far) keeps the
    // original single-peer card unchanged.
    multiPeerDisplay
      ? el('div', { class: 'card' }, [
          el('h3', {}, [t('geoGraphNav')]),
          s.peers.length
            ? el('ul', {}, s.peers.map((p) => el('li', {}, [p.displayName])))
            : el('p', {}, [t('noConnection')]),
        ])
      : peer ? el('div', { class: 'card' }, [
          el('h3', {}, [peerStatusLine(peer)]),
          peer.seeded
            ? el('p', { class: 'seeded' }, [t('seededNote')])
            : el('p', {}, [new Date(peer.connectedAt).toLocaleString(getLang() === 'de' ? 'de-AT' : 'en-GB')]),
          // Demo 20, guest side: there is no signal telling this device
          // whether Jakob has tapped "Anfrage bestätigen" yet -- say that
          // honestly rather than implying a live connection already exists.
          geo ? el('p', { class: 'note' }, [t('geoRequestSentTitle') + ': ' + t('geoRequestSentBody')]) : null,
        ]) : null,
    // The one-scan connect link (connect_link.ts): relay mode only, and the
    // PRIMARY affordance there -- it is the whole reason this feature exists
    // (a phone whose camera can only open a link, GrapheneOS, cannot use the
    // JSON codes below at all). The two-scan codes stay available underneath
    // for every other mode and as a fallback.
    relay ? el('button', { class: 'btn primary', onclick: () => void showConnectLinkCode() }, [t('showConnectLink')]) : null,
    relay ? el('p', { class: 'note' }, [t('connectLinkExplain')]) : null,
    // The honest chaining limit (docs/query-traversal.md): whoever joins
    // through this same link can query the device that showed it to them,
    // never anyone further up the chain. Shown wherever the link itself is
    // shown, not buried in a separate screen nobody visits.
    geo && relay ? el('p', { class: 'note' }, [t('geoChainHonesty')]) : null,
    // Demo 21's own honest chaining statement -- see i18n.ts's
    // secondHopChainHonesty doc comment for why this says the OPPOSITE of
    // geoChainHonesty on purpose. geoChainHonesty above is untouched.
    wotScenario() === 'secondHop' && relay ? el('p', { class: 'note' }, [t('secondHopChainHonesty')]) : null,
    // The two ceremonies are different things and used to sit as adjacent
    // buttons, which cost a real session: the owner pressed "Meinen Code
    // zeigen" expecting the direct connection, got the relay pairing, and
    // reported "I didn't see any device to connect with". They are now in
    // separate labelled cards, and the direct one spells out its three steps,
    // because there is no device discovery here by design and nobody can be
    // expected to infer that from a button.
    el('div', { class: 'card' }, [
      el('h3', {}, [t('connectPairTitle')]),
      el('p', { class: 'note' }, [t('connectPairExplain')]),
      el('button', { class: relay ? 'btn' : 'btn primary', onclick: () => void showMyConnectCode() }, [t('showMyCode')]),
      el('button', { class: 'btn', onclick: () => void scanConnectCode() }, [t('scanTheirCode')]),
    ]),
    wotMode() !== 'qr' && peer
      ? el('button', { class: 'btn primary', onclick: () => go('link') }, [t('navChatNow')])
      : null,
    webrtc && peer ? el('div', { class: 'card' }, [
      el('h3', {}, [t('webrtcCardTitle')]),
      el('p', { class: 'note' }, [t('webrtcExplain')]),
      el('p', { class: 'note' }, [t('webrtcSteps')]),
      mountWebrtcStatusBadge(),
      el('button', { class: 'btn primary', onclick: () => void startWebrtcOffer() }, [t('webrtcOfferBtn')]),
      el('button', { class: 'btn', onclick: () => void startWebrtcAccept() }, [t('webrtcAcceptBtn')]),
    ]) : null,
  ])
  shell(t('navConnect'), body, { back: () => go('home') })
}

function myNonce(): string {
  const s = state as DeviceState
  const existing = s.peers[0]?.nonceSelf
  return existing ?? randomId(16)
}

/**
 * True for any build that might ever route an ask/answer over the relay --
 * either as its primary transport (relay mode, demo 2) or as a fallback a
 * human or the ladder can reach for (webrtc mode's "über den Server
 * versuchen", ladder mode's automatic rung 3). Webrtc mode's own claim is
 * "no server in the path" for the connection itself, but that fallback only
 * works at all if both sides already know each other's did:peer:2 -- which
 * has to travel on the ONE ceremony that happens before anything else can
 * fail, the connect QR. Minting the identity is a local, offline operation
 * (did:peer:2 is self-certifying, see did.ts); nothing here contacts a
 * server, on any mode.
 */
function needsRelayIdentity(): boolean {
  const m = wotMode()
  return m === 'relay' || m === 'webrtc' || m === 'ladder'
}

async function showMyConnectCode(): Promise<void> {
  const s = state as DeviceState
  const nonce = myNonce()
  // OPTIONAL (wire.ts's ConnectEnvelope.did doc comment): carries this
  // device's did:peer:2 so the other side can address it over the relay --
  // as demo 2's primary transport, or as demo 3/6's fallback. Absent
  // entirely in a qr-mode build -- the object literal below has no `did`
  // key at all in that case, so encodeForQr() produces byte-identical
  // output to demo 1's.
  const did = needsRelayIdentity() ? (await ensureRelayIdentity(s)).did : undefined
  const payload = encodeForQr({ v: 1, t: 'connect', from: s.me, nonce, ...(did ? { did } : {}) })
  // Showing a code proves nothing on its own: something still has to come
  // back. Reported from the room as "we have essentially only proven a QR code
  // scanning". So the showing device carries the other half of the ceremony on
  // the same screen -- one tap to the scan view, which has both a camera and a
  // paste box -- instead of leaving the person on a dead end with a picture.
  await showCodeScreen(t('showMyCode'), payload, t('connectLead'), () => go('connect'), {
    label: t('scanTheirCode'),
    action: () => void scanConnectCode(),
  }, t('showMyCodeFootnote'))
  // Remember our own nonce so a later scan can complete the pair.
  const p = s.peers[0]
  if (p) { p.nonceSelf = nonce; await saveState(s) }
  else { pendingSelfNonce = nonce }
}

/**
 * The laptop's half of the one-scan connect-link ceremony (connect_link.ts):
 * shows a QR encoding a URL (not JSON, unlike `showMyConnectCode` above) so
 * a phone's native camera app -- the ONLY option on GrapheneOS, this
 * feature's whole reason for existing -- can open it directly. Reuses
 * `showCodeScreen` exactly as `showMyConnectCode` does, since it already
 * renders whatever payload string it is given as a QR plus a copy button;
 * the only difference is what that payload IS.
 *
 * Deliberately does NOT call `go()` -- `screen` stays `'connect'` the whole
 * time this is on screen, matching `showMyConnectCode`'s own convention.
 * That is what makes the live update work with no extra plumbing:
 * `handleRawWire`'s `if (screen === 'connect') render()`, once the phone's
 * `connect-ack` arrives, redraws `screenConnect()` in place -- which now
 * shows "Verbunden mit …" (`peerStatusLine`, state.ts) instead of the QR --
 * satisfying the handover's explicit complaint about screens that change
 * nothing after a successful action.
 */
async function showConnectLinkCode(): Promise<void> {
  const s = state as DeviceState
  const identity = await ensureRelayIdentity(s)
  // Deliberately origin + directory path, not a bare `location.origin` --
  // mirrors `apps/mobile-ui/src/screens/meet.js`'s `appBaseUrl` exactly (see
  // that file's comment): this app may be served under a path prefix
  // (`WOT_BASE`, mode.ts), and a bare origin would silently land the phone
  // back at the domain root instead of this build.
  const origin = window.location.origin + window.location.pathname.replace(/[^/]*$/, '')
  const url = buildConnectLinkUrl(origin, identity.did, s.me)
  const footnote = t('connectLinkHonesty')
    + (storageIsEphemeral() ? ' ' + t('connectLinkEphemeralNote') : '')
    // The chaining limit, right on the screen someone hands to a third
    // person: whoever pairs through THIS link can query THIS device, never
    // any further up the chain -- docs/query-traversal.md, and the
    // handover's own "getting this wrong would be the worst possible
    // failure in front of this audience".
    + (wotScenario() === 'geologengasse' ? ' ' + t('geoChainHonesty') : '')
  await showCodeScreen(t('showConnectLink'), url, t('connectLinkHint'), () => go('connect'), undefined, footnote)
}

let pendingSelfNonce: string | null = null

async function scanConnectCode(): Promise<void> {
  await scanScreen(t('scanTheirCode'), async (text) => {
    const env = decodeFromQr(text)
    if (!env) return { ok: false, msg: t('badCode') }
    if (env.t !== 'connect') return { ok: false, msg: t('wrongCode') }
    const s = state as DeviceState
    const self = pendingSelfNonce ?? s.peers[0]?.nonceSelf ?? randomId(16)
    pendingSelfNonce = self
    // A completed ceremony is the ONLY thing that clears `seeded`: two people
    // exchanged codes in a room, so the app has finally earned the sentence
    // "verbunden mit".
    upsertPeer(s, {
      id: env.from.id,
      displayName: env.from.displayName,
      nonceSelf: self,
      noncePeer: env.nonce,
      connectedAt: Date.now(),
      blocked: false,
      seeded: false,
      did: env.did,
    })
    await saveState(s)
    // The pair key just changed (real nonces replace the seeded/placeholder
    // ones), and relay.ts's onEnvelope keeps only one registration -- a
    // stale key here means every inbound wire silently fails to decrypt and
    // is never acked. No-op in qr mode (no channel exists).
    await registerRelaySink()
    scanSucceeded(env.from.displayName)
    return { ok: true }
  }, () => go('connect'))
}

/**
 * Say, out loud, that the scan worked.
 *
 * Before this screen existed the camera view simply closed on a successful
 * scan and the app returned to a list. From the person holding the phone that
 * is indistinguishable from a crash, and it is what actually happened in
 * testing: "I scanned the code but I didn't see any confirmation."
 *
 * It also answers the question the other device cannot: in this mode nothing
 * travels over a network, so the phone showing the code has no way to learn
 * that it was read. The only way both sides end up sure is for the scan to go
 * both ways, so the primary action here is to show your own code back.
 */
function scanSucceeded(peerName: string): void {
  const body = el('div', {}, [
    el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['✓']),
      el('b', {}, [t('scanOkTitle')]),
      el('span', {}, [t('scanOkWith') + ' ' + peerName]),
    ]),
    el('p', {}, [t('scanOkNext')]),
    el('button', { class: 'btn primary', onclick: () => void showMyConnectCode() }, [t('showMyCode')]),
    wotMode() !== 'qr'
      ? el('button', { class: 'btn', onclick: () => go('link') }, [t('navChatNow')])
      : null,
    el('button', { class: 'btn quiet', onclick: () => go('home') }, [t('back')]),
  ])
  shell(t('navConnect'), body, { back: () => go('home') })
}

/**
 * Both sides must derive the same key. Two derivations, picked by
 * `p.pairing` (state.ts's doc comment on that field has the full
 * reasoning):
 *  - `'ecdh'` (the one-scan connect-link ceremony, connect_link.ts): X25519
 *    ECDH between this device's own relay identity and the peer's `did` --
 *    `nonceSelf`/`noncePeer` are unused placeholders for this peer.
 *  - absent/`'nonce'` (the original two-scan ceremony): HKDF over both
 *    nonces, canonically sorted since nonce order is not positional.
 */
async function pairKey(p: Peer): Promise<CryptoKey> {
  if (p.pairing === 'ecdh' && p.did && state) {
    const identity = await ensureRelayIdentity(state)
    return deriveEcdhPairKey(ecdhSharedSecret(identity, p.did))
  }
  const [a, b] = [p.nonceSelf, p.noncePeer].sort()
  return derivePairKey(a, b)
}

/**
 * `answer_key.ts`'s `answerKeyFor` with this module's own `pairKey` bound
 * in. The whole rule -- no answer is ever sealed under a key derivable from
 * public data, and "no peer" means blocked -- lives THERE, in a module a
 * test can import; this is only the injection point. See that module's doc
 * comment for the defect it closes and for why refusing beats deriving a
 * key from the relay wrap's ephemeral material.
 */
async function answerKey(peer: Peer | null, qid: string): Promise<{ key: CryptoKey; blocked: boolean }> {
  return answerKeyFor(peer, qid, pairKey)
}

// ---------------------------------------------------------------------------
// webrtc ceremony (demo 3 / demo 6): two QR codes open a data channel, no
// server anywhere in the path. See webrtc.ts's module doc for the exact
// privacy claim and webrtc_sdp.ts for the QR-size feasibility measurement
// this whole approach rests on.
// ---------------------------------------------------------------------------

function getOrCreateWebrtcChannel(): NonNullable<typeof webrtcChannel> {
  if (webrtcChannel) return webrtcChannel
  const channel = createWebrtcChannel()
  channel.onStatus(() => updateWebrtcStatusBadge())
  channel.onEnvelope(handleIncomingEnvelope)
  webrtcChannel = channel
  return channel
}

/** Waits for the channel to reach a terminal state ('open' or 'failed').
 *  webrtc.ts's own CONNECT_TIMEOUT_MS already forces 'failed' eventually, so
 *  this never hangs -- it is purely "turn a status callback into a promise
 *  the ceremony screens can await". */
function waitForWebrtcTerminal(channel: NonNullable<typeof webrtcChannel>): Promise<WebrtcStatus> {
  const current = channel.status()
  if (current === 'open' || current === 'failed') return Promise.resolve(current)
  return new Promise((resolve) => {
    channel.onStatus((s) => {
      updateWebrtcStatusBadge()
      if (s === 'open' || s === 'failed') resolve(s)
    })
  })
}

async function startWebrtcOffer(): Promise<void> {
  const channel = getOrCreateWebrtcChannel()
  const offer = await channel.createOffer()
  const payload = encodeOfferPayload(offer)
  await showCodeScreen(t('webrtcShowOffer'), payload, t('webrtcOfferHint'), () => go('connect'), {
    label: t('webrtcScanAnswer'),
    action: () => void webrtcScanAnswer(channel),
  })
}

async function webrtcScanAnswer(channel: NonNullable<typeof webrtcChannel>): Promise<void> {
  await scanScreen(t('webrtcScanAnswer'), async (text) => {
    const decoded = decodeRtcPayload(text)
    if (!decoded) return { ok: false, msg: t('badCode') }
    if (decoded.kind !== 'rtc-answer') return { ok: false, msg: t('wrongCode') }
    await channel.acceptAnswer(decoded.sdp)
    void webrtcConnectingScreen(channel)
    return { ok: true }
  }, () => go('connect'))
}

async function startWebrtcAccept(): Promise<void> {
  await scanScreen(t('webrtcScanOffer'), async (text) => {
    const decoded = decodeRtcPayload(text)
    if (!decoded) return { ok: false, msg: t('badCode') }
    if (decoded.kind !== 'rtc-offer') return { ok: false, msg: t('wrongCode') }
    const channel = getOrCreateWebrtcChannel()
    const answer = await channel.acceptOffer(decoded.sdp)
    const payload = encodeAnswerPayload(answer)
    // A manual "next" tap, exactly like the offer side's "Antwort scannen" --
    // `showCodeScreen` renders and returns immediately (see showMyConnectCode's
    // identical usage), it does NOT wait for the code to actually be read. An
    // earlier version of this function called webrtcConnectingScreen()
    // straight after `await showCodeScreen(...)`, which replaced the answer
    // QR with the connecting screen before the other device had a chance to
    // scan it -- caught by the two-browser walk in
    // DEVLOG/result-report-webrtc-ladder.md, fixed here.
    await showCodeScreen(t('webrtcShowAnswer'), payload, t('webrtcAnswerHint'), () => go('connect'), {
      label: t('webrtcAnswerDone'),
      action: () => void webrtcConnectingScreen(channel),
    })
    return { ok: true }
  }, () => go('connect'))
}

/**
 * Shown after both descriptions are set, while ICE connectivity checks run.
 * Resolves to success (back to "Verbinden", badge now says "verbunden, kein
 * Server") or failure -- a real message plus the one-tap "über den Server
 * versuchen" escape hatch the handover specifically asks for, never a spinner
 * that just spins forever.
 */
async function webrtcConnectingScreen(channel: NonNullable<typeof webrtcChannel>): Promise<void> {
  const body = el('div', {}, [
    el('h1', {}, [t('webrtcConnecting')]),
    el('div', { class: 'card' }, [
      el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('webrtcConnecting'))]),
      mountWebrtcStatusBadge(),
    ]),
    el('button', { class: 'btn quiet', onclick: () => go('connect') }, [t('back')]),
  ])
  shell(t('webrtcCardTitle'), body, { back: () => go('connect') })

  const result = await waitForWebrtcTerminal(channel)
  if (result === 'open') {
    go('connect')
    return
  }
  screenWebrtcFailed()
}

function screenWebrtcFailed(): void {
  const body = el('div', {}, [
    el('div', { class: 'err' }, [
      el('b', {}, [t('webrtcFailedTitle')]),
      el('p', {}, [t('webrtcFailedBody')]),
    ]),
    el('button', {
      class: 'btn primary',
      onclick: () => { void ensureRelayFallback().then(() => go('connect')) },
    }, [t('webrtcTryServer')]),
    el('button', { class: 'btn quiet', onclick: () => go('connect') }, [t('webrtcBackToConnect')]),
  ])
  shell(t('webrtcCardTitle'), body, { back: () => go('connect') })
}

// ---------------------------------------------------------------------------
// graph (demo 20 only): the bubble view of Jakob's real trust graph.
//
// Plain SVG, no charting library -- the handover's own constraint, and
// legible from a couple of metres because the audience will be looking at
// this over Jakob's shoulder. Modelled on overnight/stub/trust-graph.html's
// concentric-ring layout (a dashed ring per hop, avatars as filled circles
// with initials, "Du" fixed in the centre): this keeps the same visual
// grammar -- ring distance means hop distance -- with a fraction of that
// stub's interactivity, because the query IS the demo, not the graph.
// ---------------------------------------------------------------------------

interface GraphBubble {
  id: string
  label: string
  ring: 1 | 2
  via?: string
  placeholder?: boolean
}

/** Seed nodes (data/geologengasse.ts) PLUS every real, accepted peer --
 *  reads `state.peers` directly rather than a separate list, which is what
 *  makes "the new person appears in the graph, live, without a reload" true
 *  by construction: render() already re-runs screenGraph() on every state
 *  change (acceptPendingRequest() calls it), so a peer accepted a moment
 *  ago is simply already in this array the next time this function runs. */
/**
 * `SEED_GRAPH_NODES` (data/geologengasse.ts) is demo 20's own staged ring-2
 * cast (Alex's friend, the placeholder bubble) -- statically imported, so it
 * is always present in the bundle regardless of scenario (this file's own
 * module doc explains why), but must not visually bleed into a DIFFERENT
 * scenario's cast. Owner's mutual-consent principle (a person who joined
 * through A appears in A's own graph as a matter of course, but never in
 * Jakob's UNLESS both A and that person agree): demo 21 (secondHop) has no
 * mechanism at all yet for showing a second-ring person to anyone but the
 * device that actually holds the live peer edge to them (`live` below,
 * unchanged, is flat ring-1 for every real peer -- B never becomes a peer
 * of Jakob's, structurally, so he never appears here regardless; see
 * forwardToOwner's own doc comment on why the forwarded query never carries
 * B's identity at all), so the default IS satisfied by construction for
 * this scenario already. What this gate closes is a DIFFERENT, narrower
 * problem: without it, a secondHop device navigating here would see demo
 * 20's unrelated Geologengasse neighbours rendered alongside its own real
 * cast. Scoped to `!== 'secondHop'` rather than `=== 'geologengasse'` so
 * every OTHER scenario (1/2/3/6/20 and any future one) keeps today's exact
 * behaviour, byte-identical -- only secondHop's own seed list changes.
 */
function graphBubbles(s: DeviceState): GraphBubble[] {
  // Two independent reasons to withhold a seeded node, and both apply.
  //
  // By SCENARIO: demo 21 (secondHop) seeds no graph at all, because there
  // every device is a real person in a real chain and an invented contact
  // would misrepresent who actually knows whom.
  //
  // By PERSON: in demo 20 the seeded people are JAKOB'S contacts and belong
  // only on Jakob's device. They were being rendered on every device, so a
  // guest who had just paired opened "Mein Netz" and saw Alex and Alex's
  // friend, two people she has never met, belonging to someone else's web.
  // Caught on real devices, and a straight violation of the rule the owner
  // set: nobody sees another person's contacts unless both of them agree.
  // A demo about consent cannot leak a contact list on its own first screen.
  //
  // A guest's graph is therefore exactly her own peers. The placeholder is
  // the one seeded node a guest still gets: it names nobody and is what keeps
  // an otherwise empty graph legible.
  const isOwner = s.me.id === 'jakob'
  const seeded: GraphBubble[] = wotScenario() === 'secondHop'
    ? []
    : SEED_GRAPH_NODES
        .filter((n: GraphNode) => isOwner || n.placeholder)
        .map((n: GraphNode) => ({
          id: n.id,
          label: n.label[getLang()],
          ring: n.ring === 'ring2' ? 2 : 1,
          // A ring-2 node hangs off a ring-1 node. If that parent was filtered
          // out above, the child must not claim a connector to a bubble that
          // is not there, so drop the `via` rather than draw a line to nothing.
          via: isOwner ? n.via : undefined,
          placeholder: n.placeholder,
        }))
  const live: GraphBubble[] = s.peers.map((p) => ({ id: p.id, label: p.displayName, ring: 1 }))
  return [...seeded, ...live]
}

function polarPercent(ring: 1 | 2, index: number, count: number, angleOffsetDeg = 0): { x: number; y: number } {
  const r = ring === 1 ? 32 : 44
  const step = 360 / Math.max(count, 1)
  const angleDeg = index * step + angleOffsetDeg - 90
  const rad = (angleDeg * Math.PI) / 180
  return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) }
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function screenGraph(): void {
  const s = state as DeviceState
  const bubbles = graphBubbles(s)
  const ring1 = bubbles.filter((b) => b.ring === 1)
  const ring2 = bubbles.filter((b) => b.ring === 2)
  const posOf = new Map<string, { x: number; y: number }>()
  ring1.forEach((b, i) => posOf.set(b.id, polarPercent(1, i, ring1.length)))
  ring2.forEach((b, i) => {
    // Anchor near the parent's angle rather than spreading independently --
    // "the distance in the picture should mean something" (handover): a
    // ring-2 node should read as "out past" its ring-1 connector, not as an
    // unrelated point on its own ring.
    const parent = b.via ? posOf.get(b.via) : undefined
    if (parent) {
      const angle = (Math.atan2(parent.y - 50, parent.x - 50) * 180) / Math.PI
      posOf.set(b.id, polarPercent(2, 0, 1, angle + 90))
    } else {
      posOf.set(b.id, polarPercent(2, i, ring2.length))
    }
  })

  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('class', 'geo-graph-svg')

  const ring = (r: number): void => {
    const c = document.createElementNS(svgNS, 'circle')
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(r))
    c.setAttribute('class', 'geo-ring')
    svg.appendChild(c)
  }
  ring(32); ring(44)

  for (const b of bubbles) {
    const pos = posOf.get(b.id)
    if (!pos) continue
    const from = b.via ? posOf.get(b.via) : { x: 50, y: 50 }
    if (!from) continue
    const line = document.createElementNS(svgNS, 'line')
    line.setAttribute('x1', String(from.x)); line.setAttribute('y1', String(from.y))
    line.setAttribute('x2', String(pos.x)); line.setAttribute('y2', String(pos.y))
    line.setAttribute('class', b.placeholder ? 'geo-thread geo-thread-placeholder' : 'geo-thread')
    svg.appendChild(line)
  }

  const nodeLayer = el('div', { class: 'geo-node-layer' })
  for (const b of bubbles) {
    const pos = posOf.get(b.id)
    if (!pos) continue
    nodeLayer.appendChild(el('div', {
      class: 'geo-node' + (b.placeholder ? ' geo-node-placeholder' : ''),
      style: `left:${pos.x}%;top:${pos.y}%`,
    }, [
      el('span', { class: 'geo-avatar' }, [b.placeholder ? '?' : initialsOf(b.label)]),
      el('span', { class: 'geo-name' }, [b.placeholder ? t('geoGraphUnknownNote').split('.')[0] : b.label]),
    ]))
  }

  const frame = el('div', { class: 'geo-graph-frame' }, [
    svg,
    nodeLayer,
    el('div', { class: 'geo-you' }, [
      el('span', { class: 'geo-avatar geo-avatar-you' }, [t('geoGraphYou').slice(0, 2)]),
      el('span', { class: 'geo-name' }, [t('geoGraphYou')]),
    ]),
  ])

  const body = el('div', {}, [
    el('h1', {}, [t('geoGraphTitle')]),
    el('p', { class: 'lead' }, [t('geoGraphLead')]),
    el('div', { class: 'card geo-graph-card' }, [frame]),
    el('p', { class: 'note' }, [t('geoGraphUnknownNote')]),
    ring2.length ? el('p', { class: 'note' }, [t('geoGraphRing2Note')]) : null,
    el('button', { class: 'btn quiet', onclick: () => go('home') }, [t('back')]),
  ])
  shell(t('geoGraphNav'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// ask (person B)
// ---------------------------------------------------------------------------

/** Which query templates a screen offers: demo 20's own single "place to
 *  stay" template, or every other demo's five-template chat catalogue. Kept
 *  as one function used by both screenAsk() and runConsentCeremony()'s
 *  template lookup (via resolveTemplate()) so the two can never drift. */
function templatesForScenario(): QueryTemplate[] {
  const scenario = wotScenario()
  if (scenario === 'geologengasse') return [ACCOMMODATION_TEMPLATE]
  // Demo 21 (secondHop, "scenario A"): the SAME accommodation template demo
  // 20 offers, reused directly (not copied) so a query for it, its
  // matching, and its address-before-consent discipline are all identical
  // code to demo 20's own -- ADDED to the ordinary catalogue rather than
  // replacing it, since secondHop's OTHER story ("scenario B", the ladder)
  // is asked via free text, not a fixed template, and TEMPLATES staying
  // available costs nothing (they simply never match anything seeded here).
  if (scenario === 'secondHop') return [ACCOMMODATION_TEMPLATE, ...TEMPLATES]
  return TEMPLATES
}

/** getTemplate() (data/templates.ts) only knows the five chat templates --
 *  deliberately unchanged, see match/accommodation.ts's module doc on "do
 *  not fork the matcher". This resolves against whichever list the current
 *  scenario actually offers instead. */
function resolveTemplate(id: string): QueryTemplate | undefined {
  return templatesForScenario().find((tpl) => tpl.id === id) ?? getTemplate(id)
}

/**
 * Filler QueryTemplate for a query this device could not resolve into a real
 * question at all (a corrupt/unknown templateId, and no freeText to fall
 * back to -- should not happen from this app's own askWith()/askNetwork(),
 * only from a malformed or stale peer). gate.ts's `decide()` requires a
 * `template: QueryTemplate` to build its always-computed "what would we
 * share" JSON from (see gate.ts's module doc on why that happens
 * unconditionally); this fills that slot with an empty, matchless template so
 * decide() still runs and still produces a byte-identical PASS, rather than
 * emitAnswer() needing a second, template-less code path. Its `matchTerms`
 * is empty, so `matchTemplate` against it always returns zero hits --
 * `handleAmbientQuery` never even calls the matcher in this case (the real
 * MatchResult stays the zero-init default), this exists purely so `decide()`
 * has an `id` to embed in its (never-shared, since aboveThreshold is always
 * false here) payload.
 */
const UNRESOLVED_TEMPLATE: QueryTemplate = {
  id: 'wot.unresolved',
  version: 1,
  category: 'unresolved',
  title: { de: 'Unbekannte Anfrage', en: 'Unknown request' },
  question: { de: 'Unbekannte Anfrage', en: 'Unknown request' },
  matchTerms: [],
  boostTerms: [],
  excludeTerms: [],
  minScore: 1,
  kThreshold: 1,
  sensitivity: 'low',
  ttlSeconds: 0,
}

/**
 * Resolve a QueryEnvelope into the QueryTemplate it should be matched
 * against -- a free-text ask (types.ts's QueryEnvelope.freeText) via
 * freeTextTemplate(), or a fixed template via resolveTemplate(). The ONE
 * place both runConsentCeremony (manual scan) and handleAmbientQuery
 * (relay/webrtc auto-delivery) do this lookup, so a free-text query is
 * matchable from either entry point without duplicating the branch.
 *
 * Sicher (handover-three-modes.md): a free-text ask never resolves on THIS
 * device, regardless of who sent it or which transport carried it -- `q`'s
 * own words are never even matched against anything here, let alone shown.
 * Returning `undefined` (rather than a pre-branch decline in each caller)
 * is deliberate: it means a refused free-text ask folds into the EXACT SAME
 * "unresolvable template" path a corrupt/unknown templateId already takes
 * in both callers -- classifyIncomingQuery's own `templateResolved: false`
 * branch (silent 'no-match' on the ambient path) and
 * runSecondHopRelayCeremony's own `if (!tpl)` branch (resolved 'direct',
 * held to the SAME uniform deadline a Sicher device's direct switch already
 * uses -- see applyModePosture/modeSwitchDefaults, state.ts) -- rather than
 * a new, differently-timed "declined" path. A device asking on Sicher's
 * own behalf never even builds a free-text ask in the first place (see
 * screenAsk's own gate on the SAME `deviceMode(s)`), so this only ever
 * matters for an ask arriving from a peer running Standard or Pro.
 */
function resolveIncomingTemplate(q: QueryEnvelope): QueryTemplate | undefined {
  if (q.freeText) {
    if (state && deviceMode(state) === 'sicher') return undefined
    return freeTextTemplate(q.freeText)
  }
  return resolveTemplate(q.templateId)
}

/**
 * The entry point for a query that arrived AMBIENTLY: over an already-open
 * relay/webrtc channel, with nobody having chosen to scan anything (see
 * handleIncomingEnvelope's `query` branch, the only caller). A manual QR
 * scan (scanQuery(), screenAnswer's "Frage scannen" button -- demo 1's whole
 * flow, and still how demo 2's "scan instead" fallback works) goes straight
 * to runConsentCeremony() unconditionally, on purpose: choosing to scan IS
 * choosing to look, so there is no "silent" version of that path and none is
 * needed -- see incoming_query.ts's module doc comment.
 *
 * Runs the SAME match a manual scan would run, BEFORE deciding whether to
 * interrupt at all -- classifyIncomingQuery() (incoming_query.ts) is the one
 * function that turns a match into "surface" or "silent", used here and
 * nowhere else, so the acceptance test asserts on the actual decision this
 * app makes rather than recomputing a proxy for it.
 *
 * A surfaced query queues/navigates exactly as the old unconditional path
 * did (geo queue, or the default scenario's single pending-query slot) --
 * runConsentCeremony() re-resolves the template and re-runs the match itself
 * once the human is actually looking; the small duplicate work is the price
 * of not having to thread a precomputed MatchResult through go('answer')'s
 * screen transition, and keeps runConsentCeremony's own tested behaviour
 * completely unchanged for the manual-scan path.
 *
 * A silent query is answered automatically here -- `consent: false`, exactly
 * as if a human had tapped "Nein" -- and logged. No shell()/go() call
 * anywhere on this branch; see emitAnswer's `opts.silent`.
 */
async function handleAmbientQuery(q: QueryEnvelope): Promise<void> {
  const s = state
  if (!s) return
  // Demo 21 (secondHop): every device except Jakob's own laptop needs the
  // relay-aware ceremony (second-brain note, fixed uniform deadline)
  // instead of the classify-then-surface path below. Jakob's OWN device
  // (s.me.id === 'jakob') deliberately falls through to the ordinary path
  // unchanged -- runConsentCeremony already carries the one small addition
  // it needs (the "named introduction" branch) and does not need the fixed
  // deadline: I3 only has to hold at the LAST hop, the one an asker who has
  // never met the final answerer is actually watching the clock on. See
  // runSecondHopRelayCeremony's own doc comment.
  if (wotScenario() === 'secondHop' && s.me.id !== 'jakob') {
    await runSecondHopRelayCeremony(q)
    return
  }
  const tpl = resolveIncomingTemplate(q)
  const peer = s.peers.find((p) => p.id === q.from.id) ?? null
  const blocked = peer?.blocked ?? true

  let match: MatchResult = { hits: [], distinctAuthors: 0, aboveThreshold: false }
  if (tpl) {
    match = isAddressBearingTemplate(tpl) ? matchAccommodation() : prune(matchTemplate(tpl, threadsInScope(s)))
  }

  const { surface } = classifyIncomingQuery(match, blocked, Boolean(tpl))

  if (surface) {
    if (wotScenario() === 'geologengasse') {
      // Several peers can query Jakob independently -- queue rather than
      // clobber a ceremony already on screen. See the removed inline
      // version of this comment (git history) for the full `geoCeremonyBusy`
      // reasoning; unchanged here.
      pendingGeoQueries.push(q)
      if (!geoCeremonyBusy) go('answer')
      return
    }
    // Default scenario: unconditional go('answer'), exactly as this branch
    // always did. Tempting to guard this the way the geo branch guards its
    // own go() (`if (!geoCeremonyBusy)`), but `screen === 'answer'` is NOT a
    // safe stand-in for "no ceremony is active" here: sitting idle on
    // screenAnswer()'s own waiting card (`relayWaitingQuery`, demo 2/6's
    // ordinary posture -- tap "Anfrage beantworten", then wait) ALSO leaves
    // `screen === 'answer'`. Guarding on it would mean a query arriving
    // while genuinely idle on that screen never calls go(), never
    // re-renders, and the ceremony never starts -- Marlene's screen would
    // keep saying "waiting" forever while the query sits unanswered in
    // `pendingIncomingQuery`. The geo branch gets to guard because it has
    // its own dedicated `geoCeremonyBusy` signal for "a decision is actually
    // pending a human tap"; this branch has no equivalent (yet), so it keeps
    // the same unconditional call the original single-peer code always
    // made. A second peer's query arriving while the first is mid-ceremony
    // simply overwrites the slot with itself if nothing has consumed the
    // previous one yet -- a pre-existing limitation of the single-slot
    // design, not something this change makes worse.
    pendingIncomingQuery = q
    go('answer')
    return
  }

  await emitAnswer(q, tpl ?? UNRESOLVED_TEMPLATE, match, false, peer, { silent: true })
}

function screenAsk(): void {
  const s = state as DeviceState
  const lang = getLang()
  const peer = s.peers[0]
  const relayReady = wotMode() === 'relay' && Boolean(peer?.did)
  const webrtcNotOpen = (wotMode() === 'webrtc' || wotMode() === 'ladder') && !webrtcChannel?.isOpen()
  const freeTextInput = el('input', {
    type: 'text',
    placeholder: t('askFreeTextPlaceholder'),
    maxlength: String(FREE_TEXT_MAX_LEN),
  }) as HTMLInputElement
  const submitFreeText = () => {
    const text = freeTextInput.value.trim()
    if (text) void askWith(freeTextTemplate(text), text)
  }
  freeTextInput.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') submitFreeText() })
  const secondHop = wotScenario() === 'secondHop'
  // Both sentences below are addressed to "your question" travelling
  // through an intermediary you already trust to reach someone you don't --
  // that is only ever TRUE from B's own ask screen. `secondHop` alone is a
  // build-time flag shared by all three devices in this scenario; gating on
  // it alone put a false claim on Jakob's own ask screen ("your question
  // does not go straight to Jakob" -- shown to Jakob himself) and on A's
  // own ask screen when she asks Jakob directly (no relay involved at all
  // in that call). The leaf asker is the one device that is neither Jakob
  // nor the note-holding intermediary.
  const isLeafAsker = secondHop && s.me.id !== 'jakob' && !s.secondBrainNotes?.length
  const body = el('div', {}, [
    el('h1', {}, [t('askTitle')]),
    el('p', { class: 'lead' }, [t(wotScenario() === 'geologengasse' ? 'askLeadGeo' : 'askLead')]),
    // Design doc §3, placement 1: this is a consent-affecting fact (it may
    // change whether B wants to ask at all), shown BEFORE B can send
    // anything, not only once a relay has already happened. See
    // i18n.ts's secondHopAskHonesty doc comment for why "Jakob" is named
    // directly in THIS demo's own copy.
    isLeafAsker
      ? el('p', { class: 'note' }, [t('secondHopAskHonesty').replace(/\{who\}/g, peer?.displayName ?? t('appName'))])
      : null,
    isLeafAsker && peer ? el('p', { class: 'note' }, [t('secondHopChainHonesty')]) : null,
    !peer ? el('div', { class: 'err' }, [t('noConnection')]) : null,
    peer && wotMode() === 'relay' && !relayReady
      ? el('p', { class: 'note' }, [t('relayNoPeerDid')])
      : null,
    // webrtc mode (demo 3): asking still works without the data channel --
    // it falls back to the same one-code-at-a-time QR path demo 1 uses (see
    // askWith's dispatch) -- this is informational, not a blocker.
    // Ladder mode (demo 6): no note needed, the automatic fall-through to
    // the relay is the point and the rung badge on the next screen says so.
    peer && wotMode() === 'webrtc' && webrtcNotOpen
      ? el('p', { class: 'note' }, [t('webrtcCardTitle') + ': ' + t('noConnection')])
      : null,
    // "Ins Netzwerk rufen": free text, not one of the five fixed templates
    // below -- travels to every connected peer (askWith()'s broadcast
    // branch), matched against inventory AND chat content exactly like a
    // fixed template, through the same consent gate. Shown first: this is
    // the capability the owner asked for by name.
    //
    // Shown in every mode including demo 20 -- except Sicher (handover:
    // "only the fixed questions, nothing free-text"). Free text sends the
    // asker's own words verbatim to every connected device (askWith()'s
    // broadcast branch); a Sicher asker does not compose one in the first
    // place, so nobody on the other end can be put on the spot by THIS
    // device's own words. See resolveIncomingTemplate's own gate for the
    // matching protection on the RECEIVING side (a Sicher device never
    // surfaces a free-text ask either, regardless of who sent it).
    //
    // NOTE for demo 21 (secondHop): scenario B (the ladder) is asked
    // exclusively via free text. Picking Sicher on a secondHop guest device
    // removes this card and therefore that story -- deliberate, not a bug,
    // but worth knowing before switching a live-demo phone to Sicher
    // mid-show. Scenario A (the accommodation template below) is
    // unaffected, since it is a fixed template either way.
    deviceMode(s) !== 'sicher'
      ? el('div', { class: 'card' }, [
          el('h3', {}, [t('askFreeTextTitle')]),
          el('p', { class: 'note' }, [t('askFreeTextPrivacy')]),
          freeTextInput,
          el('button', {
            class: 'btn primary',
            ...(peer ? {} : { disabled: true }),
            onclick: submitFreeText,
          }, [t('askFreeTextSubmit')]),
        ])
      : null,
    ...templatesForScenario().map((tpl: QueryTemplate) =>
      el('div', { class: 'card' }, [
        el('h3', {}, [tpl.title[lang]]),
        el('p', {}, ['„' + tpl.question[lang] + '“']),
        // Same honesty disclosure demo 20 shows for its own accommodation
        // card -- keyed on the TEMPLATE (isAddressBearingTemplate), not the
        // scenario, so demo 21's own accommodation card (scenario A, same
        // template, same k=1 crutch) gets it too rather than silently
        // omitting it just because the scenario differs.
        isAddressBearingTemplate(tpl) ? el('p', { class: 'note' }, [t('geoKHonesty')]) : null,
        el('button', {
          class: 'btn primary',
          ...(peer ? {} : { disabled: true }),
          onclick: () => void askWith(tpl),
        }, [t('showQuery')]),
      ]),
    ),
  ])
  shell(t('navAsk'), body, { back: () => go('home') })
}

/**
 * `freeText`, when present, is the "Ins Netzwerk rufen" ask -- see
 * screenAsk()'s free-text card. Every OTHER call site (the five template
 * cards) omits it, so this stays byte-for-byte the same dispatch those demos
 * already exercise.
 *
 * Broadcast: if more than one peer is reachable over the relay, this asks
 * ALL of them (askNetwork(), each with its own qid) rather than only
 * `peers[0]` -- "the query goes to every connected peer, not just the
 * first." Every demo before this change pairs exactly one peer, so
 * `relayPeers.length > 1` is never true there and this branch is a pure
 * addition, not a behaviour change, for demos 1/2/3/6. webrtc/ladder/qr keep
 * addressing `peers[0]` only: a single already-open data channel or a QR
 * code only ever reaches one peer regardless of how many are paired.
 *
 * Demo 20 (geologengasse) is INCLUDED as of the browser pass this comment's
 * earlier version asked for: the whole scenario is several friends asking
 * Jakob for things, so excluding the one device that routinely holds several
 * peers excluded the point. Jakob's laptop is the one place in
 * this app that already legitimately holds several relay peers today (each
 * accepted guest, via acceptPendingRequest()), so `relayPeers.length > 1` is
 * routinely true there -- but demo 20 is live and being demonstrated the day
 * this branch landed, and askNetwork()/screenNetworkResult() have not yet
 * been exercised in a browser (only against the live relay directly, no
 * DOM). Rather than risk an untested code path on running software, Jakob's
 * "Fragen" keeps its exact existing single-peer askOverRelay behaviour --
 * this is a narrowing, not a new capability, so it cannot regress what demo
 * 20 already does. The exclusion has now been lifted and demo 20's ask path
 * verified in a browser against the live relay.
 */
async function askWith(tpl: QueryTemplate, freeText?: string): Promise<void> {
  const s = state as DeviceState
  const mode = wotMode()
  const relayPeers = mode === 'relay' ? s.peers.filter((p) => p.did) : []
  if (relayChannel && relayPeers.length > 1) {
    await askNetwork(tpl, freeText, relayPeers)
    return
  }
  const peer = s.peers[0]
  if (!peer) return
  const q: QueryEnvelope = {
    v: 1, t: 'query', from: s.me,
    templateId: tpl.id, templateVersion: tpl.version,
    qid: randomId(12), issuedAt: Date.now(),
    ...(freeText ? { freeText } : {}),
  }
  if (mode === 'relay' && peer.did && relayChannel) {
    lastRung = 'relay'
    await askOverRelay(tpl, q, peer)
    return
  }
  // webrtc/ladder: rung 2 first, whenever the data channel is actually open --
  // this is the ladder's entire point, and demo 3's only transport once the
  // ceremony has succeeded.
  if ((mode === 'webrtc' || mode === 'ladder') && webrtcChannel?.isOpen()) {
    await askOverWebrtc(tpl, q, peer)
    return
  }
  // Ladder mode with no open data channel: reach for the server automatically
  // (rung 3), no human tap required -- that automatic reach, visibly labelled,
  // IS demo 6.
  if (mode === 'ladder' && peer.did && relayChannel) {
    await askOverRelayOrQr(tpl, q, peer)
    return
  }
  // Webrtc mode with no open channel: only use the relay if a human already
  // tapped "über den Server versuchen" during the connect ceremony -- demo 3
  // never reaches for a server on its own.
  if (mode === 'webrtc' && useRelayFallback && peer.did && relayChannel) {
    lastRung = 'relay'
    await askOverRelay(tpl, q, peer)
    return
  }
  lastRung = 'qr'
  await askViaQr(tpl, q, peer)
}

/**
 * "Ins Netzwerk rufen" / "call into the web": send the SAME question to
 * EVERY given peer, each over its own qid (waitForAnswer's Map keys on qid,
 * see that function's doc comment for why one qid per peer rather than a
 * shared one), and wait for all of them.
 *
 * I2 discipline on the waiting screen: no live per-peer breakdown ("Marlene:
 * nothing yet, Ben: answered"). That would let the asker time WHICH named
 * peer produced nothing vs is still thinking, which is exactly the kind of
 * per-peer response state I2 says the asker-facing UI must never show before
 * consent. A single static "asked N people" count is the only thing this
 * screen says while waiting.
 *
 * Once every peer has answered or timed out: any peer whose answer decoded
 * to 'shared' is shown, by name (the asker already knows who they asked --
 * this is not a new leak, see the report's I2/I3 reasoning). A peer who
 * answered 'nothing' or never answered at all is never mentioned
 * individually, so nobody outside this function -- and nobody reading the
 * result screen -- can tell those two cases apart for any one named peer.
 */
async function askNetwork(tpl: QueryTemplate, freeText: string | undefined, peers: Peer[]): Promise<void> {
  const s = state as DeviceState
  lastRung = 'relay'
  const requests = peers.map((peer) => ({
    peer,
    q: {
      v: 1 as const, t: 'query' as const, from: s.me,
      templateId: tpl.id, templateVersion: tpl.version,
      qid: randomId(12), issuedAt: Date.now(),
      ...(freeText ? { freeText } : {}),
    } as QueryEnvelope,
  }))

  const body = el('div', {}, [
    el('h1', {}, [tpl.title[getLang()]]),
    el('p', { class: 'lead' }, ['„' + tpl.question[getLang()] + '“']),
    el('div', { class: 'card' }, [
      el('p', {}, [
        el('span', { class: 'spin' }),
        document.createTextNode(' ' + t('networkAskInFlight').replace('{n}', String(peers.length))),
      ]),
      mountRelayStatusBadge(),
    ]),
    el('button', { class: 'btn quiet', onclick: () => go('ask') }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => go('ask') })

  const results = await Promise.all(requests.map(async ({ peer, q }) => {
    const waiter = waitForAnswer(q.qid, RELAY_ANSWER_TIMEOUT_MS)
    try {
      await sendToPeer(peer, q)
    } catch {
      waiter.cancel()
      return { peer, decoded: null as Awaited<ReturnType<typeof interpret>> | null }
    }
    const env = await waiter.promise
    if (!env) return { peer, decoded: null }
    const key = await pairKey(peer)
    const decoded = await interpret(env, key)
    return { peer, decoded }
  }))

  screenNetworkResult(results, peers.length)
}

/** Result screen for askNetwork(). See that function's doc comment for the
 *  I2 reasoning behind showing only the peers who actually shared. */
function screenNetworkResult(
  results: { peer: Peer; decoded: Awaited<ReturnType<typeof interpret>> | null }[],
  askedCount: number,
): void {
  const shared = results.filter((r) => r.decoded?.outcome === 'shared')
  const body = el('div', {}, [
    shared.length
      ? el('div', {}, shared.flatMap((r) => {
          const items = r.decoded?.shared?.items ?? []
          return [
            el('div', { class: 'outcome shared' }, [
              el('div', { class: 'glyph' }, ['✓']),
              el('b', {}, [t('outShared')]),
              el('span', {}, [r.peer.displayName + ' ' + t('outSharedSub')]),
            ]),
            ...items.map((item) =>
              el('div', { class: 'quote' }, [
                item.text,
                el('footer', {}, [t('fromChat') + ' ' + item.context + ' · ' + item.when]),
              ]),
            ),
          ]
        }))
      : el('div', { class: 'outcome nothing' }, [
          el('div', { class: 'glyph' }, ['—']),
          el('b', {}, [t('outNothing')]),
          el('span', {}, [t('outNothingSub')]),
        ]),
    el('p', { class: 'note' }, [t('networkAskedCount').replace('{n}', String(askedCount))]),
    el('button', { class: 'btn', onclick: () => go('home') }, [t('done')]),
  ])
  shell(t('navAsk'), body, { back: () => go('home') })
}

async function askViaQr(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  const payload = encodeForQr(q)
  await showCodeScreen(tpl.title[getLang()], payload, t('showQueryHint'), () => go('ask'), {
    label: t('waitAnswer'),
    action: () => void scanAnswer(q, peer),
  })
}

async function scanAnswer(q: QueryEnvelope, peer: Peer): Promise<void> {
  await scanScreen(t('waitAnswer'), async (text) => {
    const env = decodeFromQr(text)
    if (!env) return { ok: false, msg: t('badCode') }
    if (env.t !== 'answer') return { ok: false, msg: t('wrongCode') }
    if (env.qid !== q.qid) return { ok: false, msg: t('wrongCode') }
    const key = await pairKey(peer)
    const decoded = await interpret(env as AnswerEnvelope, key)
    pushReceivedShare(decoded)
    screenResult(decoded, peer.displayName)
    return { ok: true }
  }, () => go('ask'))
}

// ---------------------------------------------------------------------------
// ask over the relay -- sends the query, waits for the answer to arrive on
// the drain, and never blocks silently: a status badge, a hard timeout, a
// real error with retry, and the QR path one tap away at every step.
// ---------------------------------------------------------------------------

/**
 * Ladder mode's automatic rung-3 fall-through, reused by demo 2's own
 * (unchanged) relay-mode path via `askOverRelay` below. Ladder-only branch:
 * when even the relay has no did for this peer (should not happen once
 * `needsRelayIdentity()` has run, but a demo build should never hang on an
 * impossible state), falls all the way to the manual QR path -- rung 1.
 */
async function askOverRelayOrQr(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  if (peer.did && relayChannel) {
    lastRung = 'relay'
    await askOverRelay(tpl, q, peer)
    return
  }
  lastRung = 'qr'
  await askViaQr(tpl, q, peer)
}

async function askOverRelay(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  const peerDid = peer.did
  if (!peerDid || !relayChannel) { await askViaQr(tpl, q, peer); return }
  const channel = relayChannel

  const waiter = waitForAnswer(q.qid, RELAY_ANSWER_TIMEOUT_MS)
  // Demo 21 only (every other caller of askOverRelay -- demo 2, demo 6's
  // relay rung -- leaves `secondHop` false, so `waitNote` stays null and
  // the setTimeout below never arms; their behaviour is byte-for-byte
  // unchanged). `settled` guards both the setTimeout callback and every
  // early-exit below against mutating a note that may no longer be on
  // screen.
  const secondHop = wotScenario() === 'secondHop'
  let settled = false
  // The wait itself is part of what this demo shows, not a delay to
  // explain away -- see gate.ts's RELAY_DEADLINE_MS doc comment and
  // i18n.ts's secondHopWaitHonesty doc comment. DECISIONS.md D28: fast is
  // now the default, so this mostly resolves before anyone reads past the
  // first sentence -- but if a decision is genuinely still outstanding
  // after roughly RELAY_DEADLINE_MS (uniform mode on the far end, or a
  // real human still looking at a real prompt), say so honestly rather
  // than leaving a bare spinner or a silent wait (owner's own principle: a
  // slow answer is reported as slow, not disguised) -- never naming who is
  // deciding or where in the chain.
  const waitNote = secondHop ? el('p', { class: 'note' }, [t('secondHopWaitHonesty')]) : null
  if (secondHop && waitNote) {
    setTimeout(() => {
      if (settled) return
      clear(waitNote)
      waitNote.appendChild(document.createTextNode(t('secondHopStillDeciding')))
    }, RELAY_DEADLINE_MS)
  }
  const body = el('div', {}, [
    el('h1', {}, [tpl.title[getLang()]]),
    el('p', { class: 'lead' }, ['„' + tpl.question[getLang()] + '“']),
    el('div', { class: 'card' }, [
      el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('relayAskInFlight'))]),
      waitNote,
      // Ladder mode only (demo 6) -- demo 2 never sets wotMode() === 'ladder',
      // so this line never renders there. The visible rung IS the demo.
      wotMode() === 'ladder' ? el('p', { class: 'note' }, [rungBadgeText('relay')]) : null,
      mountRelayStatusBadge(),
    ]),
    el('button', { class: 'btn quiet', onclick: () => { settled = true; waiter.cancel(); void askViaQr(tpl, q, peer) } }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => { settled = true; waiter.cancel(); go('ask') } }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => { settled = true; waiter.cancel(); go('ask') } })

  let sendErr: Error | null = null
  const key = await pairKey(peer)
  try {
    await channel.send(peerDid, q, key)
  } catch (err) {
    sendErr = err instanceof Error ? err : new Error(String(err))
  }

  if (sendErr) {
    settled = true
    waiter.cancel()
    screenRelayAskError(t('relaySendFailed'), tpl, q, peer)
    return
  }

  const env = await waiter.promise
  settled = true
  if (!env) {
    screenRelayAskError(t('relayTimeout'), tpl, q, peer)
    return
  }
  const decoded = await interpret(env, key)
  pushReceivedShare(decoded)
  screenResult(decoded, peer.displayName)
}

function screenRelayAskError(msg: string, tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): void {
  const body = el('div', {}, [
    el('div', { class: 'err' }, [msg]),
    el('button', { class: 'btn primary', onclick: () => void askOverRelay(tpl, q, peer) }, [t('retry')]),
    el('button', { class: 'btn quiet', onclick: () => void askViaQr(tpl, q, peer) }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => go('ask') }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => go('ask') })
}

// ---------------------------------------------------------------------------
// ask over webrtc -- rung 2. Sends the query over the already-open data
// channel and waits for the answer on the SAME shared `awaitingAnswer` slot
// relay mode uses (handleIncomingEnvelope is registered as this channel's
// onEnvelope callback too, see getOrCreateWebrtcChannel) -- transport-
// agnostic by construction, exactly like gate.ts's envelopes themselves.
// ---------------------------------------------------------------------------

async function askOverWebrtc(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  const channel = webrtcChannel
  if (!channel || !channel.isOpen()) {
    if (wotMode() === 'ladder') { await askOverRelayOrQr(tpl, q, peer); return }
    lastRung = 'qr'
    await askViaQr(tpl, q, peer)
    return
  }
  lastRung = 'webrtc'

  const waiter = waitForAnswer(q.qid, WEBRTC_ANSWER_TIMEOUT_MS)
  const body = el('div', {}, [
    el('h1', {}, [tpl.title[getLang()]]),
    el('p', { class: 'lead' }, ['„' + tpl.question[getLang()] + '“']),
    el('div', { class: 'card' }, [
      el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('webrtcAskInFlight'))]),
      wotMode() === 'ladder' ? el('p', { class: 'note' }, [rungBadgeText('webrtc')]) : null,
    ]),
    el('button', { class: 'btn quiet', onclick: () => { waiter.cancel(); void askViaQr(tpl, q, peer) } }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => { waiter.cancel(); go('ask') } }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => { waiter.cancel(); go('ask') } })

  const key = await pairKey(peer)
  let sendErr: Error | null = null
  try {
    channel.send(q)
  } catch (err) {
    sendErr = err instanceof Error ? err : new Error(String(err))
  }

  if (sendErr) {
    waiter.cancel()
    if (wotMode() === 'ladder') { await askOverRelayOrQr(tpl, q, peer); return }
    screenWebrtcAskError(t('webrtcTimeout'), tpl, q, peer)
    return
  }

  const env = await waiter.promise
  if (!env) {
    if (wotMode() === 'ladder') { await askOverRelayOrQr(tpl, q, peer); return }
    screenWebrtcAskError(t('webrtcTimeout'), tpl, q, peer)
    return
  }
  const decoded = await interpret(env, key)
  pushReceivedShare(decoded)
  screenResult(decoded, peer.displayName)
}

/** Demo 3 only (never reached in ladder mode, which auto-falls-through
 *  instead -- see askOverWebrtc). Real message, a retry, the manual "über
 *  den Server versuchen" escape hatch (brings up the relay on first tap,
 *  same as the connect-ceremony failure screen), and the honest QR path. */
function screenWebrtcAskError(msg: string, tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): void {
  const body = el('div', {}, [
    el('div', { class: 'err' }, [msg]),
    el('button', { class: 'btn primary', onclick: () => void askOverWebrtc(tpl, q, peer) }, [t('retry')]),
    el('button', {
      class: 'btn',
      onclick: () => { void ensureRelayFallback().then(() => askOverRelayOrQr(tpl, q, peer)) },
    }, [t('webrtcTryServer')]),
    el('button', { class: 'btn quiet', onclick: () => void askViaQr(tpl, q, peer) }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => go('ask') }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => go('ask') })
}

function screenResult(decoded: Awaited<ReturnType<typeof interpret>>, peerName: string): void {
  const shared = decoded.outcome === 'shared' ? decoded.shared : undefined
  // Same conversation the answering device now lands in after sending (see
  // sendAnswerOverRelay/sendAnswerOverWebrtc) -- he wants both devices to end
  // up in the chat, not just his own. Never offered in qr mode (demo 1),
  // which has no live link to land in at all.
  const canChat = wotMode() !== 'qr' && Boolean(state?.peers[0])
  const body = el('div', {}, [
    el('div', { class: 'outcome ' + (shared ? 'shared' : 'nothing') }, [
      el('div', { class: 'glyph' }, [shared ? '✓' : '—']),
      el('b', {}, [shared ? t('outShared') : t('outNothing')]),
      el('span', {}, [shared ? peerName + ' ' + t('outSharedSub') : t('outNothingSub')]),
    ]),
    // REMOVED (DECISIONS.md D27, superseding the former D23 "named
    // introduction" this comment used to describe): a second-hop answer is
    // anonymous by default now, so `shared.from` is deliberately left ''
    // on that path (main.ts's forwardToOwner/resolveRelayPayload) and there
    // is nothing here to render. For every OTHER demo `shared.from` equals
    // `peerName` exactly (the direct answerer's own name, via GateInput.identity),
    // so a naive `shared.from && shared.from !== peerName` guard would have
    // stayed silent for them regardless -- removed outright rather than kept
    // as dead code that only looks like it still does something.
    ...(shared?.items ?? []).map((item) =>
      el('div', { class: 'quote' }, [
        item.text,
        el('footer', {}, [t('fromChat') + ' ' + item.context + ' · ' + item.when]),
      ]),
    ),
    // DECISIONS.md D29: a second-hop accommodation answer is deliberately
    // vaguer than demo 20's own direct one (the real address stripped
    // before sealing, main.ts's forwardToOwner) -- said plainly here so it
    // reads as a design choice, not as a failure to find the exact place.
    // Gated on the SCENARIO too, not just the template id: demo 20's own
    // direct answer to this same template legitimately carries the real
    // address and must keep saying so unchanged.
    wotScenario() === 'secondHop' && shared?.templateId === ACCOMMODATION_TEMPLATE_ID
      ? el('p', { class: 'note' }, [t('secondHopVaguerAnswer')])
      : null,
    // Ladder mode only (demo 6): which rung actually carried this exchange --
    // set by askWith()/askOverWebrtc()/askOverRelayOrQr() just before this
    // screen renders. This IS the demo: the point is not just that a rung 3
    // fallback exists, but that a person can SEE it happened.
    wotMode() === 'ladder' && lastRung ? el('p', { class: 'note' }, [rungBadgeText(lastRung)]) : null,
    el('button', { class: 'btn', onclick: () => go(canChat ? 'link' : 'home') }, [t('done')]),
  ])
  shell(t('navAsk'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// answer (person A) -- the consent ceremony
// ---------------------------------------------------------------------------

function screenAnswer(): void {
  // Demo 20: several people can have queried Jakob; drain one at a time,
  // oldest first -- see pendingGeoQueries's doc comment.
  if (wotScenario() === 'geologengasse' && pendingGeoQueries.length) {
    const q = pendingGeoQueries.shift() as QueryEnvelope
    void runConsentCeremony(q)
    return
  }
  // A query that arrived over the relay while the user was elsewhere jumps
  // straight into the consent ceremony -- see handleIncomingEnvelope(). Read
  // once and cleared immediately so a later re-render of this same screen
  // (e.g. after go('answer') from somewhere else) does not replay it.
  if (pendingIncomingQuery) {
    const q = pendingIncomingQuery
    pendingIncomingQuery = null
    void runConsentCeremony(q)
    return
  }
  const s = state as DeviceState
  const peer = s.peers[0]
  const relayReady = wotMode() === 'relay' && Boolean(peer?.did)
  const body = el('div', {}, [
    el('h1', {}, [t('answerTitle')]),
    el('p', { class: 'lead' }, [t('connectLead')]),
    relayReady ? el('div', { class: 'card' }, [el('p', {}, [t('relayWaitingQuery')]), mountRelayStatusBadge()]) : null,
    wotMode() === 'relay' && !relayReady ? el('p', { class: 'note' }, [t('relayNoPeerDid')]) : null,
    el('button', { class: 'btn primary', onclick: () => void scanQuery() }, [
      relayReady ? t('scanInstead') : t('scanQuery'),
    ]),
  ])
  shell(t('navAnswer'), body, { back: () => go('home') })
}

async function scanQuery(): Promise<void> {
  await scanScreen(t('scanQuery'), async (text) => {
    const env = decodeFromQr(text)
    if (!env) return { ok: false, msg: t('badCode') }
    if (env.t !== 'query') return { ok: false, msg: t('wrongCode') }
    await runConsentCeremony(env as QueryEnvelope)
    return { ok: true }
  }, () => go('answer'))
}

/**
 * Keep only the hits that are actually about the question.
 *
 * The matcher scores generously on purpose, because recall matters more than
 * precision when deciding WHETHER there is anything here. But what a person is
 * asked to share, and what the asker then reads, should be the strong hits
 * only: a message that merely shares a district name with the real lead is
 * noise, and noise in that list makes the whole thing look careless.
 *
 * This narrows only what is previewed and shared. It deliberately does NOT
 * touch `aboveThreshold` or `distinctAuthors`, because those are the anonymity
 * decision, and that decision is made by the matcher over its own relevance
 * band. Narrowing what is shared must never narrow the floor that protects the
 * people who wrote it.
 */
const RELEVANCE_BAND = 0.5
const MAX_SHARED = 3

function prune(m: MatchResult): MatchResult {
  if (!m.hits.length) return m
  const top = m.hits[0].score
  const floor = top * RELEVANCE_BAND
  return { ...m, hits: m.hits.filter((h) => h.score >= floor).slice(0, MAX_SHARED) }
}

/** The accommodation template's hit carries the exact address in
 *  `hit.message.text` (match/accommodation.ts's module doc). That text must
 *  never reach the DOM before consent -- so this template gets no
 *  "Zeigen, was geteilt würde" reveal at all, ever, and the "gefunden" card
 *  shows only the address-free preview sentence instead. */
function isAddressBearingTemplate(tpl: QueryTemplate): boolean {
  return tpl.id === ACCOMMODATION_TEMPLATE_ID
}

async function runConsentCeremony(q: QueryEnvelope): Promise<void> {
  const s = state as DeviceState
  const tpl = resolveIncomingTemplate(q)
  const lang = getLang()
  const geo = wotScenario() === 'geologengasse'
  if (geo) geoCeremonyBusy = true

  // 1. A fixed-length "checking" beat. The match itself is far faster than this;
  //    the delay is here so the machine's answer time does not depend on whether
  //    anything was found.
  const t0 = Date.now()
  // Sicher may be why `tpl` is undefined here (a free-text ask this device
  // refuses to resolve, see resolveIncomingTemplate's own gate), not only a
  // genuinely corrupt/unknown templateId. Either way the honest thing to
  // show is UNRESOLVED_TEMPLATE's own "Unbekannte Anfrage" wording, never
  // the raw wire id (q.templateId is always the fixed free-text sentinel in
  // the Sicher case, which would read as a technical leak on a manual-scan
  // screen the audience is not technical enough to make sense of).
  shell(t('navAnswer'), el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    el('p', { class: 'lead' }, ['„' + (tpl ? tpl.question[lang] : UNRESOLVED_TEMPLATE.question[lang]) + '“']),
    el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('checking'))]),
  ]))

  let match: MatchResult = { hits: [], distinctAuthors: 0, aboveThreshold: false }
  if (tpl && isAddressBearingTemplate(tpl)) {
    // Not matchTemplate()/threadsInScope(): this corpus is a calendar and a
    // flat, not a chat -- see match/accommodation.ts's module doc on why
    // this is a second, separate matcher rather than a fork of the lexical
    // one gate.ts's every other caller still uses unmodified.
    match = matchAccommodation()
  } else if (tpl) {
    match = prune(matchTemplate(tpl, threadsInScope(s)))
  }
  await settleAt(t0, GATE_BUDGET_MS)

  if (!tpl) {
    // Unresolvable (corrupt/unknown templateId, no freeText). Still a
    // received query -- I6 says every one gets logged, this one included --
    // so it still goes through emitAnswer() rather than being dropped
    // silently. Not `silent: true`: a human already chose to scan this, so
    // the existing "answer sent" confirmation screen is the honest thing to
    // show, same as any other manually-scanned query.
    const peer = s.peers.find((p) => p.id === q.from.id) ?? null
    await emitAnswer(q, UNRESOLVED_TEMPLATE, match, false, peer)
    geoCeremonyBusy = false
    return
  }

  // 2. The ask. One tap either way, and the same page furniture either way.
  const peer = s.peers.find((p) => p.id === q.from.id) ?? null
  const has = match.aboveThreshold
  const addressBearing = isAddressBearingTemplate(tpl)

  let revealed = false
  const reveal = el('div', {})
  const renderReveal = () => {
    clear(reveal)
    if (!revealed) return
    for (const h of match.hits.slice(0, 3)) {
      reveal.appendChild(el('div', { class: 'quote' }, [
        h.message.text,
        el('footer', {}, [t('fromChat') + ' ' + h.threadTitle + ' · ' + coarseWhen(h.message.ts, lang)]),
      ]))
    }
  }

  const finish = (consent: boolean) => {
    void emitAnswer(q, tpl, match, consent, peer).finally(() => {
      // The decision has been made and the answer sent (or the send has
      // failed onto its own honest fallback screen) -- from here on a NEW
      // arriving query is safe to route to, not something to steal focus
      // from. See handleIncomingEnvelope's query branch.
      geoCeremonyBusy = false
    })
  }

  // Demo 21 (secondHop) only, and only for a query that arrived VIA A's
  // relay (q.relayed === true -- never true for anyone else, see
  // types.ts's doc comment on that field). Jakob must still learn, before
  // he decides, that this came from a stranger via A (I4, design doc
  // finding 2) -- `secondHopNamedIntroNote` says so. What changed
  // (DECISIONS.md D27, superseding this app's own former D23): the answer
  // is anonymous by default, so there is no separate "answer and be named"
  // choice any more -- consenting to answer NEVER passes his name on. The
  // three-button branch this comment used to describe is gone; a relayed
  // query gets the exact same two buttons (decline / share) as any other
  // query, only the notice above them differs.
  const relayedFromStranger = wotScenario() === 'secondHop' && q.relayed === true
  const body = el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    el('p', { class: 'lead' }, ['„' + tpl.question[lang] + '“']),
    el('div', { class: 'card' }, [
      el('p', { class: 'lead' }, [
        has ? (addressBearing ? (lang === 'de' ? accommodationPreviewDe() : accommodationPreviewEn()) : t('foundSomething')) : t('foundNothing'),
      ]),
      has ? el('p', {}, [t('willingShare')]) : null,
      has && relayedFromStranger
        ? el('p', { class: 'note' }, [t('secondHopNamedIntroNote').replace(/\{who\}/g, q.from.displayName)])
        : null,
    ]),
    // The reveal toggle never renders for the address-bearing template --
    // see isAddressBearingTemplate()'s doc comment above. Every other
    // template keeps the exact existing behaviour.
    has && !addressBearing ? el('button', {
      class: 'btn quiet',
      onclick: (e: Event) => {
        revealed = !revealed
        ;(e.currentTarget as HTMLElement).textContent = revealed ? t('hideWhat') : t('seeWhat')
        renderReveal()
      },
    }, [t('seeWhat')]) : null,
    addressBearing ? null : reveal,
    has
      ? el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn', onclick: () => finish(false) }, [t('noShare')]),
          el('button', { class: 'btn primary', onclick: () => finish(true) }, [t('yesShare')]),
        ])
        : el('button', { class: 'btn primary', onclick: () => finish(false) }, [t('continueBtn')]),
  ])
  shell(t('navAnswer'), body, { back: () => go('answer') })
}

// ---------------------------------------------------------------------------
// demo 21 (secondHop): the RELAYING hop's own ceremony. Deliberately
// separate from runConsentCeremony (see screenSecondHopNameEntry's doc
// comment) -- only the device that MAY forward a question one hop further
// needs this; Jakob's own device, even answering a query that arrived via a
// relay, uses runConsentCeremony unmodified plus the "named introduction"
// addition just above. I3 only has to hold at the LAST hop, the one an
// asker who has never met the final answerer is actually watching the clock
// on -- see handleAmbientQuery's routing and gate.ts's RELAY_DEADLINE_MS.
// ---------------------------------------------------------------------------

/** Represent A's private second-brain note as matcher input, the exact same
 *  technique state.ts's inventoryThreads() uses for "Was ich habe" entries
 *  -- one synthetic single-message ChatThread, so match/lexical.ts needs no
 *  second scoring path here either. Run as its OWN matchTemplate() call,
 *  never merged into threadsInScope(), so a note can never silently
 *  contribute to A's own direct-share matching (D16's shape: relay
 *  eligibility is decided separately from, and after, an ordinary direct
 *  match). */
function secondBrainThread(s: DeviceState, note: SecondBrainNote): ChatThread {
  return {
    id: `sb:${note.id}`,
    title: 'Eigene Notizen (über andere)',
    kind: 'direct',
    participants: [s.me.displayName],
    messages: [{ ts: note.createdAt, author: s.me.displayName, text: note.text, system: false }],
    source: 'self',
    included: true,
  }
}

/** What every second-hop ending holds, never sends directly -- see
 *  createRelayDispatch's own doc comment just below. `receivedAt` is
 *  exposed so a caller that itself needs to bound a further wait
 *  (forwardToOwner's own wait for Jakob's answer) can compute "how much of
 *  the shared window is left" without threading a second copy of the same
 *  timestamp through by hand. */
/** Which of A's two independent switches (DECISIONS.md D28/D30) governs a
 *  given resolution: 'direct' when THIS device is the one actually
 *  answering (a real match against its own stuff, or a genuine immediate
 *  "nothing" with no note ever in play); 'relay' when an eligible
 *  second-brain note was in play at all, whether she went on to decline or
 *  to forward it. See state.ts's own doc comment on the two fields this
 *  maps to and D30 for why the boundary is drawn at "was a note eligible,"
 *  not "did she actually forward." */
type RelayDispatchKind = 'direct' | 'relay'

/** What every second-hop ending holds, never sends directly -- see
 *  createRelayDispatch's own doc comment just below. `receivedAt` is
 *  exposed so a caller that itself needs to bound a further wait
 *  (forwardToOwner's own wait for Jakob's answer) can compute "how much of
 *  the shared window is left" without threading a second copy of the same
 *  timestamp through by hand. */
interface RelayDispatch {
  resolve: (kind: RelayDispatchKind, outcome: LocalOutcome, envelope: AnswerEnvelope, onSent?: () => void) => void
  /**
   * Convenience wrapper around `resolve()` for a caller holding a
   * SharedPayload (or null) rather than an already-sealed envelope --
   * see createRelayDispatch's own implementation of it. `payload.from` is
   * what goes ON THE WIRE (DECISIONS.md D27: anonymous by default, so this
   * is '' on every caller that forwards to a further hop -- see
   * forwardToOwner). `localFromLabel`, when given, is what A's OWN local
   * record (`pushLocalShareItems`, I6) shows instead -- she is entitled to
   * know who she actually reached (D24) even though B is not told.
   */
  resolvePayload: (
    kind: RelayDispatchKind, payload: SharedPayload | null, outcome: LocalOutcome, localFromLabel?: string,
  ) => Promise<void>
  receivedAt: number
}

/**
 * Dispatcher for A's single answer to B on this hop. TWO INDEPENDENT
 * switches (DECISIONS.md D28/D30), each read fresh from `state`, each
 * chosen by WHICH KIND of ending is being resolved (the `kind` argument to
 * `resolve()`/`resolvePayload()` -- see `RelayDispatchKind`'s own doc
 * comment):
 *
 *  - `kind: 'direct'` reads `s.secondHopUniformModeDirect` (default
 *    false/unset = FAST -- owner's explicit I9 override for the person
 *    actually answering, D28's own reasoning).
 *  - `kind: 'relay'` reads `s.secondHopRevealRelay` (default false/unset =
 *    UNIFORM/non-revealing, the ORDINARY I9 posture, NOT overridden --
 *    D30's own reasoning: the person relaying never asked to be involved).
 *
 * FAST: `resolve()`/`resolvePayload()` send the moment they are called.
 * UNIFORM: every such ending is held to the exact same `receivedAt +
 * RELAY_DEADLINE_MS` instant regardless of how quickly the underlying
 * decision resolved -- the ORIGINAL mechanism this function shipped with,
 * kept intact, not deleted, just now scoped per-kind rather than applying
 * uniformly to the whole dispatch. `resolve()`/`resolvePayload()` only ever
 * UPDATE what will be sent when in uniform mode; a single `setTimeout`
 * armed here, at receipt, before any human interaction can happen, is the
 * only thing that ever calls `fire()` in that case -- the same shape
 * `packages/agent-daemon`'s `scheduleAt`/`dispatchOwnerStatus` uses
 * (content read at fire time, fire time fixed at receipt). A `resolve()`
 * arriving after the timer already fired is simply too late, exactly like
 * Jakob answering after the deadline already was.
 *
 * Earlier versions of this file called `settleAt(receivedAt,
 * RELAY_DEADLINE_MS)` from INSIDE each ending, AFTER a human had already
 * decided -- broken under the OLD unconditional-uniform design (`settleAt`
 * resolves immediately once its target instant has already passed, so a
 * slow human decision fired early, reopening the exact hop-count oracle
 * the deadline existed to close). That bug is why sending only ever
 * happens from ONE place (`fire()`), armed once, up front, regardless of
 * mode -- only WHETHER `fire()` also runs the moment `resolve()`/
 * `resolvePayload()` is called (fast) or waits for the timer alone
 * (uniform) differs.
 *
 * The armed `setTimeout` is never cancelled even when a call site resolves
 * fast: it is the backstop for "nothing was ever resolved before the
 * deadline" (dead note, unresolvable template) and for "uniform mode was
 * on, wait for it" -- `dispatched` makes firing twice impossible either
 * way.
 *
 * D30's own honestly-stated residual: because the two switches' DEFAULTS
 * point in opposite directions (direct fast, relay uniform/slow), a
 * relay-eligible ending is, by default, still observably slower than a
 * direct or no-note one -- the relay switch's own default protects the
 * FINER signal within that class (how long the round trip actually took,
 * whether Jakob declined vs never answered) but cannot, by construction,
 * fully hide the COARSER fact that some note was engaged at all, given the
 * direct default stays fast. Not fixed silently here; see D30 and the
 * result report for the full account.
 */
function createRelayDispatch(
  q: QueryEnvelope, peer: Peer | null, receivedAt: number,
): RelayDispatch {
  const s = state as DeviceState
  const isFast = (kind: RelayDispatchKind): boolean =>
    kind === 'direct' ? !s.secondHopUniformModeDirect : Boolean(s.secondHopRevealRelay)
  let dispatched = false
  let resolved: { outcome: LocalOutcome; envelope: AnswerEnvelope; onSent?: () => void } | null = null

  const fire = async (): Promise<void> => {
    if (dispatched) return
    dispatched = true

    let outcome: LocalOutcome
    let envelope: AnswerEnvelope
    let onSent: (() => void) | undefined
    if (resolved) {
      outcome = resolved.outcome
      envelope = resolved.envelope
      onSent = resolved.onSent
    } else {
      // Nobody resolved anything before the deadline (no eligible note, no
      // template, or a human simply never answered the prompt) -- the exact
      // same wire ending as a genuine no-match anywhere else in this app,
      // built through the same mask trick, never a separate code path.
      outcome = 'no-match'
      const ak = await answerKey(peer, q.qid)
      envelope = await sealRelayAnswer(q.qid, q.templateId, null, ak)
    }

    return logAndDispatch(s, {
      at: Date.now(),
      fromDisplayName: q.from.displayName,
      fromId: q.from.id,
      text: q.freeText ?? tpl_question_fallback(q),
      outcome,
    }, async () => {
      if (!(peer?.did && relayChannel)) return
      // Past the guard above `peer` is non-null by construction, so this is
      // the real pair key -- never the refusal branch of answerKeyFor().
      const key = await pairKey(peer)
      try {
        await relayChannel.send(peer.did, envelope, key)
      } catch {
        // Delivery failed outright -- a transport fact, not a content signal
        // (same reasoning as sendAnswerOverRelay's own catch block).
        return
      }
      onSent?.()
      renderSecondHopSentScreen()
    })
  }

  const remaining = Math.max(0, receivedAt + RELAY_DEADLINE_MS - Date.now())
  setTimeout(() => { void fire() }, remaining)

  return {
    resolve(kind, outcome, envelope, onSent) {
      if (dispatched) return // too late -- see this function's own doc comment
      resolved = { outcome, envelope, onSent }
      if (isFast(kind)) void fire() // fast for this kind -- send now, not at the deadline
    },
    async resolvePayload(kind, payload, outcome, localFromLabel) {
      // Convenience for callers that hold a SharedPayload rather than an
      // already-sealed envelope (forwardToOwner's relay-success ending) --
      // the same key this dispatch's own fire() would use, from the same
      // closed-over `peer`, so sealing here rather than inside fire() only
      // lets forwardToOwner hand over a fully-built resolution instead of
      // reaching back into this closure for the key. (It no longer produces
      // byte-identical output either way: since C-02 the IV is drawn fresh
      // per seal, so two seals of one plaintext differ in bytes while
      // decrypting identically. Nothing depended on the byte-identity; the
      // wire shape and length, which I3 does depend on, are unchanged.)
      if (dispatched) return // too late -- see resolve()'s own doc comment
      // SECURITY (follow-up 1 of C-02/F-01): this was the ONE path that
      // sealed a REAL payload without consulting `blocked` -- every other
      // no-peer site forces `blocked: peer?.blocked ?? true` and therefore
      // seals zeros. With no peer record there is no pair key, so
      // answerKeyFor() refuses: throwaway key AND `blocked`, which the mask
      // below turns into the same all-zero "nothing" every other cause
      // produces. See answerKeyFor's own doc comment for why no legitimate
      // no-peer delivery is being given up here (fire() cannot send without
      // `peer?.did` anyway).
      const ak = await answerKey(peer, q.qid)
      const envelope = await sealRelayAnswer(q.qid, q.templateId, payload, ak)
      if (dispatched) return // the timer could have fired while we awaited above
      resolved = {
        outcome,
        envelope,
        onSent: payload
          ? () => pushLocalShareItems(localFromLabel ?? payload.from, payload.templateId, payload.items)
          : undefined,
      }
      if (isFast(kind)) void fire() // fast for this kind -- send now, not at the deadline
    },
    receivedAt,
  }
}

/**
 * Entry point for a query arriving on the relaying hop's own device
 * (handleAmbientQuery routes here). `receivedAt` is the ONE deadline
 * anchor every ending below is held to, via `createRelayDispatch` above --
 * captured here, at the top, before anything else runs (including before
 * any human has looked at the screen), and the dispatch it arms is the
 * ONLY thing that ever sends A's answer to B.
 *
 * Three endings, in the order they are tried:
 *  1. A real DIRECT match against A's own stuff (threadsInScope() -- empty
 *     in this demo's own seed, but the SAME real path every other demo
 *     uses, not stubbed out).
 *  2. A RELAY match against A's second-brain note (D16's shape: note must
 *     exist, the query must not already be a relay itself -- I8's depth
 *     cap -- the noted owner must be a LIVE, reachable peer, and the noted
 *     owner must not be the requester themselves -- forwarding B's question
 *     back to B, or Jakob's own question back to Jakob, is never offered,
 *     same reasoning as the daemon's own sender-exclusion in its relay
 *     logic).
 *  3. Nothing -- no direct match and no eligible note -- same ending as a
 *     below-threshold match anywhere else in this app, resolved via the
 *     dispatch's own built-in "nobody resolved anything" fallback.
 */
async function runSecondHopRelayCeremony(q: QueryEnvelope): Promise<void> {
  const s = state as DeviceState
  const receivedAt = Date.now()
  const tpl = resolveIncomingTemplate(q)
  const lang = getLang()
  const peer = s.peers.find((p) => p.id === q.from.id) ?? null
  const dispatch = createRelayDispatch(q, peer, receivedAt)

  shell(t('navAnswer'), el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    // Same reasoning as runConsentCeremony's own fix: `tpl` can be
    // undefined here because THIS device is Sicher and refused to resolve
    // a free-text ask, not only for a corrupt/unknown templateId -- show
    // the honest "Unbekannte Anfrage" wording, never the raw wire id.
    el('p', { class: 'lead' }, ['„' + (tpl ? tpl.question[lang] : UNRESOLVED_TEMPLATE.question[lang]) + '“']),
    el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('checking'))]),
  ]))

  if (!tpl) {
    // Nothing to resolve. Resolved EXPLICITLY (not left to the dispatch's
    // own deadline fallback) so the fast default (D28) fires this near
    // instantly rather than idling until RELAY_DEADLINE_MS for no reason --
    // the fallback still exists for uniform mode, and as a genuine backstop
    // if this call were ever removed.
    await dispatch.resolvePayload('direct', null, 'no-match')
    return
  }

  const directMatch = prune(matchTemplate(tpl, threadsInScope(s)))
  if (directMatch.aboveThreshold) {
    renderSecondHopDirectCard(q, tpl, directMatch, peer, dispatch)
    return
  }

  // D16's guard, made concrete here: a note whose owner has no live,
  // reachable peer edge -- OR whose owner IS the requester themselves --
  // is never even offered as relay-eligible, folded into the exact same
  // "nothing" ending a genuine no-match gets, not a separate code path, so
  // neither case is ever distinguishable on the wire (same reasoning as
  // daemon.ts's own D16 fix).
  //
  // A can hold SEVERAL notes (state.ts's own doc comment -- the ladder,
  // separately the flat, D26/scenario A's own addition). Every eligible one
  // is fed into ONE matchTemplate() call together, as one synthetic thread
  // each, exactly like threadsInScope() already scores several real chats
  // in a single pass -- not one matchTemplate() call per note, which would
  // let the FIRST note tried silently win ties or take a different code
  // path than the others. The winning hit's `threadId`
  // (secondBrainThread()'s own `sb:${note.id}` shape) says which note --
  // and therefore which owner -- actually scored, since matchTemplate()'s
  // own contract sorts hits by score descending and prune() (above)
  // preserves that order.
  // Sicher (handover-three-modes.md): "nothing travels a second hop." A
  // Sicher device never offers to relay, whether it would go on to decline
  // or forward -- folded in here, alongside the existing depth cap
  // (`!q.relayed`), rather than as a later decision the person would
  // otherwise have to make and then decline. That is the whole point: a
  // Sicher relayer is never put in the position of having to decide at all.
  const eligibleNotes = (!q.relayed && deviceMode(s) !== 'sicher' ? s.secondBrainNotes ?? [] : [])
    .map((note) => ({ note, ownerPeer: s.peers.find((p) => p.id === note.ownerPeerId && p.did && p.id !== q.from.id) }))
    .filter((x): x is { note: SecondBrainNote; ownerPeer: Peer } => Boolean(x.ownerPeer))
  const noteMatch: MatchResult = eligibleNotes.length
    ? prune(matchTemplate(tpl, eligibleNotes.map((x) => secondBrainThread(s, x.note))))
    : { hits: [], distinctAuthors: 0, aboveThreshold: false }
  const winner = noteMatch.aboveThreshold
    ? eligibleNotes.find((x) => `sb:${x.note.id}` === noteMatch.hits[0]?.threadId)
    : undefined

  if (winner) {
    renderSecondHopRelayCard(q, tpl, noteMatch, winner.note, winner.ownerPeer, peer, dispatch)
    return
  }

  // Nothing eligible. Resolved EXPLICITLY, same reasoning as the `!tpl`
  // branch above.
  await dispatch.resolvePayload('direct', null, 'no-match')
}

/**
 * A real match against A's OWN stuff. Reuses `decide()` for content
 * (unchanged, byte-identical to what every other demo already sends), but
 * does NOT send it itself -- the resulting `{outcome, envelope}` is only
 * ever handed to `dispatch.resolve()`, which holds it until the shared
 * fixed deadline armed by `createRelayDispatch` fires (point 4 of the
 * handover: EVERY ending on this hop, not only the relay ones, shares the
 * one fixed deadline, regardless of how quickly or slowly A herself taps).
 */
function renderSecondHopDirectCard(
  q: QueryEnvelope, tpl: QueryTemplate, match: MatchResult, peer: Peer | null, dispatch: RelayDispatch,
): void {
  const s = state as DeviceState
  const finish = (consent: boolean): void => {
    void (async () => {
      const { key, blocked } = await answerKey(peer, q.qid)
      const { outcome, envelope } = await decide({
        query: q, template: tpl, match, consent, blocked, key, identity: s.me,
      })
      dispatch.resolve('direct', outcome, envelope, outcome === 'shared' ? () => pushLocalShare(tpl, match) : undefined)
      renderSecondHopPendingScreen()
    })()
  }
  const body = el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    el('p', { class: 'lead' }, ['„' + tpl.question[getLang()] + '“']),
    el('div', { class: 'card' }, [
      el('p', { class: 'lead' }, [t('foundSomething')]),
      el('p', {}, [t('willingShare')]),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn', onclick: () => finish(false) }, [t('noShare')]),
      el('button', { class: 'btn primary', onclick: () => finish(true) }, [t('yesShare')]),
    ]),
  ])
  shell(t('navAnswer'), body, { back: () => go('answer') })
}

/**
 * The relay offer: "I don't have this myself, but I think X might -- ask
 * them?" Owner's fixed point 2 (the intermediary sees what she carries),
 * made explicit here rather than only in the report: `secondHopRelayHonesty`
 * says plainly, before A taps anything, that choosing to forward means A
 * can read both the question and whatever answer comes back -- this is not
 * a blind pipe, and the app must not let anyone believe it is one.
 */
function renderSecondHopRelayCard(
  q: QueryEnvelope, tpl: QueryTemplate, noteMatch: MatchResult, note: SecondBrainNote, ownerPeer: Peer,
  peer: Peer | null, dispatch: RelayDispatch,
): void {
  const s = state as DeviceState
  const declineRelay = (): void => {
    // A chooses not to forward at all. Same wire ending as a genuine
    // no-match (decide()'s own mask trick, gate.ts's module doc) -- the
    // local Protokoll still records the truer 'declined' label because
    // noteMatch is A's own real, honestly-timestamped hit against her own
    // note (not a relayed payload -- see gate.ts's truncateSharedJson doc
    // comment for why that distinction matters and where it stops applying).
    // Held to the shared deadline via dispatch.resolve(), same as every
    // other ending on this hop -- never sent the moment A taps.
    void (async () => {
      const { key, blocked } = await answerKey(peer, q.qid)
      const { outcome, envelope } = await decide({
        query: q, template: tpl, match: noteMatch, consent: false, blocked, key,
        identity: s.me,
      })
      dispatch.resolve('relay', outcome, envelope)
      renderSecondHopPendingScreen()
    })()
  }
  const wantsRelay = (): void => {
    // forwardToOwner renders its own "forwarding" screen immediately below;
    // no separate pending screen needed here.
    void forwardToOwner(q, note, ownerPeer, dispatch)
  }
  const body = el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    el('p', { class: 'lead' }, ['„' + tpl.question[getLang()] + '“']),
    el('div', { class: 'card' }, [
      el('p', { class: 'lead' }, [t('secondHopRelayFound').replace('{who}', note.ownerDisplayName)]),
      el('p', {}, [t('secondHopRelayHonesty')]),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn', onclick: declineRelay }, [t('secondHopRelayDecline')]),
      el('button', { class: 'btn primary', onclick: wantsRelay }, [t('secondHopRelayAccept')]),
    ]),
  ])
  shell(t('navAnswer'), body, { back: () => go('answer') })
}

/**
 * A's own choice to forward: compose a FRESH QueryEnvelope (new qid, `from`
 * is A's own identity -- I8, Jakob's card must name A, never B), send it to
 * the noted owner, and wait for at most whatever remains of the SAME fixed
 * deadline B's own answer is held to (Jakob cannot buy more time by
 * answering late). `relayed: true` is the depth cap (I8 "one hop, not N",
 * types.ts's own doc comment on that field) -- Jakob's device, receiving
 * this, will never itself offer to relay it further, regardless of what it
 * privately knows.
 *
 * A's OWN screen is honest about what is happening (owner's fixed point 2:
 * A is a knowing participant); nothing here is sent to B directly -- the
 * result of this function is only ever handed to `dispatch.resolve()`,
 * which holds it until the shared fixed deadline `createRelayDispatch`
 * armed at receipt fires. If Jakob answers after that deadline has already
 * fired, `resolve()` below is simply too late (its own doc comment) -- no
 * second message to B, the same discipline D15 already established for the
 * daemon's own relay path ("nothing, then something" is a pattern that
 * occurs ONLY on a relay, and I8 forbids a relay revealing more than a
 * direct request would).
 *
 * Uses gate.ts's own byte-construction primitives directly
 * (maskAnswerPlaintext / truncateSharedJson / sealAnswerEnvelope), NOT
 * decide() -- there is no local MatchResult here to build a payload from;
 * what exists, on success, is a SharedPayload that already arrived,
 * pre-built, from Jakob's OWN decide() call, and is carried onward VERBATIM
 * (see truncateSharedJson's doc comment for why not recomputing `coarseWhen`
 * matters). Byte-identity for every "nothing" cause (declined relay, no
 * note, Jakob declined, Jakob had nothing, Jakob never answered in time)
 * follows from `maskAnswerPlaintext`'s existing mask trick: `wouldShare`
 * false makes `jsonBytes` irrelevant to the output, so every one of those
 * five callers converges on the identical all-zero PLAINTEXT, at identical
 * length, and therefore an identically-shaped envelope. Not identical
 * CIPHERTEXT: since C-02/F-01 the IV is drawn fresh from the CSPRNG on every
 * seal rather than derived from `q.qid`, so the bytes differ per call while
 * the plaintext, the length and the outcome an asker can observe do not --
 * which is what I3 ever rested on (see gate.ts's sealAnswerEnvelope SECURITY
 * note, and test/second_hop_gate.test.ts, which now asserts equal wire
 * length plus byte-identity with the nonce pinned).
 */
async function forwardToOwner(
  q: QueryEnvelope, note: SecondBrainNote, ownerPeer: Peer, dispatch: RelayDispatch,
): Promise<void> {
  const s = state as DeviceState
  shell(t('navAnswer'), el('div', {}, [
    el('p', {}, [
      el('span', { class: 'spin' }),
      document.createTextNode(' ' + t('secondHopForwarding').replace('{who}', note.ownerDisplayName)),
    ]),
  ]))

  const downstreamQid = randomId(12)
  const forwardQ: QueryEnvelope = {
    v: 1, t: 'query',
    from: s.me,
    templateId: q.templateId,
    templateVersion: q.templateVersion,
    qid: downstreamQid,
    issuedAt: Date.now(),
    relayed: true,
    ...(q.freeText ? { freeText: q.freeText } : {}),
  }

  let jakobDecoded: DecodedAnswer | null = null
  if (ownerPeer.did && relayChannel) {
    const ownerKey = await pairKey(ownerPeer)
    const remaining = Math.max(0, dispatch.receivedAt + RELAY_DEADLINE_MS - Date.now())
    const waiter = waitForAnswer(downstreamQid, remaining)
    try {
      await relayChannel.send(ownerPeer.did, forwardQ, ownerKey)
      const env = await waiter.promise
      if (env) jakobDecoded = await interpret(env, ownerKey)
    } catch {
      waiter.cancel()
      jakobDecoded = null
    }
  }

  const shared = jakobDecoded?.outcome === 'shared' ? jakobDecoded.shared : undefined
  // DECISIONS.md D27: the answer B receives is anonymous by default, so the
  // WIRE payload's `from` is always '' here -- never Jakob's real name,
  // never the `note.ownerDisplayName` fallback this line used to substitute
  // when his own answer omitted one. `localFrom` is a SEPARATE value, used
  // only for A's OWN local record (`resolvePayload`'s `localFromLabel`
  // param, I6/D24): she already knows who she reached (that is the whole
  // point of D24, the intermediary sees what she carries), and is entitled
  // to an honest local note of it even though B never learns it.
  //
  // DECISIONS.md D29 (owner): a second-hop answer must never carry a real
  // street address -- a PAYLOAD property, not a rendering one, so it is
  // stripped HERE, before sealing, never relying on a later screen to
  // redact it. `q.templateId` is the ORIGINAL query's own id (unchanged as
  // it crosses to Jakob -- see forwardQ above), so this check is exactly
  // "was the query that reached Jakob the address-bearing one," regardless
  // of how many further hops a future version of this app might add.
  // `accommodationAbstractText()` carries the same free-window fact
  // `matchAccommodation()`'s own hit does, minus `ADDRESS` -- see that
  // function's own doc comment. Every OTHER template's items pass through
  // verbatim, unchanged from before this correction.
  const addressBearingRelay = q.templateId === ACCOMMODATION_TEMPLATE_ID
  const payload: SharedPayload | null = shared
    ? {
        from: '',
        templateId: q.templateId,
        items: addressBearingRelay
          ? shared.items.map((it) => ({ ...it, text: accommodationAbstractText() }))
          : shared.items,
      }
    : null
  const localFrom = shared ? (shared.from || note.ownerDisplayName) : undefined
  const localOutcome: LocalOutcome = payload ? 'relayed' : 'relay-nothing'

  renderSecondHopPendingScreen()
  await dispatch.resolvePayload('relay', payload, localOutcome, localFrom)
}

/** `q.freeText` is always present for this demo's own free-text ask, but a
 *  malformed/templated peer query could theoretically lack it -- fall back
 *  to the resolved template's own question text, same convention emitAnswer
 *  itself uses (`q.freeText ?? tpl.question.de`). */
function tpl_question_fallback(q: QueryEnvelope): string {
  const tpl = resolveIncomingTemplate(q)
  return tpl?.question.de ?? q.templateId
}

/** A's own confirmation screen once her answer to B has actually been sent
 *  -- reuses the SAME strings sendAnswerOverRelay's confirmation does
 *  (relayAnswerSent/relayAnswerSentSub/identicalNote): the wording must not
 *  depend on outcome there either, and there is no reason for demo 21 to
 *  say it differently. */
/**
 * Shown the moment A has tapped a decision (or Jakob's round trip has
 * concluded) but BEFORE the shared fixed deadline has actually fired --
 * closes the stale-UI gap the fixed-deadline dispatch otherwise opens: A's
 * card would sit there, still showing clickable buttons for up to 30
 * seconds after being tapped, if nothing replaced it. Deliberately does NOT
 * say anything about how far the question travelled or what will be sent --
 * only that a decision has been recorded and will go out on the same
 * schedule as every other one (secondHopPending's own i18n doc comment).
 */
function renderSecondHopPendingScreen(): void {
  const body = el('div', {}, [
    el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('secondHopPending'))]),
  ])
  shell(t('navAnswer'), body)
}

function renderSecondHopSentScreen(): void {
  const body = el('div', {}, [
    el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['✓']),
      el('b', {}, [t('relayAnswerSent')]),
      el('span', {}, [t('relayAnswerSentSub')]),
    ]),
    el('p', {}, [t('identicalNote')]),
    el('button', { class: 'btn primary', onclick: () => go('home') }, [t('done')]),
  ])
  shell(t('navAnswer'), body, { back: () => go('home') })
}

/**
 * Decide, log, and send. Every answered query -- manual QR scan, single-peer
 * relay/webrtc ask, AND the ambient silent path -- funnels through this one
 * function, which is what makes "every received query is logged" true by
 * construction rather than by remembering to call a log function at N call
 * sites.
 *
 * `opts.silent` (set only by handleAmbientQuery() for a query that did not
 * clear the anonymity floor / was blocked / could not be resolved) suppresses
 * EVERY render this function or its transport helpers would otherwise do --
 * the opening "checking" shell, and the send helpers' own success/failure
 * screens -- not just the first one. A silent send that still flashed
 * "Antwort gesendet" on success would be the exact demo-breaking bug this
 * feature exists to avoid, so `silent` is threaded all the way to
 * sendAnswerOverRelay/sendAnswerOverWebrtc rather than stopping here. Silent
 * mode implies an ambient transport is already open (relay or webrtc) --
 * there is no silent QR, a code on screen is definitionally not silent -- so
 * a silent call that cannot reach any transport simply does not send;
 * nothing was watching for it to arrive.
 *
 * Logging happens through logAndDispatch() (answer_log.ts), which appends
 * the entry -- and kicks off, but does not await, its persist -- BEFORE the
 * transport dispatch below is even attempted, not after it returns. That
 * used to be reversed ("logging happens LAST, after the wire message has
 * already gone out"), on the theory that whatever appendQueryLog/saveState
 * cost, it must never shift WHEN the answer left this device. That theory
 * was correct about the side channel (appendQueryLog is a plain, O(1),
 * outcome-independent array push, so its position never mattered for
 * timing) but wrong about what it made the log depend on: relay.ts's ingress
 * POST has no timeout, so a stalled send left the entry unwritten
 * indefinitely, not merely late -- reproduced live: the silent device's
 * Protokoll entry was simply missing, not delayed. See answer_log.ts's
 * module doc comment for the full argument and test/answer_log.test.ts for
 * the regression test.
 */
async function emitAnswer(
  q: QueryEnvelope,
  tpl: QueryTemplate,
  match: MatchResult,
  consent: boolean,
  peer: Peer | null,
  opts: {
    silent?: boolean
  } = {},
): Promise<void> {
  // Demo 21 (secondHop) does NOT route through this function at all -- see
  // createRelayDispatch's own doc comment for why a fixed-at-receipt
  // deadline cannot be layered on top of a per-call `t0` here: any ending
  // reached after a human has already taken longer than the window to
  // decide would fire the moment THIS call finally runs, not at the shared
  // instant every other ending on that hop is held to (settleAt's own doc
  // comment: it resolves immediately once its target instant has already
  // passed). An earlier version of this option tried exactly that and was
  // wrong for it; runSecondHopRelayCeremony's own dispatcher is the fix.
  const silent = opts.silent ?? false
  const t0 = Date.now()
  if (!silent) {
    shell(t('navAnswer'), el('div', {}, [
      el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('checking'))]),
    ]))
  }
  // Without a peer record there is no pair key at all, so answerKeyFor()
  // refuses: a throwaway key plus `blocked`, which is one of the four
  // indistinguishable "nothing" reasons. It used to fall back to
  // `derivePairKey(q.qid, q.qid)` here, which anyone who saw the cleartext
  // `qid` could recompute -- and this is the path that reaches the QR rung
  // (`encodeForQr` is plain `JSON.stringify`, no transport encryption at
  // all) and the WebRTC rung (no outer AES-GCM wrap), so the envelope really
  // did go out under a public-derivable key. The plaintext was already the
  // all-zero "nothing" here, so nothing leaked, but an observer who tried
  // the qid key and got a clean decrypt learned that this device holds no
  // record of the asker -- an I3 distinction, told to exactly the wrong
  // party. See answerKeyFor's own doc comment.
  const { key, blocked } = await answerKey(peer, q.qid)
  const { outcome, envelope } = await decide({
    query: q,
    template: tpl,
    match,
    consent,
    blocked,
    key,
    identity: state?.me,
  })
  await settleAt(t0, GATE_BUDGET_MS)

  // The transport choice below never depends on `outcome`/`consent` -- only
  // on whether we know a network address for this peer at all (which rung is
  // even reachable). Branching on the outcome here would reopen exactly the
  // side channel gate.ts's byte padding exists to close (see gate.ts's module
  // doc and this feature's wire-level test in relay.test.ts). That discipline
  // holds across every rung added below, not just the original relay branch.
  // `outcome` is threaded through to the send functions purely so THEY can
  // append a LOCAL chat-log entry strictly AFTER the network send has
  // already gone out (see pushLocalShare's own doc comment) -- it never
  // changes which branch below fires or how long any of them take before
  // sending.
  return logAndDispatch(state, {
    at: Date.now(),
    fromDisplayName: q.from.displayName,
    fromId: q.from.id,
    text: q.freeText ?? tpl.question.de,
    outcome,
  }, async () => {
    // Someone reading Protokoll right now should see this arrive live, same
    // as the chat screen does for an incoming message -- except under
    // `silent`, where nothing renders at all. Fired now (the entry is
    // already appended above) rather than after dispatch, so it no longer
    // depends on dispatch settling either.
    if (!silent && screen === 'log') render()

    const mode = wotMode()
    if (mode === 'relay' && peer?.did && relayChannel) {
      await sendAnswerOverRelay(envelope, peer, key, outcome, tpl, match, silent)
      return
    }
    if ((mode === 'webrtc' || mode === 'ladder') && webrtcChannel?.isOpen()) {
      await sendAnswerOverWebrtc(envelope, outcome, tpl, match, silent)
      return
    }
    if (mode === 'ladder' && peer?.did && relayChannel) {
      await sendAnswerOverRelay(envelope, peer, key, outcome, tpl, match, silent)
      return
    }
    if (mode === 'webrtc' && useRelayFallback && peer?.did && relayChannel) {
      await sendAnswerOverRelay(envelope, peer, key, outcome, tpl, match, silent)
      return
    }
    if (!silent) {
      const payload = encodeForQr(envelope)
      await showCodeScreen(t('showAnswer'), payload, t('answerHint'), () => go('home'), undefined, t('identicalNote'))
      return
    }
    // else: silent with no reachable ambient transport -- nothing sent,
    // nothing shown. Should not happen in practice (handleAmbientQuery only
    // runs for a query that just arrived over an open relay/webrtc channel),
    // but a demo must never throw on an edge case instead of degrading
    // quietly. Already logged above regardless.
  })
}

/**
 * Local-only record of what THIS device just shared, for the chat screen's
 * "Wohnung geteilt" card -- never sent over any wire (chat-signal handover,
 * item 2: "do NOT invent a second transport"). Callers must only invoke this
 * strictly AFTER the answer envelope has already been handed to the
 * transport (see sendAnswerOverRelay/sendAnswerOverWebrtc below): building
 * this list costs CPU proportional to `match.hits.length`, and doing that
 * work before the send -- inside the outcome-independent path emitAnswer
 * above is careful to keep flat -- would reopen a timing side channel the
 * asker could in principle observe. Doing it after the send is invisible to
 * them: the bytes already left.
 */
function pushLocalShare(tpl: QueryTemplate, match: MatchResult): void {
  chatLog.push({
    kind: 'shared',
    mine: true,
    at: Date.now(),
    shared: {
      from: state?.me.displayName ?? '',
      templateId: tpl.id,
      items: match.hits.map((h) => ({
        text: h.message.text,
        when: coarseWhen(h.message.ts, getLang()),
        context: h.threadTitle,
      })),
    },
  })
}

/**
 * Demo 21 (secondHop) only: pushLocalShare's counterpart for A's own chat
 * screen when the content came from a RELAY, not from A's own hits.
 * Deliberately a separate function rather than a second `pushLocalShare`
 * overload: the items here are ALREADY-BUILT `SharedItem`s (Jakob's own
 * `coarseWhen` labels, already computed on HIS device from HIS raw
 * timestamp) and must be recorded VERBATIM -- see gate.ts's
 * `truncateSharedJson` doc comment for why recomputing `coarseWhen` a
 * second time here, from a fabricated `ts`, was rejected as a factual-error
 * risk. Same ordering discipline as pushLocalShare (called strictly after
 * the send -- see that function's doc comment): both of this function's
 * callers already honour it.
 */
function pushLocalShareItems(fromLabel: string, templateId: string, items: SharedItem[]): void {
  chatLog.push({
    kind: 'shared',
    mine: true,
    at: Date.now(),
    shared: { from: fromLabel, templateId, items },
  })
}

/** The asker's mirror of pushLocalShare: the decoded answer already crossed
 *  the wire (that IS the transport -- see the handover's "let the existing
 *  answer... carry it"), so this only ever turns something already
 *  delivered into a chat-log entry. A `nothing` outcome pushes nothing,
 *  same as it renders nothing on screenResult. */
function pushReceivedShare(decoded: DecodedAnswer): void {
  if (decoded.outcome === 'shared' && decoded.shared) {
    chatLog.push({ kind: 'shared', mine: false, at: Date.now(), shared: decoded.shared })
  }
}

/**
 * Rung 2's answer send. No outer AES-GCM wrap here (unlike
 * `sendAnswerOverRelay`, whose `channel.send` re-encrypts under `pairKey` for
 * the relay operator's benefit) -- the data channel is already DTLS-secured
 * end to end, and `envelope.body` is already gate.ts's own AEAD ciphertext
 * regardless of transport. This just moves the same JSON `encodeForQr`
 * produces for a QR code, over the open channel instead.
 */
async function sendAnswerOverWebrtc(
  envelope: AnswerEnvelope,
  outcome: LocalOutcome,
  tpl: QueryTemplate,
  match: MatchResult,
  silent = false,
): Promise<void> {
  const channel = webrtcChannel
  if (!channel || !channel.isOpen()) {
    // Should not happen given the gating in emitAnswer() above, but a demo
    // must never hang on an impossible state. Silent mode: nothing reachable
    // means nothing sent, and definitely no QR fallback -- a code on screen
    // is not silent. Non-silent: fall back to the honest QR.
    if (silent) return
    const payload = encodeForQr(envelope)
    await showCodeScreen(t('showAnswer'), payload, t('answerHint'), () => go('home'), undefined, t('identicalNote'))
    return
  }
  try {
    channel.send(envelope)
  } catch {
    if (silent) return
    const payload = encodeForQr(envelope)
    await showCodeScreen(
      t('showAnswer'), payload,
      t('webrtcTimeout') + ' ' + t('answerHint'),
      () => go('home'), undefined, t('identicalNote'),
    )
    return
  }
  // Strictly after the send above -- see pushLocalShare's doc comment.
  if (outcome === 'shared') pushLocalShare(tpl, match)
  if (silent) return
  // Demo 20 opens the conversation by itself: "the chat window should again
  // open". Long enough to read the confirmation, short enough that nobody has
  // to work out which button continues. Scoped to this scenario so the other
  // demos keep the screen their runbook describes, including its QR fallback.
  const toChat = wotScenario() === 'geologengasse'
    ? setTimeout(() => { if (screen === 'answer') go('link') }, 2600)
    : undefined
  // Same "sent" screen shape (and the SAME strings) as sendAnswerOverRelay --
  // identical wording and structure regardless of outcome (I3), and
  // transport-neutral wording since both rungs use it.
  const body = el('div', {}, [
    el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['✓']),
      el('b', {}, [t('relayAnswerSent')]),
      el('span', {}, [t('relayAnswerSentSub')]),
    ]),
    el('p', {}, [t('identicalNote')]),
    el('button', {
      class: 'btn quiet',
      onclick: () => void showCodeScreen(t('showAnswer'), encodeForQr(envelope), t('answerHint'), () => go('home'), undefined, t('identicalNote')),
    }, [t('showQrInstead')]),
    // He asked for this to land him in the conversation, not home: the next
    // thing he does in real life is tell the person the exact house number.
    // See DEVLOG/handover-chat-signal.md item 1.
    el('button', { class: 'btn primary', onclick: () => { clearTimeout(toChat); go('link') } }, [t('navChatNow')]),
  ])
  shell(t('navAnswer'), body, { back: () => { clearTimeout(toChat); go('home') } })
}

async function sendAnswerOverRelay(
  envelope: AnswerEnvelope,
  peer: Peer,
  pairKeyForPeer: CryptoKey,
  outcome: LocalOutcome,
  tpl: QueryTemplate,
  match: MatchResult,
  silent = false,
): Promise<void> {
  const peerDid = peer.did as string
  try {
    await (relayChannel as RelayChannel).send(peerDid, envelope, pairKeyForPeer)
  } catch {
    // Delivery failed outright (network down, relay unreachable) -- this is
    // a transport fact, not a content signal, and it is equally possible
    // regardless of outcome. Silent mode: nothing to show, so nothing to do
    // but swallow it -- a demo device asked ambiently has nobody watching
    // for a failure screen. Non-silent: fall back to the honest QR path
    // rather than claiming a delivery that did not happen.
    if (silent) return
    const payload = encodeForQr(envelope)
    await showCodeScreen(
      t('showAnswer'), payload,
      t('relaySendFailed') + ' ' + t('answerHint'),
      () => go('home'), undefined, t('identicalNote'),
    )
    return
  }
  // Strictly after the send above -- see pushLocalShare's doc comment.
  if (outcome === 'shared') pushLocalShare(tpl, match)
  if (silent) return
  // Demo 20 opens the conversation by itself: "the chat window should again
  // open". Long enough to read the confirmation, short enough that nobody has
  // to work out which button continues. Scoped to this scenario so the other
  // demos keep the screen their runbook describes, including its QR fallback.
  // Only auto-open when nobody else is waiting: a queued second question is
  // the more urgent thing on screen and must not be swept away by a timer.
  const toChat = wotScenario() === 'geologengasse' && pendingGeoQueries.length === 0
    ? setTimeout(() => { if (screen === 'answer') go('link') }, 2600)
    : undefined
  // This confirmation screen is the SAME for every outcome -- it only ever
  // says "sent", never what was sent or whether anything was found.
  const moreQueued = wotScenario() === 'geologengasse' && pendingGeoQueries.length > 0
  const body = el('div', {}, [
    el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['✓']),
      el('b', {}, [t('relayAnswerSent')]),
      el('span', {}, [t('relayAnswerSentSub')]),
    ]),
    el('p', {}, [t('identicalNote')]),
    el('button', {
      class: 'btn quiet',
      onclick: () => void showCodeScreen(t('showAnswer'), encodeForQr(envelope), t('answerHint'), () => go('home'), undefined, t('identicalNote')),
    }, [t('showQrInstead')]),
    // Demo 20: another person's question is already queued -- offer to go
    // straight to it instead of forcing a detour through home. Never
    // renders for any other demo (pendingGeoQueries is always empty there).
    moreQueued
      ? el('button', { class: 'btn primary', onclick: () => { clearTimeout(toChat); go('answer') } }, [t('geoNextQuery')])
      : null,
    // Land in the conversation, not home -- see the item-1 note above.
    el('button', {
      class: moreQueued ? 'btn' : 'btn primary',
      onclick: () => { clearTimeout(toChat); go('link') },
    }, [t('navChatNow')]),
  ])
  shell(t('navAnswer'), body, { back: () => { clearTimeout(toChat); go('home') } })
}

// ---------------------------------------------------------------------------
// shared sub-screens: show a code, scan a code
// ---------------------------------------------------------------------------

async function showCodeScreen(
  title: string,
  payload: string,
  hint: string,
  back: () => void,
  next?: { label: string; action: () => void },
  footnote?: string,
): Promise<void> {
  // data-payload lets the headless end-to-end test read the code without a
  // camera. It is the same string the QR encodes and the same string the copy
  // button copies, so the test exercises the real wire format.
  const wrap = el('div', { class: 'qrwrap', 'data-payload': payload })
  const body = el('div', {}, [
    el('h1', {}, [title]),
    el('p', { class: 'lead' }, [hint]),
    wrap,
    next ? el('button', { class: 'btn primary', onclick: next.action }, [next.label]) : null,
    el('button', { class: 'btn quiet', onclick: () => void copyText(payload) }, [t('copyCode')]),
    footnote ? el('div', { class: 'note' }, [footnote]) : null,
    el('button', { class: 'btn quiet', onclick: back }, [t('back')]),
  ])
  shell(title, body, { back })
  await renderQr(wrap, payload)
  releaseWake = await keepAwake()
}

async function copyText(s: string): Promise<void> {
  try { await navigator.clipboard.writeText(s); alert(t('copied')) }
  catch { prompt(t('copyCode'), s) }
}

type ScanOutcome = { ok: true } | { ok: false; msg: string }

async function scanScreen(
  title: string,
  onText: (text: string) => Promise<ScanOutcome>,
  back: () => void,
): Promise<void> {
  const video = el('video', { class: 'scanner', playsinline: true, muted: true }) as HTMLVideoElement
  const errBox = el('div', {})
  const pasteArea = el('textarea', {
    rows: 3,
    placeholder: t('pasteHere'),
    style: 'width:100%;border-radius:14px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);padding:12px;font:inherit;margin-bottom:12px',
  }) as HTMLTextAreaElement

  const busy = el('div', { class: 'busy', style: 'display:none' }, [t('scanCaught')])
  const hint = el('p', {}, [t('scanning')])

  /**
   * The black-box fix.
   *
   * `scanQr` calls `stop()` the instant it decodes, which stops the camera
   * tracks -- so the <video> element is left showing a dead black rectangle.
   * Whatever happens next can take seconds (accepting a WebRTC offer gathers
   * ICE candidates before it can produce an answer), and during that time the
   * screen said nothing at all. Reported from a real phone as "I scanned the
   * code and then the camera box went black".
   *
   * So the moment a code is caught, the camera view is replaced by a line that
   * says it was caught and something is happening. On failure the camera comes
   * back with the error; on success the caller navigates away.
   */
  const showBusy = (on: boolean): void => {
    busy.style.display = on ? '' : 'none'
    video.style.display = on ? 'none' : ''
    hint.style.display = on ? 'none' : ''
  }

  const handle = async (text: string, restart: boolean): Promise<void> => {
    clear(errBox)
    showBusy(true)
    let r: ScanOutcome
    try {
      r = await onText(text.trim())
    } catch (err) {
      // An exception here used to surface as nothing at all. It is the most
      // likely outcome when a peer connection cannot be established.
      r = { ok: false, msg: `${t('scanFailed')} ${err instanceof Error ? err.message : String(err)}` }
    }
    if (!r.ok) {
      showBusy(false)
      errBox.appendChild(el('div', { class: 'err' }, [r.msg]))
      // The error box sits above the camera view, which on a phone is often
      // scrolled out of sight by the time a scan fails. An error nobody sees
      // is the same as no error at all.
      errBox.scrollIntoView({ block: 'center', behavior: 'smooth' })
      if (restart) start()
    }
  }

  let stop: () => void = () => {}
  const start = () => {
    showBusy(false)
    if (!cameraPlausible()) {
      clear(errBox)
      errBox.appendChild(el('div', { class: 'err' }, [t('camDenied')]))
      video.style.display = 'none'
      return
    }
    const h = scanQr(video, (text) => { void handle(text, true) })
    stop = h.stop
    h.ready.catch(() => {
      clear(errBox)
      errBox.appendChild(el('div', { class: 'err' }, [t('camDenied')]))
      video.style.display = 'none'
    })
  }

  const body = el('div', {}, [
    el('h1', {}, [title]),
    errBox,
    video,
    busy,
    hint,
    el('h2', {}, [t('camPaste')]),
    pasteArea,
    el('button', { class: 'btn', onclick: () => void handle(pasteArea.value, false) }, [t('useCode')]),
    el('button', { class: 'btn quiet', onclick: () => { stop(); back() } }, [t('back')]),
  ])
  shell(title, body, { back: () => { stop(); back() } })
  start()
}

// ---------------------------------------------------------------------------
// the live link: a conversation and a probe
//
// Neither is part of the query protocol. They exist because "Verbunden (seit
// 09:57:33)" is a claim, and a person holding two devices has no way to check
// it. Typing a word on one and watching it appear on the other is proof; the
// probe puts a number next to it. Both travel the same path a query would, so
// if these work the query path works.
// ---------------------------------------------------------------------------

function screenLink(): void {
  unreadChat = 0
  const s = state as DeviceState
  const peer = s.peers[0]
  // Shown once, right after a confirmation, on whichever side just learned
  // about it. A connection that completes silently reads as one that did not
  // complete at all -- the whole reason this banner exists.
  const banner = justAccepted
    ? el('div', { class: 'outcome shared' }, [
        el('div', { class: 'glyph' }, ['\u2713']),
        el('b', {}, [t('linkNowConnected')]),
        el('span', {}, [t('scanOkWith') + ' ' + justAccepted]),
      ])
    : null
  justAccepted = null

  const result = el('div', {})
  const say = (node: HTMLElement): void => { clear(result); result.appendChild(node) }

  const send = (text: string): void => {
    chatLog.push({ kind: 'text', mine: true, text, at: Date.now() })
    render()
    void sendOverActiveTransport({ v: 1, t: 'chat', from: s.me, text, ts: Date.now() }).catch((err: unknown) => {
      chatLog.push({
        kind: 'text',
        mine: true,
        text: t('linkSendFailed') + ' ' + (err instanceof Error ? err.message : ''),
        at: Date.now(),
      })
      render()
    })
  }

  const test = async (): Promise<void> => {
    const id = randomId(10)
    say(el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('linkTesting'))]))
    const ms = await new Promise<number | null>((resolve) => {
      pendingPing = { id, sentAt: Date.now(), resolve: (v) => resolve(v) }
      const timer = setTimeout(() => { pendingPing = null; resolve(null) }, 10000)
      void sendOverActiveTransport({ v: 1, t: 'ping', id, back: false })
        .then((rung) => { lastTestRung = rung })
        .catch(() => { clearTimeout(timer); pendingPing = null; resolve(null) })
    })
    pendingPing = null
    if (ms === null) {
      say(el('div', { class: 'err' }, [t('linkTestFailed')]))
      return
    }
    say(el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['\u2713']),
      el('b', {}, [t('linkTestOk')]),
      el('span', {}, [`${ms} ms \u00b7 ${lastTestRung === 'webrtc' ? t('linkViaDirect') : t('linkViaServer')}`]),
    ]))
  }

  // Which of i18n.ts's two existing honesty strings actually describes this
  // conversation right now: webrtc when the direct channel is open (demo
  // 3/6), relay otherwise (demo 2/20). Never a new claim of its own -- see
  // renderSecurityInfo's doc comment.
  const securityExplain = webrtcChannel?.isOpen() ? t('webrtcExplain') : t('relayExplain')

  const body = el('div', {}, [
    el('h1', {}, [peer?.displayName ?? t('navLink')]),
    banner,
    el('div', { class: 'chat-toolbar' }, [
      el('button', { class: 'btn quiet', onclick: () => void test() }, [t('linkTestBtn')]),
      renderSecurityInfo(securityExplain),
    ]),
    result,
    renderMessageList(chatLog, resolveTemplate),
    renderComposer(t('linkPlaceholder'), send),
  ])
  shell(t('navLink'), body, { back: () => go('home') })
}

let lastTestRung: 'webrtc' | 'relay' = 'relay'

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

/**
 * Register the offline worker. Never let it break the boot: if registration
 * fails for any reason, the app must still start.
 */
function registerWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return
  window.addEventListener('load', () => {
    // BASE_URL, not document.baseURI: without a <base> tag baseURI is the page
    // URL, so visiting the app without its trailing slash would resolve the
    // worker one directory too high. Same class of bug as the relative asset
    // paths that shipped a black page to a phone.
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => undefined)
  })
}

/**
 * Disarm the blank-page tripwire in index.html. Called as boot's first act:
 * from here on the app owns what is on screen, so the tripwire's six-second
 * deadline must not fire over a perfectly healthy demo.
 */
function markBooted(): void {
  const w = window as Window & { __wotBooted?: () => void }
  try { w.__wotBooted?.() } catch { /* the tripwire is a safety net, never a dependency */ }
}

/**
 * Last-resort error screen, built with raw DOM and inline styles on purpose:
 * it must render even when the module that normally draws screens is the thing
 * that failed. A demo that dies must say why on the device holding it — a
 * black page in someone's hand is the worst possible failure mode.
 */
function bootFailed(err: unknown): void {
  const app = document.getElementById('app')
  if (!app) return
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  app.innerHTML = ''
  const box = document.createElement('div')
  box.setAttribute('style', 'padding:24px;font:15px/1.55 system-ui,sans-serif;color:#e9eef4')
  const h = document.createElement('h1')
  h.setAttribute('style', 'font-size:20px;margin:0 0 10px')
  h.textContent = 'Die Demo konnte nicht starten.'
  const p = document.createElement('p')
  p.setAttribute('style', 'color:#9fb0c0;margin:0 0 14px')
  p.textContent = 'Bitte diesen Text abfotografieren und weitergeben:'
  const pre = document.createElement('pre')
  pre.setAttribute('style', 'white-space:pre-wrap;word-break:break-word;background:#171d24;border:1px solid #28323d;border-radius:10px;padding:12px;font-size:12.5px;color:#e9eef4')
  pre.textContent = [
    detail,
    `secureContext: ${String(window.isSecureContext)}`,
    `indexedDB: ${(() => { try { return globalThis.indexedDB ? 'present' : 'absent' } catch { return 'blocked' } })()}`,
    `localStorage: ${(() => { try { void localStorage.length; return 'present' } catch { return 'blocked' } })()}`,
    `ua: ${navigator.userAgent}`,
  ].join('\n')
  box.append(h, p, pre)
  app.appendChild(box)
}

async function boot(): Promise<void> {
  markBooted()
  registerWorker()
  initI18n()
  state = await loadState()
  // Demo 20: "no persona picker" on the laptop (handover) means the laptop
  // never shows screenStart() at all. The one case that reaches boot() with
  // no state AND no pending connect link IS the laptop opening this build
  // for the first time -- an invited phone always arrives WITH a connect
  // link (screenGeoNameEntry handles that case via the ordinary
  // `screen = 'start'` path below).
  //
  // Three modes (handover-three-modes.md): Jakob picks his mode too, on
  // every device including this one -- so the seed call itself is deferred
  // to screenModePick's own "Los geht's" button (finishJakobOnboarding),
  // not run here. This only records WHICH seed function is waiting
  // (pendingJakobSeedKind) and routes to that screen instead of seeding
  // directly. An invited phone is unaffected: it always has a
  // pendingConnectLink, so neither branch below ever fires for it, and its
  // own mode choice lives inline on screenGeoNameEntry/
  // screenSecondHopNameEntry instead.
  if (!state && wotScenario() === 'geologengasse' && !pendingConnectLink) {
    pendingJakobSeedKind = 'geo'
  }
  // Demo 21 (secondHop): same reasoning, same shape -- Jakob's laptop is
  // this chain's root too, the only device that ever opens this build with
  // no state and no pending link.
  if (!state && wotScenario() === 'secondHop' && !pendingConnectLink) {
    pendingJakobSeedKind = 'secondHop'
  }
  screen = state ? 'home' : (pendingJakobSeedKind ? 'modePick' : 'start')
  render()
  // A returning session (state already on disk) that ALSO happens to have
  // opened this tab via a fresh connect link -- unusual (the ordinary case
  // is a brand-new phone, handled in seedPersona() instead, since a
  // first-visit device has no state yet for boot() to find), but a device
  // already paired to someone else can still be re-pointed at a new peer
  // this way. Otherwise: fire-and-forget, a returning session opens its
  // relay drain in the background while the home screen renders
  // immediately. Both are no-ops in qr mode; `initRelaySession()` is also a
  // no-op when state is null (first visit -- seedPersona() opens it once a
  // persona is picked instead).
  if (state && pendingConnectLink) {
    void completeConnectLinkIfPending()
  } else {
    void initRelaySession()
  }
}

void boot().catch((err: unknown) => {
  console.error('[boot] fatal', err)
  bootFailed(err)
})
