/**
 * trustweb-peer: an always-on TrustWeb front door that NEVER decides an
 * answer by itself (owner, 2026-10-06 10:00: "not the server answers asks, I
 * do"). A server only carries out what its owner decided:
 *
 *   1. his live yes/no per ask: the peer FORWARDS the ask to the owner's
 *      phone (a 'query' envelope with relayed: true, the wire that already
 *      exists) and relays back what the owner's phone shared, or nothing;
 *   2. a permission he set in advance: a line in the inventory file that
 *      carries a `preset` block ({ by, at, note? }) may be shared without a
 *      live tap, and every such shared line is VISIBLY MARKED as allowed in
 *      advance (SharedItem.context). A line without a preset is never
 *      shared by this service, whatever its audience says.
 *
 * So the app's sentence "only a person can say yes" stays true for this
 * peer: the person said yes live (1) or in advance and visibly (2). Nothing
 * else answers. The owner's phone off = (1) yields nothing, honestly.
 *
 * Everything on the wire is what a phone sends: the did:peer:2 identity
 * (apps/demo/src/did.ts), the relay drain (relay.ts), the one-scan
 * connect-ack (connect_link.ts), the matcher (match/lexical.ts), the
 * surface-or-stay-silent decision (incoming_query.ts) and the sealed
 * fixed-length answer in which "nothing matched", "not shared" and "the
 * owner was unreachable" are the same bytes, sent at one moment fixed when
 * the ask arrived: RELAY_DEADLINE_MS after it (gate.ts), or, while the ask
 * is forwarded to the owner, the forward deadline, so WHEN an answer comes
 * says nothing either (only the owner's live share goes early: its content
 * says so anyway). Reused, not copied.
 *
 * Owner binding (the "claim" ceremony): the owner's phone becomes the owner
 * by scanning this peer's connect link while a claim window is open (a
 * file `claim-open` in the state dir, or TW_PEER_CLAIM=1 at start; the
 * window closes after claimWindowMs or at the first bind, whichever comes
 * first). After that, every other connect-ack is an asker. The owner's DID
 * is kept in state.json (0600), never logged.
 *
 * Two instances, same code:
 *   demo      PeerPolicy.Open: anyone who opens its connect link is an asker
 *             (acquaintance ring); fictional lines with presets
 *             (demo_inventory.json); meant for the Swiss server.
 *   personal  PeerPolicy.Granted: a connect-ack is honoured only for a name
 *             the owner granted beforehand (grants.json); its inventory holds
 *             only lines the owner allowed in advance (inventory_export.ts).
 *             Host (questhub or sebra) is the owner's decision; not deployed
 *             yet; see README.txt.
 *
 * Privacy on this host: no ask text is ever logged; the log has counts and
 * outcomes only. The inventory file is read once at start and on SIGHUP.
 *
 * Run (from the repo root; tsx comes with the workspace):
 *   TW_PEER_STATE=/tmp/twpeer TW_PEER_INVENTORY=services/trustweb-peer/demo_inventory.json \
 *   TW_PEER_RELAY=https://app.idea2.site node_modules/.bin/tsx services/trustweb-peer/peer.ts
 * It writes <state>/demo-peer.json, the card a TrustWeb app reads to put this
 * peer into a demo-account link (apps/trustweb/src/demo_account.ts).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
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
import { RELAY_DEADLINE_MS, interpret, settleAt } from '../../apps/demo/src/gate'
import { sealRelayAnswer } from '../../apps/demo/src/answer_key'
import { classifyIncomingQuery } from '../../apps/demo/src/incoming_query'
import { matchTemplate } from '../../apps/demo/src/match/lexical'
import { FREE_TEXT_MAX_LEN } from '../../apps/demo/src/types'
import type { AnswerEnvelope, MatchResult, QueryEnvelope, SharedItem, SharedPayload } from '../../apps/demo/src/types'
import { askTemplate } from '../../apps/trustweb/src/lexicon'
import { Audience, AUDIENCES, Ring, coarseWhen, threadsForRing } from '../../apps/trustweb/src/model'
import type { AppState, InventoryItem, LineRef, Peer } from '../../apps/trustweb/src/model'

export enum PeerPolicy {
  /** Anyone who opens the connect link becomes an asker (the demo inventory). */
  Open = 'open',
  /** Only names granted beforehand (grants.json) become askers (the personal inventory). */
  Granted = 'granted',
}

/** What the owner's phone did with a forwarded ask. */
export enum OwnerOutcome {
  /** No owner is bound, or forwarding is off: nothing was asked of anyone. */
  NotAsked = 'not-asked',
  Shared = 'shared',
  /** A decline, a no-match on the phone, or an undecodable answer: the same bytes to the asker. */
  Nothing = 'nothing',
  /** The owner's phone did not answer within forwardWaitMs (off, or still deciding). */
  Timeout = 'timeout',
}

export enum AskOutcome {
  NoMatch = 'no-match',
  Shared = 'shared',
  RateLimited = 'rate-limited',
}

/** A permission the owner set in advance for one line; `at` is an ISO date. */
export interface PresetPermission {
  by: string
  at: string
  note?: string
}

export interface PresetLine {
  item: InventoryItem
  preset: PresetPermission
}

export interface LoadedInventory {
  /** Lines the owner allowed in advance: the only lines this peer may share without a live tap. */
  preset: PresetLine[]
  /** Well-formed lines WITHOUT a preset: held, counted, never shared. */
  held: number
}

export interface PeerOptions {
  /** Where state.json, demo-peer.json, grants.json and claim-open live. */
  stateDir: string
  /** The inventory file: { "items": [{ "text", "audience", "preset"?: { "by", "at", "note"? } }] }. */
  inventoryFile: string
  /** The relay's origin (the app's origin in production: https://app.idea2.site). */
  relayOrigin: string
  name?: string
  policy?: PeerPolicy
  /** Loopback health server port; 0 = none. */
  healthPort?: number
  maxPeers?: number
  asksPerHour?: number
  /** Forward asks to the bound owner's phone (default true). */
  forward?: boolean
  /** How long to wait for the owner's phone before answering the asker with the preset hits only. */
  forwardWaitMs?: number
  /** Opens a claim window now (same as the claim-open file). */
  claim?: boolean
  claimWindowMs?: number
  /** The minimum time between an ask's arrival and its answer; tests only, production keeps RELAY_DEADLINE_MS. */
  answerWindowMs?: number
  log?: (line: string) => void
}

/** The card a TrustWeb app reads (apps/trustweb/src/demo_account.ts isDemoPeerRef). */
export interface PeerCard {
  did: string
  id: string
  name: string
}

export interface PeerStatus {
  relay: RelayStatus
  peers: number
  owner: boolean
  forward: boolean
  claimOpen: boolean
  presetLines: number
  heldLines: number
}

export interface RunningPeer {
  card: PeerCard
  status(): PeerStatus
  peerCount(): number
  stop(): Promise<void>
}

interface Owner {
  did: string
  displayName: string
  boundAt: number
}

interface PeerState {
  me: { id: string; displayName: string }
  identity: ReturnType<typeof serializeIdentity>
  peers: Peer[]
  owner?: Owner
}

const DEFAULT_NAME = 'Demo inventory'
const DEFAULT_MAX_PEERS = 500
const DEFAULT_ASKS_PER_HOUR = 30
const DEFAULT_FORWARD_WAIT_MS = 120_000
const DEFAULT_CLAIM_WINDOW_MS = 10 * 60_000
const HOUR_MS = 3_600_000
const PRESET_NOTE_MAX_LEN = 120
const CLAIM_FILE = 'claim-open'
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

/** A preset is accepted only when it names who allowed it and a parseable date; a malformed preset = no preset. */
export function parsePreset(v: unknown): PresetPermission | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.by !== 'string' || !o.by.trim()) return null
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, PRESET_NOTE_MAX_LEN) : undefined
  return { by: o.by.trim(), at: o.at, ...(note ? { note } : {}) }
}

/** What the asker sees next to a line allowed in advance: who, when, and the owner's note if any. */
export function presetContext(p: PresetPermission): string {
  const day = p.at.slice(0, 10)
  return `Allowed in advance by ${p.by} (${day})` + (p.note ? `: ${p.note}` : '')
}

/** Reads the inventory file; a malformed line is skipped, never guessed at; a line without a preset is held. */
export function loadInventory(file: string, now: number): LoadedInventory {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const items = (raw as { items?: unknown }).items
  if (!Array.isArray(items)) return { preset: [], held: 0 }
  const out: LoadedInventory = { preset: [], held: 0 }
  for (const it of items) {
    const o = it as Record<string, unknown>
    if (typeof o.text !== 'string' || !o.text.trim() || !isAudience(o.audience)) continue
    const preset = parsePreset(o.preset)
    if (!preset) { out.held++; continue }
    out.preset.push({
      item: { id: randomId(8), text: o.text.trim().slice(0, 160), audience: o.audience, included: true, createdAt: now },
      preset,
    })
  }
  return out
}

/**
 * How a granted name compares: Unicode NFC, trimmed, inner whitespace
 * collapsed, lower-cased. scripts/trustweb_peer_grant.sh stores names the
 * same way, so " Ben  Bauer " from a phone matches "Ben Bauer" on the list.
 */
export function grantKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The names a Granted peer honours: { "names": ["anna-demo", ...] }, compared by grantKey. */
export function loadGrants(stateDir: string): Set<string> {
  const file = path.join(stateDir, 'grants.json')
  if (!existsSync(file)) return new Set()
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const names = (raw as { names?: unknown }).names
  return new Set(Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string').map(grantKey).filter(Boolean) : [])
}

/**
 * A file error for the log WITHOUT its content: JSON.parse quotes the start
 * of the text it failed on ("Unexpected token 'm', "my therapi"..."), and an
 * inventory or grants file must never reach the journal that way.
 */
export function fileErrorForLog(e: unknown): string {
  if (e instanceof SyntaxError) return 'not valid JSON'
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unreadable'
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

/** The text the owner's phone shows for a forwarded ask: who asks, then what; bounded like any free text. */
export function forwardedText(askerName: string, text: string): string {
  return `${askerName}: ${text}`.slice(0, FREE_TEXT_MAX_LEN)
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
function healthServer(port: number, card: PeerCard, status: () => PeerStatus): Promise<Server> {
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
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status()))
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
  const forward = opts.forward ?? true
  const forwardWaitMs = opts.forwardWaitMs ?? DEFAULT_FORWARD_WAIT_MS
  const answerWindowMs = opts.answerWindowMs ?? RELAY_DEADLINE_MS
  const log = opts.log ?? ((line: string): void => { console.log(new Date().toISOString() + ' ' + line) })
  mkdirSync(opts.stateDir, { recursive: true, mode: 0o700 })
  const state = loadState(opts.stateDir, opts.relayOrigin, name)
  const identity: DidIdentity = deserializeIdentity(state.identity)
  let inventory = loadInventory(opts.inventoryFile, Date.now())
  let grants = loadGrants(opts.stateDir)
  const limiter = new AskRateLimit(opts.asksPerHour ?? DEFAULT_ASKS_PER_HOUR)
  const keys = new Map<string, Promise<CryptoKey>>()
  const seenQids = new Set<string>()
  /** Forwarded asks waiting for the owner's phone, by the forwarded qid. */
  const awaitingOwner = new Map<string, (env: AnswerEnvelope) => void>()
  let relayStatus: RelayStatus = 'connecting'

  const claimFile = path.join(opts.stateDir, CLAIM_FILE)
  let claimUntil = 0
  if (!state.owner && (opts.claim || existsSync(claimFile))) {
    claimUntil = Date.now() + (opts.claimWindowMs ?? DEFAULT_CLAIM_WINDOW_MS)
    log('claim window open: the first phone to open the connect link becomes the owner')
  }
  const claimOpen = (): boolean => !state.owner && Date.now() < claimUntil
  const closeClaim = (): void => {
    claimUntil = 0
    if (existsSync(claimFile)) unlinkSync(claimFile)
  }

  const card: PeerCard = { did: identity.did, id: state.me.id, name }
  writeFileSync(path.join(opts.stateDir, 'demo-peer.json'), JSON.stringify(card) + '\n')
  saveState(opts.stateDir, state)

  const presetById = (): Map<string, PresetPermission> => new Map(inventory.preset.map((l) => [l.item.id, l.preset]))

  /** What the matcher sees: this peer's preset lines only, nobody's notes, nothing held. */
  const asAppState = (): AppState => ({
    v: 1, me: state.me, peers: state.peers, people: [], inventory: inventory.preset.map((l) => l.item), log: [], notificationsOn: false,
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
  const isOwner = (did: string): boolean => state.owner?.did === did

  /** Granted policy: a connected person stays an asker only while the name is still on the grant list. */
  const stillGranted = (p: Peer): boolean => policy !== PeerPolicy.Granted || grants.has(grantKey(p.displayName))
  /** Granted policy: forget everyone whose grant was removed (scripts/trustweb_peer_grant.sh --remove + SIGHUP). */
  const pruneUngranted = (): number => {
    const before = state.peers.length
    state.peers = state.peers.filter(stillGranted)
    const dropped = before - state.peers.length
    if (dropped) saveState(opts.stateDir, state)
    return dropped
  }

  const reload = (): void => {
    let nextInventory: LoadedInventory
    let nextGrants: Set<string>
    try {
      nextInventory = loadInventory(opts.inventoryFile, Date.now())
      nextGrants = loadGrants(opts.stateDir)
    } catch (e) {
      // Both stay as they were; the reason is logged without the file's content.
      log('reload failed (kept the previous inventory and grants): ' + fileErrorForLog(e))
      return
    }
    inventory = nextInventory
    grants = nextGrants
    const dropped = pruneUngranted()
    log(`reloaded: ${inventory.preset.length} preset lines, ${inventory.held} held, ${grants.size} grants${dropped ? `, ${dropped} no longer granted (forgotten)` : ''}`)
  }
  process.on('SIGHUP', reload)

  const channel: RelayChannel = createRelayChannel({ relayOrigin: opts.relayOrigin })
  channel.onStatus((s) => { relayStatus = s; log('relay ' + s) })

  // The one cleartext wire: "someone opened my link". While a claim window is
  // open the first unknown phone becomes the owner. Otherwise: Open policy
  // welcomes an asker; Granted policy only a name on the grant list. An
  // unknown DID that is not welcome is left un-acked and forgotten.
  channel.onRawWire((fromDid, payload) => {
    const env = decodeFromQr(payload)
    if (!env || env.t !== 'connect-ack' || env.did !== fromDid) return false
    if (isOwner(env.did)) return true
    if (peerByDid(env.did)) return true
    if (claimOpen()) {
      state.owner = { did: env.did, displayName: env.from.displayName || 'Owner', boundAt: Date.now() }
      closeClaim()
      saveState(opts.stateDir, state)
      log('owner bound; claim window closed')
      return true
    }
    if (policy === PeerPolicy.Granted) {
      const key = grantKey(env.from.displayName)
      if (!grants.has(key)) {
        log('connect-ack refused (not granted)')
        return true
      }
      // One phone per granted name: a name is not a secret, so a second phone
      // sending it is refused while the first holds it (--remove frees it).
      if (state.peers.some((p) => grantKey(p.displayName) === key)) {
        log('connect-ack refused (name already bound)')
        return true
      }
    }
    if (state.peers.length >= maxPeers) state.peers.shift()
    state.peers.push({ id: env.from.id, displayName: env.from.displayName || 'Someone', did: env.did, ring: Ring.Acquaintance, connectedAt: Date.now() })
    saveState(opts.stateDir, state)
    log(`peer connected (${state.peers.length} now)`)
    return true
  })

  channel.onEnvelope(
    async (fromDid) => {
      const p = peerByDid(fromDid)
      return isOwner(fromDid) || (p && stillGranted(p)) ? pairKey(fromDid) : null
    },
    (env, fromDid) => { void handle(env, fromDid) },
  )

  async function handle(env: Envelope, fromDid: string): Promise<void> {
    if (env.t === 'answer') {
      // Only the owner's phone answers this peer, and only to a forwarded ask.
      if (isOwner(fromDid)) awaitingOwner.get(env.qid)?.(env)
      return
    }
    if (env.t === 'query') await handleQuery(env, fromDid)
  }

  /** An ask is put in front of the owner when one is bound, forwarding is on, it has text, and it is not his own. */
  const forwards = (self: boolean, text: string): boolean => forward && Boolean(state.owner) && !self && Boolean(text)

  /** Puts the ask in front of the owner, as the ask it is; resolves with what the owner's phone shared by `deadline`. */
  async function forwardToOwner(askerName: string, text: string, templateId: string, deadline: number): Promise<{ outcome: OwnerOutcome; items: SharedItem[] }> {
    const owner = state.owner
    if (!forward || !owner || !text) return { outcome: OwnerOutcome.NotAsked, items: [] }
    const key = await pairKey(owner.did)
    const q: QueryEnvelope = {
      v: 1, t: 'query', from: state.me, templateId, templateVersion: 1,
      qid: randomId(12), issuedAt: Date.now(), freeText: forwardedText(askerName, text), relayed: true,
    }
    const answered = new Promise<AnswerEnvelope | null>((resolve) => {
      const timer = setTimeout(() => { awaitingOwner.delete(q.qid); resolve(null) }, Math.max(0, deadline - Date.now()))
      awaitingOwner.set(q.qid, (env) => { clearTimeout(timer); awaitingOwner.delete(q.qid); resolve(env) })
    })
    try {
      await channel.send(owner.did, q, key)
    } catch {
      awaitingOwner.get(q.qid)?.({ v: 1, t: 'answer', qid: q.qid, body: '' })
    }
    const env = await answered
    if (!env) return { outcome: OwnerOutcome.Timeout, items: [] }
    const decoded = await interpret(env, key)
    if (decoded.outcome !== 'shared' || !decoded.shared) return { outcome: OwnerOutcome.Nothing, items: [] }
    return { outcome: OwnerOutcome.Shared, items: decoded.shared.items }
  }

  async function handleQuery(q: QueryEnvelope, fromDid: string): Promise<void> {
    if (seenQids.has(q.qid)) return
    seenQids.add(q.qid)
    if (seenQids.size > 5000) seenQids.clear()
    const receivedAt = Date.now()
    // The owner asking his own front door is a self-test: preset lines only, never forwarded back to him.
    const self = isOwner(fromDid)
    const peer: Peer | undefined = self
      ? { id: 'owner', displayName: state.owner?.displayName ?? 'Owner', did: fromDid, ring: Ring.Acquaintance, connectedAt: state.owner?.boundAt ?? receivedAt }
      : peerByDid(fromDid)
    if (!peer || (!self && !stillGranted(peer))) return
    const key = await pairKey(peer.did)
    const text = q.freeText ?? ''
    const tpl = askTemplate(text)
    // ONE answer instant per ask, fixed before anything is decided: while the
    // ask goes to the owner's phone, every answer the owner did not add to is
    // sent at the forward deadline, so a decline, no match, the phone off and
    // the rate limit cannot be told apart by WHEN they arrive (gate.ts I3,
    // RELAY_DEADLINE_MS). Only the owner's live share goes early: its content
    // says so anyway.
    const ownerDeadline = receivedAt + Math.max(answerWindowMs, forwardWaitMs)
    const settleMs = forwards(self, text) ? Math.max(answerWindowMs, forwardWaitMs) : answerWindowMs
    const answer = async (payload: SharedPayload | null, early = false): Promise<void> => {
      await settleAt(receivedAt, early ? answerWindowMs : settleMs)
      const out = await sealRelayAnswer(q.qid, tpl.id, payload, { key, blocked: false })
      try { await channel.send(peer.did, out, key) } catch { /* the asker times out and sees "no match" */ }
    }
    if (!limiter.allow(peer.did, receivedAt)) {
      log('ask ' + AskOutcome.RateLimited)
      await answer(null)
      return
    }

    // 2. Lines the owner allowed in advance, visibly marked as such.
    const { threads, refs } = threadsForRing(asAppState(), peer.ring)
    const match = text ? prune(matchTemplate(tpl, threads)) : { hits: [], distinctAuthors: 0, aboveThreshold: false }
    const { surface } = classifyIncomingQuery(match, false, Boolean(text))
    const presets = presetById()
    const presetItems: SharedItem[] = surface
      ? match.hits
          .map((h) => refs.get(h.threadId))
          .filter((r): r is LineRef => Boolean(r))
          .map((r) => {
            const p = presets.get(r.threadId.replace(/^inv:/, ''))
            return { text: r.text, when: coarseWhen(r.at), context: p ? presetContext(p) : r.context }
          })
      : []

    // 1. The owner's live decision, in parallel with the answer window.
    const owner = self ? { outcome: OwnerOutcome.NotAsked, items: [] as SharedItem[] } : await forwardToOwner(peer.displayName, text, tpl.id, ownerDeadline)

    const items = [...owner.items, ...presetItems].slice(0, MAX_SHARED)
    // Shape kept stable for apps/trustweb/test/e2e/demo_account.mjs ("ask shared"): outcome first, then the parts.
    log(`ask ${items.length ? AskOutcome.Shared : AskOutcome.NoMatch} (${items.length}): preset=${presetItems.length} owner=${owner.outcome}${owner.outcome === OwnerOutcome.Shared ? `(${owner.items.length})` : ''}`)
    if (!items.length) {
      await answer(null)
      return
    }
    await answer({ from: state.me.displayName, templateId: tpl.id, items }, owner.outcome === OwnerOutcome.Shared)
  }

  try {
    await channel.connect(identity)
  } catch {
    /* relay.ts keeps reconnecting on its own */
  }
  const status = (): PeerStatus => ({
    relay: relayStatus,
    peers: state.peers.length,
    owner: Boolean(state.owner),
    forward: forward && Boolean(state.owner),
    claimOpen: claimOpen(),
    presetLines: inventory.preset.length,
    heldLines: inventory.held,
  })
  const health = opts.healthPort ? await healthServer(opts.healthPort, card, status) : null
  log(`${name}: up with ${inventory.preset.length} preset lines (${inventory.held} held, never shared), policy ${policy}, ${state.peers.length} peers, owner ${state.owner ? 'bound' : 'not bound'}, forward ${forward ? 'on' : 'off'}`)

  return {
    card,
    status,
    peerCount: () => state.peers.length,
    stop: async () => {
      process.off('SIGHUP', reload)
      for (const resolve of awaitingOwner.values()) resolve({ v: 1, t: 'answer', qid: '', body: '' })
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

function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v === undefined) return fallback
  return v === '1' || v.toLowerCase() === 'true'
}

/** CLI entry: every setting from the environment (see the header and README.txt). */
export async function main(): Promise<void> {
  try {
    await run()
  } catch (e) {
    // Never the error's message: it can quote a line of the inventory file.
    console.error('trustweb-peer: could not start: ' + fileErrorForLog(e))
    process.exit(1)
  }
}

async function run(): Promise<void> {
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
    forward: envFlag('TW_PEER_FORWARD', true),
    forwardWaitMs: process.env.TW_PEER_FORWARD_WAIT_MS ? Number(process.env.TW_PEER_FORWARD_WAIT_MS) : undefined,
    claim: envFlag('TW_PEER_CLAIM', false),
    claimWindowMs: process.env.TW_PEER_CLAIM_MINUTES ? Number(process.env.TW_PEER_CLAIM_MINUTES) * 60_000 : undefined,
  })
  const bye = (): void => { void peer.stop().then(() => process.exit(0)) }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

const entry = process.argv[1] ?? ''
if (/peer\.(ts|mjs|js)$/.test(entry)) void main()
