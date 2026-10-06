/**
 * trustweb-peer: an always-on TrustWeb peer that holds an inventory and answers
 * asks over the existing relay with the existing gate (owner, Omi walk
 * 2026-10-06: "people should be able to query my inventory", "the demo content
 * should be on the Swiss server, a personal one on the German server").
 *
 * It is a phone without a person at it. Everything on the wire is what a
 * phone sends: the did:peer:2 identity (apps/demo/src/did.ts), the relay drain
 * (relay.ts), the one-scan connect-ack (connect_link.ts), the matcher
 * (match/lexical.ts), the surface-or-stay-silent decision (incoming_query.ts)
 * and the sealed fixed-length answer in which "nothing matched" and "not
 * shared" are the same bytes, sent no earlier than RELAY_DEADLINE_MS after
 * the ask arrived (gate.ts). Reused, not copied.
 *
 * What differs from a phone: nobody taps "Share". A line is shared when its
 * audience admits the asker's ring (model.ts audienceAdmits), the same rule a
 * phone applies BEFORE it asks its owner; here that rule is the whole
 * decision. So the content behind a peer must be content its owner has
 * already decided to share with everyone it connects with. Two instances:
 *
 *   demo      PeerPolicy.Open: anyone who opens its connect link is a peer
 *             (acquaintance ring); fictional inventory only (demo_inventory.json);
 *             meant for the Swiss server next to the app (app.idea2.site).
 *   personal  PeerPolicy.Granted: a connect-ack is honoured only for a name
 *             the owner granted beforehand (grants.json, written by the owner's
 *             tooling; the owner's phone does not yet send grants over the
 *             wire). Meant for the German server (sebra). NOT deployed by this
 *             pass: see the design note in the result report.
 *
 * Privacy on this host: no ask text is ever logged (asks come from real people);
 * the log has counts and outcomes only. The inventory file is read once at
 * start and on SIGHUP.
 *
 * Run (from the repo root; tsx comes with the workspace):
 *   TW_PEER_STATE=/tmp/twpeer TW_PEER_INVENTORY=services/trustweb-peer/demo_inventory.json \
 *   TW_PEER_RELAY=https://app.idea2.site node_modules/.bin/tsx services/trustweb-peer/peer.ts
 * It writes <state>/demo-peer.json, the card a TrustWeb app reads to put this
 * peer into a demo-account link (apps/trustweb/src/demo_account.ts).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import path from 'node:path'
import { createIdentity, deserializeIdentity, ecdhSharedSecret, serializeIdentity } from '../../apps/demo/src/did'
import type { Identity as DidIdentity } from '../../apps/demo/src/did'
import { createRelayChannel } from '../../apps/demo/src/relay'
import type { RelayChannel, RelayStatus } from '../../apps/demo/src/relay'
import { deriveEcdhPairKey, randomId } from '../../apps/demo/src/crypto'
import { decodeFromQr } from '../../apps/demo/src/wire'
import type { Envelope } from '../../apps/demo/src/wire'
import { RELAY_DEADLINE_MS, settleAt } from '../../apps/demo/src/gate'
import { sealRelayAnswer } from '../../apps/demo/src/answer_key'
import { classifyIncomingQuery } from '../../apps/demo/src/incoming_query'
import { matchTemplate } from '../../apps/demo/src/match/lexical'
import type { MatchResult, QueryEnvelope, SharedPayload } from '../../apps/demo/src/types'
import { askTemplate } from '../../apps/trustweb/src/lexicon'
import { Audience, AUDIENCES, Ring, coarseWhen, threadsForRing } from '../../apps/trustweb/src/model'
import type { AppState, InventoryItem, LineRef, Peer } from '../../apps/trustweb/src/model'

export enum PeerPolicy {
  /** Anyone who opens the connect link becomes a peer (the demo inventory). */
  Open = 'open',
  /** Only names granted beforehand (grants.json) become peers (the personal inventory). */
  Granted = 'granted',
}

export enum AskOutcome {
  NoMatch = 'no-match',
  Shared = 'shared',
  RateLimited = 'rate-limited',
}

export interface PeerOptions {
  /** Where identity.json, peers.json and demo-peer.json live. */
  stateDir: string
  /** The inventory file: { "items": [{ "text", "audience" }] }. */
  inventoryFile: string
  /** The relay's origin (the app's origin in production: https://app.idea2.site). */
  relayOrigin: string
  name?: string
  policy?: PeerPolicy
  /** Loopback health server port; 0 = none. */
  healthPort?: number
  maxPeers?: number
  asksPerHour?: number
  log?: (line: string) => void
}

/** The card a TrustWeb app reads (apps/trustweb/src/demo_account.ts isDemoPeerRef). */
export interface PeerCard {
  did: string
  id: string
  name: string
}

export interface RunningPeer {
  card: PeerCard
  status(): RelayStatus
  peerCount(): number
  stop(): Promise<void>
}

interface PeerState {
  me: { id: string; displayName: string }
  identity: ReturnType<typeof serializeIdentity>
  peers: Peer[]
}

const DEFAULT_NAME = 'Demo inventory'
const DEFAULT_MAX_PEERS = 500
const DEFAULT_ASKS_PER_HOUR = 30
const HOUR_MS = 3_600_000
/** apps/demo's prune(): keep the relevance band, at most three lines (net.ts). */
const RELEVANCE_BAND = 0.5
const MAX_SHARED = 3

function prune(m: MatchResult): MatchResult {
  if (!m.hits.length) return m
  const top = m.hits[0].score
  return { ...m, hits: m.hits.filter((h) => h.score >= top * RELEVANCE_BAND).slice(0, MAX_SHARED) }
}

function isAudience(v: unknown): v is Audience {
  return typeof v === 'string' && (AUDIENCES as readonly string[]).includes(v)
}

/** Reads the inventory file; a malformed line is skipped, never guessed at. */
export function loadInventory(file: string, now: number): InventoryItem[] {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const items = (raw as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const out: InventoryItem[] = []
  for (const it of items) {
    const o = it as Record<string, unknown>
    if (typeof o.text !== 'string' || !o.text.trim() || !isAudience(o.audience)) continue
    out.push({ id: randomId(8), text: o.text.trim().slice(0, 160), audience: o.audience, included: true, createdAt: now })
  }
  return out
}

/** The names a Granted peer honours: { "names": ["anna-test", ...] }, compared case-insensitively. */
export function loadGrants(stateDir: string): Set<string> {
  const file = path.join(stateDir, 'grants.json')
  if (!existsSync(file)) return new Set()
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const names = (raw as { names?: unknown }).names
  return new Set(Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string').map((n) => n.toLowerCase()) : [])
}

/** Sliding one-hour window per asker; the limit is per connected peer, not global. */
export class AskRateLimit {
  private readonly seen = new Map<string, number[]>()
  constructor(private readonly perHour: number) {}
  allow(did: string, now: number): boolean {
    const recent = (this.seen.get(did) ?? []).filter((t) => now - t < HOUR_MS)
    if (recent.length >= this.perHour) { this.seen.set(did, recent); return false }
    recent.push(now)
    this.seen.set(did, recent)
    return true
  }
}

function loadState(stateDir: string, relayOrigin: string, name: string): PeerState {
  const file = path.join(stateDir, 'state.json')
  if (existsSync(file)) {
    const s = JSON.parse(readFileSync(file, 'utf8')) as PeerState
    if (s && s.me && s.identity && Array.isArray(s.peers)) return { ...s, me: { ...s.me, displayName: name } }
  }
  const identity = createIdentity(relayOrigin + '/relay')
  return { me: { id: randomId(12), displayName: name }, identity: serializeIdentity(identity), peers: [] }
}

function saveState(stateDir: string, s: PeerState): void {
  const file = path.join(stateDir, 'state.json')
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
  writeFileSync(file, readFileSync(tmp), { mode: 0o600 })
}

/** Loopback only; the Host header must be loopback too and no Origin is accepted (local-service rule). */
function healthServer(port: number, card: PeerCard, status: () => RelayStatus, peers: () => number): Promise<Server> {
  const srv = createServer((req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || req.headers.origin !== undefined) {
      res.writeHead(421).end()
      return
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return }
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return }
    if (req.url === '/card') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(card)); return }
    if (req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ relay: status(), peers: peers() }))
      return
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)))
}

export async function startPeer(opts: PeerOptions): Promise<RunningPeer> {
  const name = opts.name ?? DEFAULT_NAME
  const policy = opts.policy ?? PeerPolicy.Open
  const maxPeers = opts.maxPeers ?? DEFAULT_MAX_PEERS
  const log = opts.log ?? ((line: string): void => { console.log(new Date().toISOString() + ' ' + line) })
  mkdirSync(opts.stateDir, { recursive: true, mode: 0o700 })
  const state = loadState(opts.stateDir, opts.relayOrigin, name)
  const identity: DidIdentity = deserializeIdentity(state.identity)
  let inventory = loadInventory(opts.inventoryFile, Date.now())
  let grants = loadGrants(opts.stateDir)
  const limiter = new AskRateLimit(opts.asksPerHour ?? DEFAULT_ASKS_PER_HOUR)
  const keys = new Map<string, Promise<CryptoKey>>()
  const seenQids = new Set<string>()
  let relayStatus: RelayStatus = 'connecting'

  const card: PeerCard = { did: identity.did, id: state.me.id, name }
  writeFileSync(path.join(opts.stateDir, 'demo-peer.json'), JSON.stringify(card) + '\n')
  saveState(opts.stateDir, state)

  /** What the matcher sees: this peer's inventory, nobody's notes. */
  const asAppState = (): AppState => ({
    v: 1, me: state.me, peers: state.peers, people: [], inventory, log: [], notificationsOn: false,
  })

  const pairKey = (did: string): Promise<CryptoKey> => {
    let k = keys.get(did)
    if (!k) {
      k = deriveEcdhPairKey(ecdhSharedSecret(identity, did))
      keys.set(did, k)
    }
    return k
  }
  const peerByDid = (did: string): Peer | undefined => state.peers.find((p) => p.did === did)

  const reload = (): void => {
    try {
      inventory = loadInventory(opts.inventoryFile, Date.now())
      grants = loadGrants(opts.stateDir)
      log(`reloaded: ${inventory.length} items, ${grants.size} grants`)
    } catch (e) {
      log('reload failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  }
  process.on('SIGHUP', reload)

  const channel: RelayChannel = createRelayChannel({ relayOrigin: opts.relayOrigin })
  channel.onStatus((s) => { relayStatus = s; log('relay ' + s) })

  // The one cleartext wire: "someone opened my link". Open policy: welcome;
  // Granted policy: only a name on the grant list. An unknown DID that is
  // not welcome is left un-acked and forgotten.
  channel.onRawWire((fromDid, payload) => {
    const env = decodeFromQr(payload)
    if (!env || env.t !== 'connect-ack' || env.did !== fromDid) return false
    const known = peerByDid(env.did)
    if (!known) {
      if (policy === PeerPolicy.Granted && !grants.has(env.from.displayName.toLowerCase())) {
        log('connect-ack refused (not granted)')
        return true
      }
      if (state.peers.length >= maxPeers) state.peers.shift()
      state.peers.push({ id: env.from.id, displayName: env.from.displayName || 'Someone', did: env.did, ring: Ring.Acquaintance, connectedAt: Date.now() })
      saveState(opts.stateDir, state)
      log(`peer connected (${state.peers.length} now)`)
    }
    return true
  })

  channel.onEnvelope(async (fromDid) => (peerByDid(fromDid) ? pairKey(fromDid) : null), (env, fromDid) => { void handle(env, fromDid) })

  async function handle(env: Envelope, fromDid: string): Promise<void> {
    if (env.t !== 'query') return
    await handleQuery(env, fromDid)
  }

  async function handleQuery(q: QueryEnvelope, fromDid: string): Promise<void> {
    if (seenQids.has(q.qid)) return
    seenQids.add(q.qid)
    if (seenQids.size > 5000) seenQids.clear()
    const receivedAt = Date.now()
    const peer = peerByDid(fromDid)
    if (!peer) return
    const key = await pairKey(peer.did)
    const text = q.freeText ?? ''
    const tpl = askTemplate(text)
    const answer = async (payload: SharedPayload | null): Promise<void> => {
      await settleAt(receivedAt, RELAY_DEADLINE_MS)
      const out = await sealRelayAnswer(q.qid, tpl.id, payload, { key, blocked: false })
      try { await channel.send(peer.did, out, key) } catch { /* the asker times out and sees "no match" */ }
    }
    if (!limiter.allow(peer.did, receivedAt)) {
      log('ask ' + AskOutcome.RateLimited)
      await answer(null)
      return
    }
    const { threads, refs } = threadsForRing(asAppState(), peer.ring)
    const match = text ? prune(matchTemplate(tpl, threads)) : { hits: [], distinctAuthors: 0, aboveThreshold: false }
    const { surface } = classifyIncomingQuery(match, false, Boolean(text))
    if (!surface) {
      log('ask ' + AskOutcome.NoMatch)
      await answer(null)
      return
    }
    const matches = match.hits.map((h) => refs.get(h.threadId)).filter((r): r is LineRef => Boolean(r))
    log(`ask ${AskOutcome.Shared} (${matches.length})`)
    await answer({
      from: state.me.displayName,
      templateId: tpl.id,
      items: matches.map((m) => ({ text: m.text, when: coarseWhen(m.at), context: m.context })),
    })
  }

  try {
    await channel.connect(identity)
  } catch {
    /* relay.ts keeps reconnecting on its own */
  }
  const health = opts.healthPort ? await healthServer(opts.healthPort, card, () => relayStatus, () => state.peers.length) : null
  log(`${name}: up with ${inventory.length} items, policy ${policy}, ${state.peers.length} peers`)

  return {
    card,
    status: () => relayStatus,
    peerCount: () => state.peers.length,
    stop: async () => {
      process.off('SIGHUP', reload)
      channel.close()
      if (health) await new Promise<void>((resolve) => health.close(() => resolve()))
    },
  }
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing ${name}`)
  return v
}

/** CLI entry: every setting from the environment (see the header). */
export async function main(): Promise<void> {
  const policyRaw = process.env.TW_PEER_POLICY ?? PeerPolicy.Open
  const policy = (Object.values(PeerPolicy) as string[]).includes(policyRaw) ? (policyRaw as PeerPolicy) : PeerPolicy.Open
  const peer = await startPeer({
    stateDir: env('TW_PEER_STATE'),
    inventoryFile: env('TW_PEER_INVENTORY'),
    relayOrigin: env('TW_PEER_RELAY'),
    name: process.env.TW_PEER_NAME,
    policy,
    healthPort: Number(process.env.TW_PEER_HEALTH_PORT ?? 0),
    asksPerHour: process.env.TW_PEER_ASKS_PER_HOUR ? Number(process.env.TW_PEER_ASKS_PER_HOUR) : undefined,
  })
  const bye = (): void => { void peer.stop().then(() => process.exit(0)) }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

const entry = process.argv[1] ?? ''
if (/peer\.(ts|mjs|js)$/.test(entry)) void main()
