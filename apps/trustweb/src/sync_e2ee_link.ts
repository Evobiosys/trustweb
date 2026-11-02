// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Device sync v2, the network part (prototype; design: docs/design/device-sync-e2ee.md). Pairs two of the owner's own devices by a QR code
 * or link and syncs their record logs (sync_log.ts) through the EXISTING relay interface: RelayChannel.sendRaw / onRawWire from
 * apps/demo/src/relay.ts, the same two calls sync_link.ts (v1) uses. Nothing changes on the relay. Every payload is a sync_e2ee.ts frame,
 * so the relay sees the two sync DIDs, the time, and a size class; never a record, a device name or a message type.
 *
 * Messages inside the frames (JSON, each with `exp`, ignored once past):
 *   pair  {did, name, ep}  the joining device, sealed under the offer key (the code's secret); one per offer, the offer is then spent
 *   hi    {name}           the offering device after its Confirm, under the pair keys: its name, and proof to the joining device that
 *                          the other side holds the same keys (key confirmation)
 *   have  {f, r}           "this is what I hold" (frontier); r = this is the answer to one
 *   ops   {ops}            the ops the other side lacks, in batches that fit one frame
 * One sync: A sends have; B answers with the ops A lacks and its own have (r); A sends the ops B lacks. Two round trips, only differences.
 *
 * The onRawWire return value is the relay ack (relay.ts): true = consumed. An authentic frame that is a replay or past `exp` is consumed and
 * dropped (or the relay would deliver it forever); a frame that does not open is left un-acked, as in v1.
 *
 * Prototype: not wired into sync_view.ts. Not here: storage of keys at rest (as v1, the caller's storage), per-merge confirmation (the log is
 * append-only, so a merge loses nothing; the design note says what the UI keeps), unlinking that also tells the other device.
 */
import type { RelayChannel } from '../../demo/src/relay'
import { fromB64u, randomBytes, toB64u } from '../../demo/src/crypto'
import { admit, derivePairKeys, freshReplay, isReplay, newSecret, nextSeq, offerCode, offerKey, offerLink, openFrame, parseOffer, peekFrame, sealFrame } from './sync_e2ee'
import type { PairKeys, ReplayState } from './sync_e2ee'
import { frontier, mergeLogs, missingFor } from './sync_log'
import type { DeviceLog, Frontier, MergeOutcome, Op } from './sync_log'

/** The part of the relay channel this needs: the raw path, whose payload here is always a sealed frame. */
export type SyncRelay = Pick<RelayChannel, 'sendRaw' | 'onRawWire'>

export interface LinkedDevice {
  did: string
  name: string
  /** The pairing epoch: part of every key and every frame header. */
  ep: number
  /** The pairing secret (base64url); with both X25519 keys it gives the keys again after a restart. */
  psk: string
  sas: string
  linkedAt: number
  lastSyncAt: number
  /** The last number this device sent with (written before the frame leaves). */
  sendSeq: number
  /** The numbers already accepted from that device. */
  recv: ReplayState
}

export interface PairRequest { name: string; sas: string; confirm(): void; cancel(): void }

export interface E2eeSyncDeps {
  relay: SyncRelay
  /** This device's sync DID (a did:peer:2 of its own, as in v1, not the one it asks and answers with). */
  did: string
  /** X25519 with the other device's key-agreement key: (did) => did.ts ecdhSharedSecret(identity, did). */
  ecdh: (theirDid: string) => Uint8Array | Promise<Uint8Array>
  deviceName: () => string
  getLog: () => DeviceLog
  setLog: (log: DeviceLog) => void
  storage: Pick<Storage, 'getItem' | 'setItem'>
  storeKey?: string
  now?: () => number
  /** The joining device arrived: show its name and the check, Confirm or Cancel. */
  onPairRequest?: (r: PairRequest) => void
  onMerged?: (from: LinkedDevice, r: Pick<MergeOutcome, 'rejected' | 'forks'> & { added: number }) => void
  onLog?: (line: string) => void
}

interface Joining { ep: number; psk: string; sas: string; name?: string; recv: ReplayState }

type Msg =
  | { t: 'pair'; did: string; name: string; ep: number; exp: number }
  | { t: 'hi'; name: string; exp: number }
  | { t: 'have'; f: Frontier; r: boolean; exp: number }
  | { t: 'ops'; ops: unknown[]; exp: number }

/** A message older than this is dropped on arrival (the relay may hold it longer). */
export const MSG_TTL_MS = 10 * 60_000
/** How long a shown code can be used. */
export const OFFER_MS = 10 * 60_000
/** Serialized ops per frame: padded into the 64 KiB bucket, about 87 KB of base64url, under the relay's 128 KB. */
export const OPS_FRAME_BYTES = 48_000

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseMsg(pt: Uint8Array): Msg | null {
  try {
    const m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pt)) as unknown
    if (!isObj(m) || typeof m.exp !== 'number' || typeof m.t !== 'string') return null
    if (m.t === 'pair') return typeof m.did === 'string' && typeof m.name === 'string' && m.name.length <= 60 && Number.isInteger(m.ep) && (m.ep as number) > 0 ? (m as Msg) : null
    if (m.t === 'hi') return typeof m.name === 'string' && m.name.length <= 60 ? (m as Msg) : null
    if (m.t === 'have') return isObj(m.f) && typeof m.r === 'boolean' ? (m as Msg) : null
    if (m.t === 'ops') return Array.isArray(m.ops) ? (m as Msg) : null
    return null
  } catch { return null }
}

/** Epochs are 32-bit and never 0 (0 marks the offer frame). */
function newEpoch(): number {
  const v = new DataView(randomBytes(4).buffer).getUint32(0)
  return v === 0 ? 1 : v
}

export function createE2eeSync(d: E2eeSyncDeps) {
  const now = d.now ?? Date.now
  const storeKey = d.storeKey ?? 'trustweb.sync.v2'
  const log = (l: string): void => d.onLog?.(l)
  const keys = new Map<string, PairKeys>()
  let devices: LinkedDevice[] = []
  let offer: { secret: string; until: number } | null = null
  /** Joined but not yet confirmed here: the offering device's `hi` may arrive first and names it. Kept in memory only. */
  const joining = new Map<string, Joining>()

  function load(): void {
    try {
      const raw = d.storage.getItem(storeKey)
      const parsed = raw ? (JSON.parse(raw) as { devices?: LinkedDevice[] }) : null
      devices = Array.isArray(parsed?.devices) ? parsed.devices : []
    } catch { devices = [] }
    keys.clear()
  }
  function persist(): void {
    try { d.storage.setItem(storeKey, JSON.stringify({ devices })) } catch { /* storage blocked: this visit only */ }
  }

  async function keysFor(dev: Pick<LinkedDevice, 'did' | 'ep' | 'psk'>): Promise<PairKeys> {
    const cached = keys.get(dev.did)
    if (cached && cached.epoch === dev.ep) return cached
    const k = await derivePairKeys({ ecdh: await d.ecdh(dev.did), secret: fromB64u(dev.psk), myDid: d.did, theirDid: dev.did, epoch: dev.ep })
    keys.set(dev.did, k)
    return k
  }

  /** Stores the pairing (replacing an older one with the same device), so its frames open from now on. */
  function link(did: string, name: string, ep: number, psk: string, sas: string, recv = freshReplay()): LinkedDevice {
    const dev: LinkedDevice = { did, name, ep, psk, sas, linkedAt: now(), lastSyncAt: 0, sendSeq: 0, recv }
    devices = [...devices.filter((x) => x.did !== did), dev]
    keys.delete(did)
    persist()
    log(`Linked ${name} (${sas})`)
    return dev
  }

  async function send(dev: LinkedDevice, msg: Msg): Promise<void> {
    const k = await keysFor(dev)
    dev.sendSeq = nextSeq(dev.sendSeq, now())
    persist()
    await d.relay.sendRaw(dev.did, await sealFrame(k.sendKey, { ep: dev.ep, seq: dev.sendSeq }, d.did, dev.did, utf8(JSON.stringify(msg))))
  }

  const exp = (): number => now() + MSG_TTL_MS

  async function sendOps(dev: LinkedDevice, ops: Op[]): Promise<void> {
    let batch: Op[] = []
    let size = 0
    for (const o of ops) {
      const n = utf8(JSON.stringify(o)).length + 1
      if (n > OPS_FRAME_BYTES) { log(`An entry is too large to send to ${dev.name} (${n} bytes)`); continue }
      if (size + n > OPS_FRAME_BYTES) { await send(dev, { t: 'ops', ops: batch, exp: exp() }); batch = []; size = 0 }
      batch.push(o)
      size += n
    }
    if (batch.length) await send(dev, { t: 'ops', ops: batch, exp: exp() })
  }

  async function onMsg(dev: LinkedDevice, m: Msg): Promise<void> {
    if (m.t === 'hi') {
      if (m.name !== dev.name) { dev.name = m.name; persist() }
    } else if (m.t === 'have') {
      const lacks = missingFor(d.getLog(), m.f)
      if (lacks.length) await sendOps(dev, lacks)
      if (!m.r) await send(dev, { t: 'have', f: frontier(d.getLog()), r: true, exp: exp() })
    } else if (m.t === 'ops') {
      const res = await mergeLogs(d.getLog(), m.ops, now())
      d.setLog(res.log)
      dev.lastSyncAt = now()
      persist()
      log(`Merged from ${dev.name}: ${res.added.length} added${res.rejected.length ? `, ${res.rejected.length} refused` : ''}${res.forks.length ? `, ${res.forks.length} reused numbers` : ''}`)
      d.onMerged?.(dev, { added: res.added.length, rejected: res.rejected, forks: res.forks })
    }
  }

  async function fromLinked(dev: LinkedDevice, payload: string): Promise<boolean> {
    const meta = peekFrame(payload)
    if (!meta || meta.ep !== dev.ep) return false
    const opened = await openFrame((await keysFor(dev)).recvKey, dev.did, d.did, payload)
    if (!opened) return false
    if (isReplay(dev.recv, opened.seq)) { log(`Dropped a replayed message from ${dev.name}`); return true }
    dev.recv = admit(dev.recv, opened.seq)
    persist()
    const m = parseMsg(opened.plaintext)
    if (!m || m.t === 'pair') return true
    if (now() > m.exp) { log(`Dropped an expired message from ${dev.name}`); return true }
    await onMsg(dev, m)
    return true
  }

  async function fromOffer(fromDid: string, payload: string): Promise<boolean> {
    if (!offer || now() > offer.until) return false
    const meta = peekFrame(payload)
    if (!meta || meta.ep !== 0) return false
    const secret = offer.secret
    const opened = await openFrame(await offerKey(fromB64u(secret), d.did), fromDid, d.did, payload)
    const m = opened && parseMsg(opened.plaintext)
    if (!m || m.t !== 'pair' || m.did !== fromDid || now() > m.exp) return false
    offer = null
    const k = await derivePairKeys({ ecdh: await d.ecdh(fromDid), secret: fromB64u(secret), myDid: d.did, theirDid: fromDid, epoch: m.ep })
    d.onPairRequest?.({
      name: m.name, sas: k.sas,
      confirm: () => {
        const dev = link(fromDid, m.name, m.ep, secret, k.sas)
        void send(dev, { t: 'hi', name: d.deviceName(), exp: exp() }).catch(() => log(`Could not reach ${m.name}`))
      },
      cancel: () => log(`Link with ${m.name} cancelled`),
    })
    return true
  }

  /** The offering device's `hi` before this side pressed Confirm: remembered (name and number) for when it does. */
  async function fromJoining(fromDid: string, payload: string): Promise<boolean> {
    const j = joining.get(fromDid)
    const meta = peekFrame(payload)
    if (!j || !meta || meta.ep !== j.ep) return false
    const opened = await openFrame((await keysFor({ did: fromDid, ep: j.ep, psk: j.psk })).recvKey, fromDid, d.did, payload)
    if (!opened) return false
    const m = parseMsg(opened.plaintext)
    if (m?.t === 'hi' && !isReplay(j.recv, opened.seq)) {
      j.recv = admit(j.recv, opened.seq)
      j.name = m.name
    }
    return true
  }

  async function handle(fromDid: string, payload: string): Promise<boolean> {
    const dev = devices.find((x) => x.did === fromDid)
    if (dev && (await fromLinked(dev, payload))) return true
    if (await fromJoining(fromDid, payload)) return true
    return fromOffer(fromDid, payload)
  }

  return {
    /** Loads the pairings and listens on the relay channel. Call again after a restart; the replay state comes back from storage. */
    start(): void {
      load()
      d.relay.onRawWire((from, payload) => handle(from, payload).catch(() => false))
    },
    devices: (): readonly LinkedDevice[] => devices,
    /** A fresh one-time code (for the QR) and the same as a link; valid OFFER_MS, spent by the first device that uses it. */
    async offer(): Promise<{ code: string; link: string }> {
      const secret = newSecret()
      offer = { secret, until: now() + OFFER_MS }
      const code = offerCode(d.did, secret)
      return { code, link: offerLink(typeof location !== 'undefined' ? location.origin : 'https://app.trustweb.one', code) }
    },
    /** The device that scanned the QR or opened the link: introduces itself and returns the check to compare (null: not a code). */
    async join(codeOrLink: string): Promise<PairRequest | null> {
      const o = parseOffer(codeOrLink)
      if (!o || o.did === d.did) return null
      const ep = newEpoch()
      const secret = fromB64u(o.secret)
      const k = await derivePairKeys({ ecdh: await d.ecdh(o.did), secret, myDid: d.did, theirDid: o.did, epoch: ep })
      const j: Joining = { ep, psk: toB64u(secret), sas: k.sas, recv: freshReplay() }
      joining.set(o.did, j)
      const msg: Msg = { t: 'pair', did: d.did, name: d.deviceName(), ep, exp: exp() }
      await d.relay.sendRaw(o.did, await sealFrame(await offerKey(secret, o.did), { ep: 0, seq: 0 }, d.did, o.did, utf8(JSON.stringify(msg))))
      return {
        name: 'Other device', sas: k.sas,
        confirm: () => { joining.delete(o.did); link(o.did, j.name ?? 'Other device', ep, j.psk, k.sas, j.recv) },
        cancel: () => { joining.delete(o.did); log('Link cancelled') },
      }
    },
    /** Starts one sync with a linked device: sends what this device holds; the rest follows from the answers. */
    async syncNow(did: string): Promise<void> {
      const dev = devices.find((x) => x.did === did)
      if (!dev) throw new Error('not linked')
      await send(dev, { t: 'have', f: frontier(d.getLog()), r: false, exp: exp() })
    },
    /** Forgets the pairing here: frames from that device no longer open. */
    unlink(did: string): void {
      devices = devices.filter((x) => x.did !== did)
      keys.delete(did)
      persist()
    },
  }
}

export type E2eeSync = ReturnType<typeof createE2eeSync>
