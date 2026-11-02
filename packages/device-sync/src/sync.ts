// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * sync.ts -- pairing the owner's own devices and syncing the record log between them, through the existing relay's raw path.
 *
 * WHY (what the v3 link, apps/trustweb/src/sync_link.ts, lacked):
 *  - Replay: v3's only defence was `exp` (sent + 10 min) inside the seal, so a captured wire replayed within 10 minutes was
 *    accepted again. Here every sealed message carries a per-direction counter checked against a persisted anti-replay window
 *    (replay.ts) BEFORE it is processed or acknowledged.
 *  - Re-addressing: v3 sealed without AAD, so a wire re-attributed by the relay to another device of the same pair key context could
 *    not be told apart. Here the outer from/to are bound as AAD (seal.ts) and the keys are directional (keys.ts).
 *  - Forks and lost deletes: v3 merged two whole-record STATES with last-writer-wins by wall clock. Here the devices exchange the
 *    missing entries of an append-only, hash-chained log (log.ts) and materialize it deterministically; conflicts are listed, not lost.
 *
 * FLOW
 *  - Pairing: `offer()` makes a one-time code `TWS2~<address>~<public key>~<secret>~<exp>` (QR or link; it never crosses the relay)
 *    and keeps {secret key, exp} for ONE use. `join(code)` sends `pair` {deviceId, publicKey, name} sealed under the key derived from
 *    the secret, with AAD (joiner address, offerer address). Both sides compute the 6-digit SAS from derivePairKeys; the people
 *    compare it and Confirm, which stores the Pairing (peer public key, the epoch, counters at zero). Derived keys are cached in memory only.
 *  - Sync: `syncNow(addr)` sends `have` {heads, name}; the peer answers `entries` (what we lack by our heads, plus its own heads,
 *    chunked: ≤ CHUNK_BYTES raw bytes per piece, ≤ MAX_PIECES pieces) with reply:false; we merge, then send `entries` with
 *    reply:true for the heads it announced; the peer merges that. One round, both converge.
 *  - Every wire: pairing by outer `from` → openMessage(recv key, from, me) → replay accept(ctr) → persist → process → true.
 *    A wire from an unknown address is only considered as `pair` while an offer is open and unexpired. Anything else → false
 *    (not ours, not acked). Send: sendCtr++ is persisted BEFORE sendRaw, so a counter is never reused after a restart.
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - NO forward secrecy: the pair keys come from static X25519 keys; whoever steals a device's secret key can open every wire the
 *    relay still holds or anyone recorded. NO post-quantum security.
 *  - NO metadata protection: the relay sees both addresses, timing, number and size of pieces (no padding).
 *  - NO availability: the relay can drop, delay or reorder wires; a sync then fails with 'offline' or converges on the next round.
 *  - The SAS only helps if the people really compare it; the pairing secret is the only thing authenticating the joining device.
 *  - A wire is persisted as accepted before it is processed: a crash in between loses that wire's content (not its safety); the
 *    next round resends what is missing. The other order (processed, then crash before persisting) is absorbed by the idempotent merge.
 *  - A wire that opens but whose counter was already seen (a replay, or an honest redelivery whose ack was lost) is acked and NOT
 *    processed: it changes nothing and the relay stops redelivering it. Only a wire that does not open stays un-acked.
 *  - Unlinking and pairing the SAME two device keys again derives NEW pair keys: the pairing epoch (SHA-256 of the one-time secret)
 *    is mixed into the key derivation, so a wire captured under an earlier pairing does not open under the new one.
 *  - `entries` from a paired device are merged without a review step; only the merge's own checks (hash, chain, fork) apply.
 */
import { canonicalJson, concat, fromB64u, fromUtf8, randomBytes, sha256, toB64u, utf8 } from './bytes.ts'
import { derivePairKeys, deviceIdOf, deviceKeysFromSecret, generateDeviceKeys, secretKeyFromPairingSecret } from './keys.ts'
import type { DeviceKeys, PairKeys } from './keys.ts'
import { RecordLog } from './log.ts'
import type { LogEntry, LogJson, Materialized, MergeReport, Op } from './log.ts'
import { createReplayGuard } from './replay.ts'
import type { ReplayState } from './replay.ts'
import { openMessage, sealMessage } from './seal.ts'

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
  sendCtr: number
  replay: ReplayState
  /** SHA-256 of the one-time pairing secret (base64url), mixed into the pair keys so a later pairing of the same two devices has new keys. */
  epoch: string
}
export interface PairRequest { address: string; name: string; sas: string; confirm(): Promise<void>; cancel(): void }
export interface SyncData { v: 1; secretKey: string; pairings: Pairing[]; log: LogJson }
export interface SyncStorage { load(): SyncData | null; save(d: SyncData): void }
export interface SyncReport { sent: number; received: number; merge: MergeReport }
export interface DeviceSyncDeps {
  relay: RelayLike
  address: string
  deviceName: () => string
  storage: SyncStorage
  now?: () => number
  handshakeMs?: number
  onPairRequest: (r: PairRequest) => void
  onLog: (line: string) => void
  onChange?: () => void
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
/** Upper bound for one piece's base64url text (CHUNK_BYTES raw → 4/3, rounded up). */
const MAX_PIECE_TEXT = Math.ceil((CHUNK_BYTES * 4) / 3) + 4

const badAddress = (a: string): boolean => a === '' || a.includes('~') || a.includes('|') || /\s/.test(a)

// ---- pairing code ----------------------------------------------------------------------------------------------------------------

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

/** `${base}#sync=${encodeURIComponent(code)}` */
export function pairingLink(base: string, code: string): string {
  return `${base}#sync=${encodeURIComponent(code)}`
}

/** The code inside a pairing link (the `sync` parameter of its fragment), or null if there is none or it is not a pairing code. */
export function codeFromLink(link: string): string | null {
  if (typeof link !== 'string') return null
  const hash = link.indexOf('#')
  if (hash < 0) return null
  for (const kv of link.slice(hash + 1).split('&')) {
    if (!kv.startsWith('sync=')) continue
    try {
      const code = decodeURIComponent(kv.slice(5))
      return parsePairingCode(code) ? code : null
    } catch {
      return null
    }
  }
  return null
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
interface Waiter { resolve(r: SyncReport): void; reject(e: Error): void }

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

function validPairing(v: unknown): v is Pairing {
  if (!isRecord(v)) return false
  const p = v
  return (
    typeof p['address'] === 'string' && !badAddress(p['address']) && typeof p['deviceId'] === 'string' && typeof p['publicKey'] === 'string' &&
    typeof p['name'] === 'string' && typeof p['sas'] === 'string' && typeof p['linkedAt'] === 'number' && typeof p['lastSyncAt'] === 'number' &&
    typeof p['sendCtr'] === 'number' && Number.isSafeInteger(p['sendCtr']) && p['sendCtr'] >= 0 && isRecord(p['replay']) &&
    typeof p['epoch'] === 'string' && p['epoch'] !== ''
  )
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export async function createDeviceSync(d: DeviceSyncDeps): Promise<DeviceSync> {
  if (badAddress(d.address)) throw new Error("device-sync: address must be non-empty without '~', '|' or whitespace")
  const now = d.now ?? Date.now
  const handshakeMs = d.handshakeMs ?? HANDSHAKE_MS
  const me = d.address

  // ---- load or create ----
  let keys: DeviceKeys | null = null
  let pairings: Pairing[] = []
  let log: RecordLog | null = null
  let stored: SyncData | null = null
  try {
    stored = d.storage.load()
  } catch {
    stored = null
  }
  if (stored && isRecord(stored) && stored.v === 1 && typeof stored.secretKey === 'string') {
    try {
      keys = await deviceKeysFromSecret(fromB64u(stored.secretKey))
    } catch {
      keys = null
    }
    if (keys) {
      pairings = Array.isArray(stored.pairings) ? stored.pairings.filter(validPairing).map(copy) : []
      log = RecordLog.fromJSON(stored.log)
      if (!log || log.device !== keys.deviceId) {
        d.onLog('The saved sync log could not be read; starting an empty log')
        log = null
      }
    }
  }
  if (!keys) {
    if (stored) d.onLog('The saved sync keys could not be read; this device starts with new keys and has to be linked again')
    keys = await generateDeviceKeys()
    pairings = []
  }
  const mine: DeviceKeys = keys
  const recordLog: RecordLog = log ?? new RecordLog(mine.deviceId)

  const pairKeys = new Map<string, { pub: string; epoch: string; keys: PairKeys }>()
  const partial = new Map<string, Assembly>()
  const waiters = new Map<string, Waiter>()
  const inflight = new Map<string, Promise<SyncReport>>()
  let offer: { key: CryptoKey; epoch: string; exp: number } | null = null

  function persist(): void {
    d.storage.save({ v: 1, secretKey: toB64u(mine.secretKey), pairings: pairings.map(copy), log: recordLog.toJSON() })
    d.onChange?.()
  }
  persist()

  const find = (address: string): Pairing | undefined => pairings.find((p) => p.address === address)

  async function keysFor(p: Pairing): Promise<PairKeys> {
    const c = pairKeys.get(p.address)
    if (c && c.pub === p.publicKey && c.epoch === p.epoch) return c.keys
    const k = await derivePairKeys(mine, fromB64u(p.publicKey), fromB64u(p.epoch))
    pairKeys.set(p.address, { pub: p.publicKey, epoch: p.epoch, keys: k })
    return k
  }

  /** The pairing epoch: SHA-256 of the one-time secret, known to both sides from the code, never sent. */
  const epochOf = async (secret: Uint8Array): Promise<string> => toB64u(await sha256(secret))

  async function send(p: Pairing, kind: string, body: unknown): Promise<void> {
    const k = await keysFor(p)
    p.sendCtr++
    persist()
    await d.relay.sendRaw(p.address, await sealMessage(k.send, me, p.address, { ctr: p.sendCtr, kind, body }))
  }

  /** Sends what the peer lacks by `heads`, in pieces; returns the number of entries sent. Throws 'too large' before sending anything. */
  async function sendEntries(p: Pairing, heads: Heads, reply: boolean): Promise<number> {
    const entries = recordLog.since(heads)
    const raw = utf8(canonicalJson({ entries, heads: recordLog.heads() }))
    const n = Math.max(1, Math.ceil(raw.length / CHUNK_BYTES))
    if (n > MAX_PIECES) {
      d.onLog(`The log is too large to send to ${p.name} (${n} pieces, the most is ${MAX_PIECES})`)
      throw new Error('too large')
    }
    const sid = toB64u(randomBytes(12))
    const name = d.deviceName()
    for (let i = 0; i < n; i++) {
      const data = toB64u(raw.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES))
      await send(p, 'entries', { sid, i, n, data, reply, name })
    }
    d.onLog(`Sent ${entries.length} change(s) to ${p.name}`)
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
      for (const k of partial.keys()) if (k.startsWith(`${p.address}\n`)) partial.delete(k)
      acc = { n: n as number, parts: [], got: 0, reply }
      partial.set(key, acc)
    }
    if (acc.n !== n || acc.reply !== reply || acc.parts[i as number]) return
    acc.parts[i as number] = piece
    acc.got++
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
    const received = decoded['entries'].length
    const merge = await recordLog.merge(decoded['entries'])
    p.lastSyncAt = now()
    persist()
    d.onLog(
      `Merged from ${p.name}: ${merge.added} added, ${merge.duplicates} already known` +
        (merge.rejected.length ? `, ${merge.rejected.length} rejected (${merge.rejected.map((r) => `${r.id || '?'} ${r.reason}`).join(', ')})` : ''),
    )
    if (merge.added > 0) d.onChange?.()
    if (acc.reply) return

    const w = waiters.get(p.address)
    try {
      const sent = await sendEntries(p, heads, true)
      w?.resolve({ sent, received, merge })
    } catch (e) {
      if (w) w.reject(e instanceof Error ? e : new Error(String(e)))
      else d.onLog(`Could not send ours back to ${p.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** A `pair` from an address we are not linked with (or whose pairing key did not open it), while an offer is open. */
  async function tryPair(from: string, payload: string): Promise<boolean> {
    const o = offer
    if (!o || now() > o.exp || badAddress(from) || from === me) return false
    const m = await openMessage(o.key, from, me, payload)
    if (!m || m.kind !== 'pair' || !isRecord(m.body)) return false
    const { deviceId, publicKey } = m.body
    if (typeof deviceId !== 'string' || typeof publicKey !== 'string') return false
    let pub: Uint8Array
    let k: PairKeys
    try {
      pub = fromB64u(publicKey)
      if ((await deviceIdOf(pub)) !== deviceId) return false
      k = await derivePairKeys(mine, pub, fromB64u(o.epoch))
    } catch {
      return false
    }
    if (offer !== o || now() > o.exp) return false // consumed by another pair wire meanwhile, or expired
    offer = null
    const name = cleanName(m.body['name'], 'Other device')
    d.onPairRequest(request(from, deviceId, toB64u(pub), name, k, o.epoch))
    d.onLog(`${name} asks to link (code ${k.sas})`)
    return true
  }

  function request(address: string, deviceId: string, publicKey: string, name: string, k: PairKeys, epoch: string): PairRequest {
    return {
      address,
      name,
      sas: k.sas,
      confirm: async () => {
        pairings = [
          ...pairings.filter((p) => p.address !== address),
          { address, deviceId, publicKey, name, sas: k.sas, linkedAt: now(), lastSyncAt: 0, sendCtr: 0, replay: { high: 0, seen: [] }, epoch },
        ]
        pairKeys.set(address, { pub: publicKey, epoch, keys: k })
        for (const key of partial.keys()) if (key.startsWith(`${address}\n`)) partial.delete(key)
        persist()
        d.onLog(`Linked ${name} (${k.sas})`)
      },
      cancel: () => d.onLog(`Link with ${name} cancelled`),
    }
  }

  async function handle(from: string, payload: string): Promise<boolean> {
    try {
      if (typeof from !== 'string' || typeof payload !== 'string') return false
      const p = find(from)
      if (p) {
        const k = await keysFor(p)
        const m = await openMessage(k.recv, from, me, payload)
        if (m) {
          if (find(from) !== p) return false // unlinked (or re-linked) while opening
          const guard = createReplayGuard(p.replay)
          // Authentic but already seen (a replay, or an honest redelivery whose ack was lost): consumed without being processed, and
          // acked, so the relay stops redelivering it. A replay therefore changes nothing and costs nothing but this check.
          if (!guard.accept(m.ctr)) return true
          p.replay = guard.state()
          persist()
          try {
            if (m.kind === 'have') await onHave(p, m.body)
            else if (m.kind === 'entries') await onEntries(p, m.body)
          } catch (e) {
            d.onLog(`Could not process a message from ${p.name}: ${e instanceof Error ? e.message : String(e)}`)
          }
          return true
        }
      }
      return await tryPair(from, payload)
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
        timer = setTimeout(() => {
          waiters.delete(address)
          d.onLog(`${p.name} did not answer: open it there and try again`)
          reject(new Error('offline'))
        }, handshakeMs)
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
        })
      })
      try {
        d.onLog(`Asking ${p.name} for its changes…`)
        await send(p, 'have', { heads: recordLog.heads(), name: d.deviceName() })
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

  d.relay.onRawWire((from, payload) => handle(from, payload))

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
      let k: PairKeys
      try {
        k = await derivePairKeys(mine, c.publicKey, fromB64u(epoch)) // refuses our own key
      } catch {
        return null
      }
      const key = await secretKeyFromPairingSecret(c.secret)
      const body = { deviceId: mine.deviceId, publicKey: toB64u(mine.publicKey), name: d.deviceName() }
      await d.relay.sendRaw(c.address, await sealMessage(key, me, c.address, { ctr: 1, kind: 'pair', body }))
      return request(c.address, await deviceIdOf(c.publicKey), toB64u(c.publicKey), 'Other device', k, epoch)
    },
    unlink(address: string): void {
      pairings = pairings.filter((p) => p.address !== address)
      pairKeys.delete(address)
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
