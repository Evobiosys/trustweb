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
import { interpret, RELAY_DEADLINE_MS, settleAt } from '../../demo/src/gate'
import { sealRelayAnswer } from '../../demo/src/answer_key'
import { classifyIncomingQuery } from '../../demo/src/incoming_query'
import { matchTemplate } from '../../demo/src/match/lexical'
import { FREE_TEXT_MAX_LEN } from '../../demo/src/types'
import type { AnswerEnvelope, ChatEnvelope, DecodedAnswer, MatchResult, QueryEnvelope, SharedPayload } from '../../demo/src/types'
import { askTemplate } from './lexicon'
import { LogOutcome, coarseWhen, threadsForRing } from './model'
import type { AppState, LineRef, MatchScope, Peer, Ring } from './model'

export type { RelayStatus }

export const ANSWER_WINDOW_MS = RELAY_DEADLINE_MS
const ASK_TIMEOUT_MS = 180_000
const RELEVANCE_BAND = 0.5
const MAX_SHARED = 3

export interface IncomingAsk {
  qid: string
  fromName: string
  text: string
  matches: LineRef[]
  receivedAt: number
  /** Forwarded by a front-door peer (services/trustweb-peer) on behalf of somebody who asked it. */
  relayed: boolean
  decide(share: boolean): Promise<void>
}

export interface AskResult {
  peerId: string
  peerName: string
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
  /** The other side of the hold: a peer we already hold sent its ack again, i.e. the owner allowed us. */
  onPeerConfirmed(peer: Peer): void
  /** Ring for a peer who just scanned this device's code. */
  ringForNewPeer(): Ring
  onLogChanged(): void
  /** What this asker may be matched against; undefined = everything their ring admits. */
  askScope(peer: Peer): MatchScope | undefined
  /** A connected peer sent a text inside TrustWeb (today: a link to a meeting they shared). */
  onText(peer: Peer, text: string, ts: number): void
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

export class Net {
  private channel: RelayChannel | null = null
  private identity: DidIdentity | null = null
  private keys = new Map<string, Promise<CryptoKey>>()
  private awaiting = new Map<string, (env: AnswerEnvelope) => void>()
  private seenQids = new Set<string>()
  private starting: Promise<void> | null = null

  constructor(private readonly hooks: NetHooks) {}

  /** This device's relay identity, minted once and kept in the app's own record. */
  private ensureIdentity(): DidIdentity {
    if (this.identity) return this.identity
    const s = this.hooks.state()
    if (s.identity) {
      this.identity = deserializeIdentity(s.identity)
    } else {
      this.identity = createIdentity(location.origin + '/relay')
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

  /** Opens the relay drain once; safe to call repeatedly. */
  start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = (async () => {
      const identity = this.ensureIdentity()
      const channel = createRelayChannel()
      this.channel = channel
      channel.onStatus((status) => this.hooks.onStatus(status))
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
    })()
    return this.starting
  }

  /** Closes the relay drain for good: after a hand-over the identity lives on another phone. */
  stop(): void {
    this.channel?.close()
    this.channel = null
    this.starting = null
  }

  /** The URL a phone camera opens to connect to this device (one scan). */
  connectLink(appUrl: string): string {
    return buildConnectLinkUrl(appUrl, this.ensureIdentity().did, this.hooks.state().me)
  }

  /** The scanning side of the one-scan ceremony: add the peer, tell them who we are. */
  async completeConnect(params: ConnectLinkParams, ring: Ring): Promise<Peer> {
    const s = this.hooks.state()
    const identity = this.ensureIdentity()
    const peer = upsertPeer(s, {
      id: params.from.id,
      displayName: params.from.displayName || 'Someone',
      did: params.did,
      ring,
      connectedAt: Date.now(),
    })
    this.hooks.save()
    await this.start()
    try {
      await this.channel?.sendRaw(params.did, encodeForQr(buildConnectAck(s.me, identity)))
    } catch {
      /* the peer is saved; the other phone learns of us on its next successful ack */
    }
    return peer
  }

  /** Only a cleartext connect-ack is ever recognised here; every other wire is ciphertext. */
  private handleRaw(fromDid: string, payload: string): boolean {
    const env = decodeFromQr(payload)
    if (!env || env.t !== 'connect-ack' || env.did !== fromDid) return false
    const s = this.hooks.state()
    const known = this.peerByDid(env.did)
    const incoming: Peer = {
      id: env.from.id,
      displayName: env.from.displayName || 'Someone',
      did: env.did,
      ring: known?.ring ?? this.hooks.ringForNewPeer(),
      connectedAt: Date.now(),
    }
    if (known) {
      this.hooks.onPeerConfirmed(upsertPeer(s, incoming))
      this.hooks.save()
      return true
    }
    if (this.hooks.holdPeer(incoming)) return true
    const peer = upsertPeer(s, incoming)
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
    try {
      await this.channel?.sendRaw(peer.did, encodeForQr(buildConnectAck(s.me, this.ensureIdentity())))
    } catch {
      /* the peer is saved either way; that phone just does not learn of the yes until its next ask is answered */
    }
    return peer
  }

  private async handleEnvelope(env: Envelope, fromDid: string): Promise<void> {
    if (env.t === 'answer') {
      this.awaiting.get(env.qid)?.(env)
      return
    }
    if (env.t === 'query') await this.handleQuery(env, fromDid)
    if (env.t === 'chat') {
      const peer = this.peerByDid(fromDid)
      if (peer) this.hooks.onText(peer, env.text, env.ts)
    }
    // ping is deliberately ignored: no chat in this build, only a shared meeting's link.
  }

  /** A short text to one connected peer, sealed with the pair key (apps/demo's chat envelope, 500 characters at most). */
  async sendText(peer: Peer, text: string): Promise<void> {
    await this.start()
    const env: ChatEnvelope = { v: 1, t: 'chat', from: this.hooks.state().me, text, ts: Date.now() }
    const key = await this.pairKey(peer)
    if (!this.channel) throw new Error('relay not connected')
    await this.channel.send(peer.did, env, key)
  }

  private log(peer: Peer, text: string, outcome: LogOutcome): void {
    const s = this.hooks.state()
    s.log.unshift({ id: randomId(8), at: Date.now(), from: peer.displayName, text, outcome, peerId: peer.id })
    s.log = s.log.slice(0, 50)
    this.hooks.save()
    this.hooks.onLogChanged()
  }

  private async handleQuery(q: QueryEnvelope, fromDid: string): Promise<void> {
    if (this.seenQids.has(q.qid)) return
    this.seenQids.add(q.qid)
    const receivedAt = Date.now()
    const peer = this.peerByDid(fromDid)
    if (!peer || !this.channel) return
    const text = q.freeText ?? ''
    const tpl = askTemplate(text)
    const { threads, refs } = threadsForRing(this.hooks.state(), peer.ring, this.hooks.askScope(peer))
    const match = text ? prune(matchTemplate(tpl, threads)) : { hits: [], distinctAuthors: 0, aboveThreshold: false }
    const { surface } = classifyIncomingQuery(match, false, Boolean(text))
    const key = await this.pairKey(peer)

    const answer = async (payload: SharedPayload | null): Promise<void> => {
      await settleAt(receivedAt, ANSWER_WINDOW_MS)
      const env = await sealRelayAnswer(q.qid, tpl.id, payload, { key, blocked: false })
      try { await this.channel?.send(peer.did, env, key) } catch { /* asker times out and sees "no match" */ }
    }

    if (!surface) {
      this.log(peer, text, LogOutcome.NoMatch)
      await answer(null)
      return
    }

    const matches = match.hits
      .map((h) => refs.get(h.threadId))
      .filter((r): r is LineRef => Boolean(r))
    let decided = false
    this.hooks.onAsk({
      qid: q.qid,
      fromName: peer.displayName,
      text,
      matches,
      receivedAt,
      relayed: q.relayed === true,
      decide: async (share: boolean) => {
        if (decided) return
        decided = true
        this.log(peer, text, share ? LogOutcome.Shared : LogOutcome.Declined)
        const payload: SharedPayload | null = share
          ? {
              from: this.hooks.state().me.displayName,
              templateId: tpl.id,
              items: matches.map((m) => ({ text: m.text, when: coarseWhen(m.at), context: m.context })),
            }
          : null
        await answer(payload)
      },
    })
  }

  /** Ask every connected peer; resolves once every answer is in or has timed out. */
  async ask(text: string): Promise<AskResult[]> {
    await this.start()
    const s = this.hooks.state()
    const freeText = text.trim().slice(0, FREE_TEXT_MAX_LEN)
    return Promise.all(s.peers.map(async (peer): Promise<AskResult> => {
      const q: QueryEnvelope = {
        v: 1, t: 'query', from: s.me,
        templateId: askTemplate(freeText).id, templateVersion: 1,
        qid: randomId(12), issuedAt: Date.now(), freeText,
      }
      const key = await this.pairKey(peer)
      const answered = new Promise<AnswerEnvelope | null>((resolve) => {
        const timer = setTimeout(() => { this.awaiting.delete(q.qid); resolve(null) }, ASK_TIMEOUT_MS)
        this.awaiting.set(q.qid, (env) => { clearTimeout(timer); this.awaiting.delete(q.qid); resolve(env) })
      })
      try {
        await this.channel?.send(peer.did, q, key)
      } catch {
        this.awaiting.get(q.qid)?.({ v: 1, t: 'answer', qid: q.qid, body: '' })
      }
      const env = await answered
      return { peerId: peer.id, peerName: peer.displayName, decoded: env ? await interpret(env, key) : null }
    }))
  }
}
