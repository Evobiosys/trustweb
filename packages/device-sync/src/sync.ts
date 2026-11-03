// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * sync.ts -- pairing the owner's own devices and syncing the record log between them, through the existing relay's raw path.
 *
 * WHY (what the v3 link, apps/trustweb/src/sync_link.ts, lacked):
 *  - Replay: v3's only defence was `exp` (sent + 10 min) inside the seal, so a captured wire replayed within 10 minutes was
 *    accepted again. Here every message key is used ONCE: a symmetric ratchet (ratchet.ts) derives one AES-GCM key per counter per
 *    direction and deletes it after use, so a replay has no key left to open it with.
 *  - Forward secrecy (owner decision, PR #71 / #68 §10): v3 sealed everything under one static pair key, so a device state captured
 *    later opened every wire the relay (or anyone) had kept. Here the chain and message keys of earlier messages are gone from the
 *    device state the moment they were used; what a thief of the current state can open is bounded to skipped keys kept for
 *    out-of-order delivery (ratchet.ts MAX_SKIP) and everything still to come under the current chain (no break-in recovery yet).
 *  - Re-addressing: v3 sealed without AAD. Here the outer from/to and the counter are bound as AAD (seal.ts) and keys are directional.
 *  - Keys at rest (owner decision): the X25519 private key lives in a KeyStore (keystore.ts: IndexedDB, a non-extractable CryptoKey)
 *    and never as bytes in the record blob. A v1 blob that still carries `secretKey` is migrated on first start and rewritten without it.
 *  - Forks and lost deletes: v3 merged two whole-record STATES with last-writer-wins by wall clock. Here the devices exchange the
 *    missing entries of an append-only, hash-chained log (log.ts) and materialize it deterministically; conflicts are listed, not lost.
 *
 * FLOW
 *  - Pairing (QR only, owner decision): `offer()` makes a one-time code `TWS2~<address>~<public key>~<secret>~<exp>`; the app shows it
 *    as a QR code and nowhere else (never in a link: a link is forwarded, logged in histories and previewed by messengers, a QR is
 *    read by the device in the same room). It is kept for ONE use. `join(code)` sends `pair` {deviceId, publicKey, name} sealed under
 *    the key derived from the secret, with AAD (joiner address, offerer address). Both sides compute the 6-digit SAS from the pair
 *    roots; the people compare it and Confirm (one decision per request), which stores the Pairing: the peer public key, the epoch and
 *    the two ratchet chains (send, receive) seeded from the roots, counters starting at 1.
 *  - Sync: `syncNow(addr)` sends `have` {heads, name}; the peer answers `entries` (what we lack by our heads, plus its own heads,
 *    chunked: ≤ CHUNK_BYTES raw bytes per piece, ≤ MAX_PIECES pieces) with reply:false. A complete `entries` message is NOT merged by
 *    itself: the person is asked "Receive from <device>?" (onIncoming; owner decision: the per-sync prompt stays). Accept merges and,
 *    for a reply:false message, sends our `entries` back with reply:true, which the other person is asked about in turn. Decline
 *    applies nothing (and fails a waiting syncNow with 'declined'). One round, both converge once both accepted.
 *  - Every wire from a linked address: counter from the wire prefix → ratchet key for that counter → open → commit the ratchet state
 *    and persist (rollback and leave un-acked when the storage fails) → process → true. A counter without a key (used, or older than
 *    the skipped window) is consumed and acked without being processed (a replay changes nothing). A wire that opens with no key at
 *    all is tried as a `pair` while an offer is open; anything else → false (not ours, not acked).
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - Forward secrecy, not post-compromise security: a stolen CURRENT chain key opens everything that follows on that chain until the
 *    devices pair again (no DH ratchet step yet; design doc open points). NO post-quantum security.
 *  - NO metadata protection: the relay sees both addresses, timing, number and size bucket of pieces (seal.ts pads to 1/4/16/64 KiB)
 *    and the per-direction counter in the wire prefix.
 *  - A restore from an OLDER backup rewinds the ratchet: the peer has deleted those keys, so that device cannot sync until the two pair
 *    again (the price of forward secrecy, logged as such). Nothing is lost: the log merges after re-pairing.
 *  - NO availability: the relay can drop, delay or reorder wires; a sync then fails with 'offline' or converges on the next round.
 *  - The SAS only helps if the people really compare it; the pairing secret is the only thing authenticating the joining device.
 *  - A wire is persisted as accepted before it is processed: a crash in between loses that wire's content (not its safety); the
 *    next round resends what is missing. The other order (processed, then crash before persisting) is absorbed by the idempotent merge.
 *  - `entries` are merged only after the person accepted; the merge's own checks (hash, chain, fork, own) still apply. Entries are not
 *    signed per device: a compromised paired device can write under a third device's id (log.ts header); it cannot extend THIS
 *    device's chain (own-id entries are refused unless `recoverOwn` is set for an explicit recovery).
 *  - The IndexedDB key store is per origin and not encrypted at rest by the browser; whoever can run code on the unlocked device can
 *    USE the key (not export it). The record blob (pairings with their ratchet state, the log) is still one synchronous blob saved on
 *    every accepted wire: fine for a prototype, quadratic for a large sync (open point).
 */
import { canonicalJson, concat, fromB64u, fromUtf8, randomBytes, sha256, toB64u, utf8 } from './bytes.ts'
import { derivePairRoots, deviceIdOf, deviceKeysFromPrivateKey, generateDeviceKeys, secretKeyFromPairingSecret } from './keys.ts'
import type { DeviceKeys } from './keys.ts'
import { migrateSecretToKeyStore } from './keystore.ts'
import type { KeyStore } from './keystore.ts'
import { RecordLog } from './log.ts'
import type { LogEntry, LogJson, Materialized, MergeReport, Op } from './log.ts'
import { initChain, parseChainState, receiveKey, sendKey } from './ratchet.ts'
import type { ChainState } from './ratchet.ts'
import { openMessage, peekCtr, sealMessage } from './seal.ts'

export interface RelayLike {
  sendRaw(to: string, payload: string): Promise<void>
  onRawWire(cb: (from: string, payload: string) => boolean | void | Promise<boolean | void>): void
}
export interface Pairing {
  address: string
  deviceId: string
  publicKey: string
  name: string
  sas: string
  linkedAt: number
  lastSyncAt: number
  /** SHA-256 of the one-time pairing secret (base64url), mixed into the pair roots so a later pairing of the same two devices has new keys. */
  epoch: string
  /** The sending ratchet chain (ratchet.ts): one key per message, deleted after use. */
  send: ChainState
  /** The receiving ratchet chain: the counter of the next expected message, and skipped keys for out-of-order delivery. */
  recv: ChainState
}
export interface PairRequest { address: string; name: string; sas: string; confirm(): Promise<void>; cancel(): void }
/** A complete `entries` message that waits for the person's "Receive from <device>?" (owner decision: the per-sync prompt stays). */
export interface Incoming {
  /** Who sends (never the pairing's key material). */
  from: Pick<Pairing, 'address' | 'deviceId' | 'name' | 'sas'>
  /** Entries in the message and the devices they come from. */
  counts: { entries: number; devices: number }
  /** true: this is the other side's answer to OUR record (the second half of a round); nothing is sent back after accepting it. */
  reply: boolean
  accept(): Promise<MergeReport>
  decline(): void
}
/** v2: no key material in the blob (the private key lives in the KeyStore). A v1 blob with `secretKey` is migrated on first start. */
export interface SyncData { v: 2; pairings: Pairing[]; log: LogJson }
export interface SyncStorage { load(): unknown; save(d: SyncData): void }
export interface SyncReport { sent: number; received: number; merge: MergeReport }
export interface DeviceSyncDeps {
  relay: RelayLike
  address: string
  deviceName: () => string
  /** The record blob: pairings (with ratchet state) and the log. In the app: localStorage. */
  storage: SyncStorage
  /** Where the device's private key lives. In the app: indexedDbKeyStore(); in tests: memoryKeyStore(). */
  keyStore: KeyStore
  now?: () => number
  handshakeMs?: number
  onPairRequest: (r: PairRequest) => void
  /** "Receive from <device>?": nothing is merged until accept() is called. */
  onIncoming: (i: Incoming) => void
  onLog: (line: string) => void
  onChange?: () => void
  /** false = do not register `handle` on relay.onRawWire (the relay keeps ONE raw sink; an app that also runs v3 sync_link.ts combines both). Default true. */
  register?: boolean
  /** true = this device lost its storage and takes its OWN earlier entries back from peers (log.ts merge acceptOwn). Default false: nobody may extend our chain. */
  recoverOwn?: boolean
}

export const PAIR_PREFIX = 'TWS2'
export const OFFER_TTL_MS = 10 * 60_000
export const CHUNK_BYTES = 45_000
export const MAX_PIECES = 200

const HANDSHAKE_MS = 30_000
const SECRET_BYTES = 32
const MIN_SECRET_BYTES = 16
const KEY_BYTES = 32
const MAX_NAME = 64
const MAX_SID = 64
/** Partial piece streams kept per peer (two `have`s answered at once arrive interleaved); the oldest beyond this is dropped and logged. */
const MAX_ASSEMBLIES = 4
/** Raw bytes of entries one round may carry; what does not fit waits for the next round (heads stay contiguous, so it continues there). */
const ROUND_BUDGET = CHUNK_BYTES * MAX_PIECES - 4_096
/** Upper bound for one piece's base64url text (CHUNK_BYTES raw → 4/3, rounded up). */
const MAX_PIECE_TEXT = Math.ceil((CHUNK_BYTES * 4) / 3) + 4

const badAddress = (a: string): boolean => a === '' || a.includes('~') || a.includes('|') || /\s/.test(a)

// ---- pairing code (shown as a QR code by the app; never put into a link) ----------------------------------------------------------

/** 'TWS2~<address>~<pub b64u>~<secret b64u>~<exp ms>'. Throws on an address that would make the code (or the AAD) ambiguous. */
export function pairingCode(address: string, publicKey: Uint8Array, secret: Uint8Array, exp: number): string {
  if (badAddress(address)) throw new Error("pairing code: address must be non-empty without '~', '|' or whitespace")
  if (!Number.isSafeInteger(exp) || exp < 0) throw new Error('pairing code: exp must be a non-negative integer')
  return [PAIR_PREFIX, address, toB64u(publicKey), toB64u(secret), String(exp)].join('~')
}

export function parsePairingCode(text: string): { address: string; publicKey: Uint8Array; secret: Uint8Array; exp: number } | null {
  if (typeof text !== 'string') return null
  const parts = text.trim().split('~')
  if (parts.length !== 5 || parts[0] !== PAIR_PREFIX) return null
  const [, address, pub, sec, expText] = parts
  if (badAddress(address) || !/^\d{1,16}$/.test(expText)) return null
  const exp = Number(expText)
  if (!Number.isSafeInteger(exp)) return null
  try {
    const publicKey = fromB64u(pub)
    const secret = fromB64u(sec)
    if (publicKey.length !== KEY_BYTES || secret.length < MIN_SECRET_BYTES) return null
    return { address, publicKey, secret, exp }
  } catch {
    return null
  }
}

// ---- the sync module -------------------------------------------------------------------------------------------------------------

export interface DeviceSync {
  readonly deviceId: string
  readonly log: RecordLog
  pairings(): Pairing[]
  offer(): Promise<string>
  join(code: string): Promise<PairRequest | null>
  unlink(address: string): void
  append(op: Op): Promise<LogEntry>
  materialize(): Materialized
  syncNow(address: string): Promise<SyncReport>
  handle(from: string, payload: string): Promise<boolean>
}

type Heads = Record<string, number>
interface Assembly { n: number; parts: Uint8Array[]; got: number; reply: boolean }
interface Waiter { resolve(r: SyncReport): void; reject(e: Error): void; /** A piece arrived: the answer is under way, restart the clock. */ touch(): void }
interface Roots { send: Uint8Array; recv: Uint8Array; sas: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME)
  return s === '' ? fallback : s
}

/** Heads from the wire: only entries of a non-empty device name with a non-negative safe integer survive. */
function cleanHeads(v: unknown): Heads | null {
  if (!isRecord(v)) return null
  const out: Heads = {}
  for (const [k, n] of Object.entries(v)) {
    if (k === '' || typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return null
    Object.defineProperty(out, k, { value: n, enumerable: true, writable: true, configurable: true })
  }
  return out
}

/** A stored pairing of this version: the ratchet chains must parse; anything else is dropped (and that device has to be linked again). */
function parsePairing(v: unknown): Pairing | null {
  if (!isRecord(v)) return null
  const p = v
  const send = parseChainState(p['send'])
  const recv = parseChainState(p['recv'])
  if (
    typeof p['address'] !== 'string' || badAddress(p['address']) || typeof p['deviceId'] !== 'string' || typeof p['publicKey'] !== 'string' ||
    typeof p['name'] !== 'string' || typeof p['sas'] !== 'string' || typeof p['linkedAt'] !== 'number' || typeof p['lastSyncAt'] !== 'number' ||
    typeof p['epoch'] !== 'string' || p['epoch'] === '' || !send || !recv
  ) return null
  return {
    address: p['address'], deviceId: p['deviceId'], publicKey: p['publicKey'], name: p['name'], sas: p['sas'],
    linkedAt: p['linkedAt'], lastSyncAt: p['lastSyncAt'], epoch: p['epoch'], send, recv,
  }
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export async function createDeviceSync(d: DeviceSyncDeps): Promise<DeviceSync> {
  if (badAddress(d.address)) throw new Error("device-sync: address must be non-empty without '~', '|' or whitespace")
  const now = d.now ?? Date.now
  const handshakeMs = d.handshakeMs ?? HANDSHAKE_MS
  const me = d.address

  // ---- keys: the key store first; a v1 blob with `secretKey` is migrated into it; else fresh keys ----
  let stored: unknown = null
  try {
    stored = d.storage.load()
  } catch {
    stored = null
  }
  const blob = isRecord(stored) ? stored : null
  let keys: DeviceKeys | null = null
  try {
    const held = await d.keyStore.load()
    if (held) keys = await deviceKeysFromPrivateKey(held.privateKey, held.publicKey)
  } catch (e) {
    d.onLog(`Could not read the device key: ${e instanceof Error ? e.message : String(e)}`)
  }
  let migrated = false
  if (!keys && blob && blob['v'] === 1 && typeof blob['secretKey'] === 'string') {
    try {
      keys = await migrateSecretToKeyStore(d.keyStore, blob['secretKey'])
      migrated = true
      d.onLog('Moved the device key out of the record store into the key store')
    } catch (e) {
      d.onLog(`Could not move the device key into the key store: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!keys) {
    if (blob) d.onLog('The saved sync keys could not be read; this device starts with new keys and has to be linked again')
    keys = await generateDeviceKeys()
    await d.keyStore.save({ publicKey: keys.publicKey, privateKey: keys.privateKey })
  }
  const mine: DeviceKeys = keys

  // ---- the blob: pairings (v2 only: a v1 pairing has no ratchet state, so those devices link again) and the log ----
  let pairings: Pairing[] = []
  let log: RecordLog | null = null
  if (blob && (blob['v'] === 1 || blob['v'] === 2)) {
    const list = Array.isArray(blob['pairings']) ? blob['pairings'] : []
    pairings = blob['v'] === 2 ? list.map(parsePairing).filter((p): p is Pairing => p !== null) : []
    if (blob['v'] === 1 && list.length) d.onLog(`${list.length} device link(s) from the earlier sync version need pairing again (new keys per message)`)
    log = RecordLog.fromJSON(blob['log'])
    if (!log || log.device !== mine.deviceId) {
      d.onLog('The saved sync log could not be read; starting an empty log')
      log = null
    }
  }
  const recordLog: RecordLog = log ?? new RecordLog(mine.deviceId)

  const partial = new Map<string, Assembly>()
  const waiters = new Map<string, Waiter>()
  const inflight = new Map<string, Promise<SyncReport>>()
  let offer: { key: CryptoKey; epoch: string; exp: number } | null = null
  /** Epochs of pairings that were unlinked: a request from before the unlink cannot bring them back. */
  const retired = new Set<string>()

  /** Saves the blob (never any key material); throws when the storage does (callers that must not lose a wire catch it). */
  function persist(): void {
    d.storage.save({ v: 2, pairings: pairings.map(copy), log: recordLog.toJSON() })
    d.onChange?.()
  }
  try {
    persist()
    if (migrated) d.onLog('The record store no longer holds the device key')
  } catch (e) {
    d.onLog(`Could not save the sync state: ${e instanceof Error ? e.message : String(e)}`)
  }

  const find = (address: string): Pairing | undefined => pairings.find((p) => p.address === address)
  const ownName = (): string => cleanName(d.deviceName(), 'This device')

  /** The pairing epoch: SHA-256 of the one-time secret, known to both sides from the code, never sent. */
  const epochOf = async (secret: Uint8Array): Promise<string> => toB64u(await sha256(secret))
  const rootsFor = (publicKey: Uint8Array, epoch: string): Promise<Roots> => derivePairRoots(mine, publicKey, fromB64u(epoch))

  async function send(p: Pairing, kind: string, body: unknown): Promise<void> {
    const r = await sendKey(p.send)
    // The advanced chain is saved BEFORE the wire leaves: a counter (and its key) is never used twice, whatever happens next.
    p.send = r.state
    persist()
    await d.relay.sendRaw(p.address, await sealMessage(r.key, me, p.address, { ctr: r.ctr, kind, body }))
  }

  /** Sends what the peer lacks by `heads`, in pieces; returns the number of entries sent. Throws 'too large' before sending anything. */
  async function sendEntries(p: Pairing, heads: Heads, reply: boolean): Promise<number> {
    const missing = recordLog.since(heads)
    // A prefix of since() (sorted by device, then seq) keeps every device's run contiguous, so a partial round still merges cleanly.
    const entries: LogEntry[] = []
    let size = 0
    for (const e of missing) {
      const len = utf8(canonicalJson(e)).length + 1
      if (size + len > ROUND_BUDGET) {
        if (entries.length === 0) {
          d.onLog(`One change is too large to send to ${p.name} (${len} bytes, the most is ${ROUND_BUDGET})`)
          throw new Error('too large')
        }
        break
      }
      entries.push(e)
      size += len
    }
    const raw = utf8(canonicalJson({ entries, heads: recordLog.heads() }))
    const n = Math.max(1, Math.ceil(raw.length / CHUNK_BYTES))
    const sid = toB64u(randomBytes(12))
    const name = ownName()
    for (let i = 0; i < n; i++) {
      const data = toB64u(raw.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES))
      await send(p, 'entries', { sid, i, n, data, reply, name })
    }
    d.onLog(entries.length < missing.length
      ? `Sent ${entries.length} of ${missing.length} change(s) to ${p.name} (${n} pieces); the rest goes with the next sync`
      : `Sent ${entries.length} change(s) to ${p.name}`)
    return entries.length
  }

  function rename(p: Pairing, name: unknown): void {
    const n = cleanName(name, p.name)
    if (n !== p.name) {
      p.name = n
      persist()
    }
  }

  async function onHave(p: Pairing, body: unknown): Promise<void> {
    if (!isRecord(body)) return
    const heads = cleanHeads(body['heads'])
    if (!heads) return
    rename(p, body['name'])
    await sendEntries(p, heads, false).catch((e: Error) => d.onLog(`Could not answer ${p.name}: ${e.message}`))
  }

  /** The person's decision on a complete `entries` message (onIncoming). */
  function incoming(p: Pairing, entries: unknown[], heads: Heads, reply: boolean): Incoming {
    let decided = false
    const devices = new Set(entries.map((e) => (isRecord(e) && typeof e['device'] === 'string' ? e['device'] : ''))).size
    return {
      from: { address: p.address, deviceId: p.deviceId, name: p.name, sas: p.sas },
      counts: { entries: entries.length, devices },
      reply,
      accept: async () => {
        if (decided) throw new Error('already decided')
        decided = true
        const merge = await recordLog.merge(entries, { acceptOwn: d.recoverOwn === true })
        p.lastSyncAt = now()
        persist()
        d.onLog(
          `Merged from ${p.name}: ${merge.added} added, ${merge.duplicates} already known` +
            (merge.rejected.length ? `, ${merge.rejected.length} rejected (${merge.rejected.map((r) => `${r.id || '?'} ${r.reason}`).join(', ')})` : ''),
        )
        if (merge.added > 0) d.onChange?.()
        if (reply) return merge
        const w = waiters.get(p.address)
        try {
          const sent = await sendEntries(p, heads, true)
          w?.resolve({ sent, received: entries.length, merge })
        } catch (e) {
          if (w) w.reject(e instanceof Error ? e : new Error(String(e)))
          else d.onLog(`Could not send ours back to ${p.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
        return merge
      },
      decline: () => {
        if (decided) return
        decided = true
        d.onLog(`Declined the record from ${p.name}`)
        if (!reply) waiters.get(p.address)?.reject(new Error('declined'))
      },
    }
  }

  async function onEntries(p: Pairing, body: unknown): Promise<void> {
    if (!isRecord(body)) return
    const { sid, i, n, data, reply } = body
    if (typeof sid !== 'string' || sid === '' || sid.length > MAX_SID || typeof reply !== 'boolean' || typeof data !== 'string') return
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(i) || (n as number) < 1 || (n as number) > MAX_PIECES) return
    if ((i as number) < 0 || (i as number) >= (n as number) || data.length > MAX_PIECE_TEXT) return
    rename(p, body['name'])
    let piece: Uint8Array
    try {
      piece = fromB64u(data)
    } catch {
      return
    }
    const key = `${p.address}\n${sid}`
    let acc = partial.get(key)
    if (!acc) {
      const mine = [...partial.keys()].filter((k) => k.startsWith(`${p.address}\n`))
      if (mine.length >= MAX_ASSEMBLIES) {
        partial.delete(mine[0])
        d.onLog(`Dropped an unfinished sync message from ${p.name} (more than ${MAX_ASSEMBLIES} at once); it comes again with the next sync`)
      }
      acc = { n: n as number, parts: [], got: 0, reply }
      partial.set(key, acc)
    }
    if (acc.n !== n || acc.reply !== reply) {
      d.onLog(`Ignored a piece from ${p.name} that does not fit its message`)
      return
    }
    if (acc.parts[i as number]) return
    acc.parts[i as number] = piece
    acc.got++
    waiters.get(p.address)?.touch()
    if (acc.got < acc.n) return
    partial.delete(key)

    let decoded: unknown
    try {
      decoded = JSON.parse(fromUtf8(concat(...acc.parts)))
    } catch {
      decoded = null
    }
    const heads = isRecord(decoded) ? cleanHeads(decoded['heads']) : null
    if (!isRecord(decoded) || !Array.isArray(decoded['entries']) || !heads) {
      d.onLog(`Ignored a damaged sync message from ${p.name}`)
      return
    }
    const entries = decoded['entries']
    d.onLog(`${p.name} sends ${entries.length} change(s)${acc.reply ? ' back' : ''}: waiting for Receive`)
    d.onIncoming(incoming(p, entries, heads, acc.reply))
  }

  /** A `pair` from an address we are not linked with (or whose ratchet did not open it), while an offer is open. */
  async function tryPair(from: string, payload: string): Promise<boolean> {
    const o = offer
    if (!o || now() > o.exp || badAddress(from) || from === me) return false
    const m = await openMessage(o.key, from, me, payload)
    if (!m || m.kind !== 'pair' || !isRecord(m.body)) return false
    const { deviceId, publicKey } = m.body
    if (typeof deviceId !== 'string' || typeof publicKey !== 'string') return false
    let pub: Uint8Array
    let roots: Roots
    try {
      pub = fromB64u(publicKey)
      if ((await deviceIdOf(pub)) !== deviceId) return false
      roots = await rootsFor(pub, o.epoch)
    } catch {
      return false
    }
    if (offer !== o || now() > o.exp) return false // consumed by another pair wire meanwhile, or expired
    offer = null
    const name = cleanName(m.body['name'], 'Other device')
    d.onPairRequest(await request(from, deviceId, toB64u(pub), name, roots, o.epoch))
    d.onLog(`${name} asks to link (code ${roots.sas})`)
    return true
  }

  async function request(address: string, deviceId: string, publicKey: string, name: string, roots: Roots, epoch: string): Promise<PairRequest> {
    // One request, one decision: a second Confirm (a double tap, or a stale sheet after an unlink) must not reset chains or revive a pairing.
    let decided = false
    const send = await initChain(roots.send)
    const recv = await initChain(roots.recv)
    return {
      address,
      name,
      sas: roots.sas,
      confirm: async () => {
        if (decided) throw new Error('already decided')
        decided = true
        if (retired.has(epoch)) throw new Error('unlinked')
        pairings = [
          ...pairings.filter((p) => p.address !== address),
          { address, deviceId, publicKey, name, sas: roots.sas, linkedAt: now(), lastSyncAt: 0, epoch, send, recv },
        ]
        for (const key of partial.keys()) if (key.startsWith(`${address}\n`)) partial.delete(key)
        persist()
        d.onLog(`Linked ${name} (${roots.sas})`)
      },
      cancel: () => {
        decided = true
        d.onLog(`Link with ${name} cancelled`)
      },
    }
  }

  async function handle(from: string, payload: string): Promise<boolean> {
    try {
      if (typeof from !== 'string' || typeof payload !== 'string') return false
      const p = find(from)
      let seen = false
      if (p) {
        const ctr = peekCtr(payload)
        const r = ctr === null ? null : await receiveKey(p.recv, ctr)
        if (ctr !== null && !r) seen = true
        const m = r ? await openMessage(r.key, from, me, payload) : null
        if (m && r) {
          if (find(from) !== p) return false // unlinked (or re-linked) while opening
          // Committed BEFORE it counts: the used key is gone from the state; if the storage fails, the wire stays un-acked and comes again.
          const before = p.recv
          p.recv = r.state
          try {
            persist()
          } catch (e) {
            p.recv = before
            d.onLog(`Could not save the sync state, the message from ${p.name} comes again: ${e instanceof Error ? e.message : String(e)}`)
            return false
          }
          try {
            if (m.kind === 'have') await onHave(p, m.body)
            else if (m.kind === 'entries') await onEntries(p, m.body)
          } catch (e) {
            d.onLog(`Could not process a message from ${p.name}: ${e instanceof Error ? e.message : String(e)}`)
          }
          return true
        }
      }
      if (await tryPair(from, payload)) return true
      if (p && seen) {
        // A counter whose key was already used (a replay, or an honest redelivery whose ack was lost) or older than the skipped window:
        // there is no key left to open it with. Consumed and acked, so the relay stops redelivering it; nothing is processed.
        d.onLog(`Ignored a message from ${p.name} whose key was already used (counter ${peekCtr(payload)})`)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async function syncNow(address: string): Promise<SyncReport> {
    const p = find(address)
    if (!p) throw new Error('not linked')
    const running = inflight.get(address)
    if (running) return running
    const run = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const answered = new Promise<SyncReport>((resolve, reject) => {
        const arm = (): void => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            waiters.delete(address)
            d.onLog(`${p.name} did not answer: open it there and try again`)
            reject(new Error('offline'))
          }, handshakeMs)
        }
        arm()
        waiters.set(address, {
          resolve: (r) => {
            clearTimeout(timer)
            waiters.delete(address)
            resolve(r)
          },
          reject: (e) => {
            clearTimeout(timer)
            waiters.delete(address)
            reject(e)
          },
          touch: arm,
        })
      })
      try {
        d.onLog(`Asking ${p.name} for its changes…`)
        await send(p, 'have', { heads: recordLog.heads(), name: ownName() })
      } catch (e) {
        clearTimeout(timer)
        waiters.delete(address)
        answered.catch(() => undefined)
        throw e
      }
      return answered
    })()
    inflight.set(address, run)
    try {
      return await run
    } finally {
      inflight.delete(address)
    }
  }

  if (d.register !== false) d.relay.onRawWire((from, payload) => handle(from, payload))

  return {
    deviceId: mine.deviceId,
    log: recordLog,
    pairings: () => pairings.map(copy),
    async offer(): Promise<string> {
      const secret = randomBytes(SECRET_BYTES)
      const exp = now() + OFFER_TTL_MS
      offer = { key: await secretKeyFromPairingSecret(secret), epoch: await epochOf(secret), exp }
      return pairingCode(me, mine.publicKey, secret, exp)
    },
    async join(code: string): Promise<PairRequest | null> {
      const c = parsePairingCode(code)
      if (!c) return null
      if (now() > c.exp) {
        d.onLog('This pairing code has expired: make a new one on the other device')
        return null
      }
      if (c.address === me) return null
      const epoch = await epochOf(c.secret)
      let roots: Roots
      try {
        roots = await rootsFor(c.publicKey, epoch) // refuses our own key
      } catch {
        return null
      }
      const key = await secretKeyFromPairingSecret(c.secret)
      const body = { deviceId: mine.deviceId, publicKey: toB64u(mine.publicKey), name: ownName() }
      await d.relay.sendRaw(c.address, await sealMessage(key, me, c.address, { ctr: 1, kind: 'pair', body }))
      return request(c.address, await deviceIdOf(c.publicKey), toB64u(c.publicKey), 'Other device', roots, epoch)
    },
    unlink(address: string): void {
      for (const p of pairings) if (p.address === address) retired.add(p.epoch)
      pairings = pairings.filter((p) => p.address !== address)
      for (const key of partial.keys()) if (key.startsWith(`${address}\n`)) partial.delete(key)
      persist()
      d.onLog(`Unlinked ${address}`)
    },
    async append(op: Op): Promise<LogEntry> {
      const e = await recordLog.append(op, now())
      persist()
      return e
    },
    materialize: () => recordLog.materialize(),
    syncNow,
    handle,
  }
}
