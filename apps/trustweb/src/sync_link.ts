/**
 * Device sync, the network part (wave 7): pairing two of the owner's own devices and sending a record between them through the
 * existing relay (apps/demo relay.ts), nothing new on the server.
 *
 * Each device has a SYNC identity of its own (a did:peer:2, separate from the one it asks and answers with, so nothing here appears
 * in anybody's web). Pairing: device A shows a code (its DID + a one-time secret); device B enters or scans it and sends its own DID
 * sealed under that secret; both derive the same ECDH pair key and show the same 4-character fingerprint; each taps Confirm. After
 * that every message is AES-GCM sealed under the pair key before it reaches the relay, which sees only DIDs and sizes (I1).
 *
 * Messages (JSON inside the seal, each with `exp` = sent + 10 min, ignored after): hello / ready (is the other device on? answer within
 * 30 s or no sync starts; both carry SYNC_VERSION, a device of another version is told to update instead of a silent no-op) and data pieces (sync_core.ts toChunks). The relay accepts unauthenticated ingress and holds a wire until
 * its recipient drains it; it cannot be told to forget after 10 minutes, so `exp` is enforced by the receiver (open point in the report).
 *
 * Sent through sendRaw: the relay's raw path is for the connect bootstrap only, but what travels here is sealed by this file, so the
 * relay still sees no plaintext. The channel is this file's own, so its raw sink collides with nothing.
 */
import { createIdentity, deserializeIdentity, ecdhSharedSecret, serializeIdentity } from '../../demo/src/did'
import type { Identity, SerializedIdentityV1 } from '../../demo/src/did'
import { createRelayChannel } from '../../demo/src/relay'
import type { RelayChannel } from '../../demo/src/relay'
import { deriveEcdhPairKey, fromB64u, open, randomBytes, randomId, seal, toB64u } from '../../demo/src/crypto'
import type { AppState } from './model'
import { HANDSHAKE_MS, SYNC_TTL_MS, SYNC_VERSION, bundleOf, countsOf, fingerprintOf, fromChunks, mergeBundle, pairingCode, parsePairingCode, recordReview, refreshStamps, stampsAfterMerge, toChunks } from './sync_core'
import type { Counts, MergeResult, Stamps, SyncBundle } from './sync_core'
import { mergeCodes } from './sync_code'
import type { CodeMerge } from './sync_code'

export interface Pairing {
  did: string; name: string; fp: string; linkedAt: number; lastSyncAt: number
  /** Wave 15: the DID this device asks and answers with (the one its public link carries; hello, ready and pair announce it), so "opens on <device>" can name it. */
  askDid?: string
  /** Wave 15: false = my username and public link are NOT sent to this device (the tick on the confirm sheet). Absent = shared. */
  shareCode?: boolean
}

interface Store { identity: SerializedIdentityV1; pairings: Pairing[]; stamps: Stamps }

/** A device waiting for the person's "Confirm" (both sides of a pairing show one). */
export interface PairRequest { name: string; fp: string; confirm(opts?: { shareCode?: boolean }): void; cancel(): void }

/** A record that arrived complete and waits for the person's "Confirm". `file`: also hand the person the pre-merge snapshot as an encrypted file (snapshot_view.ts). */
export interface Incoming { from: Pairing; counts: Counts; reply: boolean; accept(file: boolean): Promise<MergeResult>; decline(): void }

export interface SyncLinkDeps {
  persona: string
  storeCtx?: string
  state: () => AppState
  save: () => void
  deviceName: () => string
  /** Takes the local snapshot that must exist before any merge is applied (snapshot_view.ts); never throws. */
  snapshot: (reason: string, file: boolean) => Promise<void>
  channel?: RelayChannel
  /** Where the identity and pairings live. Default: localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  now?: () => number
  onPairRequest: (r: PairRequest) => void
  onIncoming: (i: Incoming) => void
  /** Progress and log lines, in the order they happen. */
  onLog: (line: string) => void
  onChange: () => void
  /** Wave 15: the DID this device asks with (its public link's), announced to the paired device; undefined while it has none. */
  askDid?: () => string | undefined
  /** Wave 15: the network step after a merge that brought codes in (sync_codes.ts); never throws. */
  settleCodes?: (merge: CodeMerge) => Promise<void>
  /** Overrides how long a handshake waits (tests). */
  handshakeMs?: number
  /** Overrides the SYNC_VERSION this device announces (tests). */
  version?: number
}

type Msg =
  | { t: 'pair'; did: string; name: string; ask?: string; exp: number }
  | { t: 'hello' | 'ready'; sid: string; name: string; v?: number; ask?: string; exp: number }
  | { t: 'data'; sid: string; i: number; n: number; r: boolean; d: string; name: string; exp: number }

const MAX_PIECES = 200
/** Own HKDF label for the sync keys: a sync key can never open another channel's message. (No production pairings exist yet, so no migration.) */
const SYNC_KEY_INFO = 'trustweb-device-sync/v1'
const pairKeyOf = (secret: Uint8Array): Promise<CryptoKey> => deriveEcdhPairKey(secret, SYNC_KEY_INFO)
const OFFER_MS = SYNC_TTL_MS
/** An announced asking DID is a did:peer:2 of sane size (it only ever names a device in the list). */
const askOk = (v: unknown): v is string => typeof v === 'string' && /^did:peer:2\.[A-Za-z0-9.:_-]{20,1500}$/.test(v)

function utf8(s: string): Uint8Array { return new TextEncoder().encode(s) }

async function sealMsg(key: CryptoKey, msg: Msg): Promise<string> {
  const iv = randomBytes(12)
  const ct = await seal(key, iv, utf8(JSON.stringify(msg)))
  const framed = new Uint8Array(iv.length + ct.length)
  framed.set(iv, 0)
  framed.set(ct, iv.length)
  return toB64u(framed)
}

async function openMsg(key: CryptoKey, payload: string): Promise<Msg | null> {
  try {
    const framed = fromB64u(payload)
    if (framed.length < 13) return null
    const pt = await open(key, framed.slice(0, 12), framed.slice(12))
    if (!pt) return null
    const m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pt)) as Msg
    return typeof m === 'object' && m !== null && typeof m.exp === 'number' && typeof m.t === 'string' ? m : null
  } catch { return null }
}

export function createSyncLink(d: SyncLinkDeps) {
  const now = d.now ?? Date.now
  const version = d.version ?? SYNC_VERSION
  const storeKey = `trustweb.sync.v1.${d.persona}${d.storeCtx ? '.' + d.storeCtx : ''}`
  const channel = d.channel ?? createRelayChannel()
  const storage = (): Pick<Storage, 'getItem' | 'setItem'> => d.storage ?? localStorage
  const keys = new Map<string, CryptoKey>()
  /** sid -> called with the other device's SYNC_VERSION (a device older than the field sends none: 1). */
  const waiting = new Map<string, (v: number) => void>()
  const partial = new Map<string, { n: number; parts: Uint8Array[]; got: number; reply: boolean; did: string }>()
  let offer: { secret: string; key: CryptoKey; until: number } | null = null
  let store: Store
  let identity: Identity

  function load(): Store {
    try {
      const raw = storage().getItem(storeKey)
      if (raw) return JSON.parse(raw) as Store
    } catch { /* unreadable: a fresh identity, devices pair again */ }
    return { identity: serializeIdentity(createIdentity(location.origin + '/relay')), pairings: [], stamps: {} }
  }
  function persist(): void {
    try { storage().setItem(storeKey, JSON.stringify(store)) } catch { /* storage blocked: this visit only */ }
    d.onChange()
  }

  async function pairKey(did: string): Promise<CryptoKey> {
    let k = keys.get(did)
    if (!k) { k = await pairKeyOf(ecdhSharedSecret(identity, did)); keys.set(did, k) }
    return k
  }
  const send = async (did: string, msg: Msg): Promise<void> => channel.sendRaw(did, await sealMsg(await pairKey(did), msg))
  const stamp = (): number => now() + SYNC_TTL_MS
  const ask = (): { ask?: string } => { const a = d.askDid?.(); return askOk(a) ? { ask: a } : {} }

  /** The pairing request both sides show: the fingerprint of the shared secret, and what Confirm does. */
  async function request(did: string, name: string, ask?: string): Promise<PairRequest> {
    const fp = await fingerprintOf(ecdhSharedSecret(identity, did))
    return {
      name, fp,
      confirm: (opts) => {
        store.pairings = [...store.pairings.filter((p) => p.did !== did), {
          did, name, fp, linkedAt: now(), lastSyncAt: 0, ...(askOk(ask) ? { askDid: ask } : {}), ...(opts?.shareCode === false ? { shareCode: false } : {}),
        }]
        persist()
        d.onLog(`Linked ${name} (${fp})`)
      },
      cancel: () => { d.onLog(`Link with ${name} cancelled`) },
    }
  }

  async function onData(p: Pairing, m: Extract<Msg, { t: 'data' }>): Promise<void> {
    if (!Number.isInteger(m.n) || m.n < 1 || m.n > MAX_PIECES || !Number.isInteger(m.i) || m.i < 0 || m.i >= m.n) return
    let acc = partial.get(m.sid)
    if (!acc) {
      for (const [sid, a] of partial) if (a.did === p.did) partial.delete(sid)
      acc = { n: m.n, parts: [], got: 0, reply: m.r, did: p.did }
      partial.set(m.sid, acc)
    }
    if (acc.n !== m.n || acc.parts[m.i]) return
    acc.parts[m.i] = fromB64u(m.d)
    acc.got++
    d.onLog(`Receiving from ${p.name}: ${acc.got}/${acc.n}`)
    if (acc.got < acc.n) return
    partial.delete(m.sid)
    const bundle = fromChunks(acc.parts)
    if (!bundle) { d.onLog(`Ignored a damaged record from ${p.name}`); return }
    d.onIncoming({
      from: p, counts: countsOf(bundle), reply: acc.reply,
      accept: (file) => accept(p, bundle, acc.reply, file),
      decline: () => d.onLog(`Declined the record from ${p.name}`),
    })
  }

  async function accept(p: Pairing, bundle: SyncBundle, reply: boolean, file: boolean): Promise<MergeResult> {
    const s = d.state()
    await d.snapshot(`before sync from ${p.name}`, file)
    const t = now()
    const me = d.deviceName()
    const before = refreshStamps(s, store.stamps, t, me)
    const res = mergeBundle(s, before, bundle, p.lastSyncAt)
    res.codes = mergeCodes(s, bundle, p.did, p.lastSyncAt === 0)
    recordReview(s, res.conflicts)
    store.stamps = stampsAfterMerge(s, before, bundle, t, me, p.name)
    p.lastSyncAt = t
    persist()
    d.save()
    d.onLog(`Merged from ${p.name}: ${res.added} added, ${res.updated} updated, ${res.conflicts.length} to review`)
    if (bundle.connectCode && d.settleCodes) await d.settleCodes(res.codes).catch(() => d.onLog(`Could not settle the username with ${p.name}`))
    if (!reply) await sendBundle(p, true).catch(() => d.onLog(`Could not send ours back to ${p.name}`))
    return res
  }

  async function sendBundle(p: Pairing, reply: boolean): Promise<void> {
    const s = d.state()
    store.stamps = refreshStamps(s, store.stamps, now(), d.deviceName())
    persist()
    const pieces = toChunks(bundleOf(s, store.stamps, p.shareCode !== false))
    if (pieces.length > MAX_PIECES) { d.onLog(`The record is too large to send (${pieces.length} pieces, the most is ${MAX_PIECES})`); throw new Error('too large') }
    const sid = randomId(12)
    for (let i = 0; i < pieces.length; i++) {
      await send(p.did, { t: 'data', sid, i, n: pieces.length, r: reply, d: toB64u(pieces[i]), name: d.deviceName(), exp: stamp() })
      d.onLog(`Sending to ${p.name}: ${i + 1}/${pieces.length}`)
    }
  }

  async function handle(fromDid: string, payload: string): Promise<boolean> {
    const p = store.pairings.find((x) => x.did === fromDid)
    if (p) {
      const m = await openMsg(await pairKey(fromDid), payload)
      if (!m) return false
      if (m.t !== 'pair' && now() <= m.exp) {
        if (m.name && m.name !== p.name) { p.name = m.name; persist() }
        if ((m.t === 'hello' || m.t === 'ready') && askOk(m.ask) && m.ask !== p.askDid) { p.askDid = m.ask; persist() }
        if (m.t === 'hello') await send(fromDid, { t: 'ready', sid: m.sid, name: d.deviceName(), v: version, ...ask(), exp: stamp() })
        else if (m.t === 'ready') waiting.get(m.sid)?.(m.v ?? 1)
        else if (m.t === 'data') await onData(p, m)
      }
      return true
    }
    if (offer && now() < offer.until) {
      const m = await openMsg(offer.key, payload)
      if (m?.t === 'pair' && m.did === fromDid && now() <= m.exp) {
        offer = null
        d.onPairRequest(await request(fromDid, m.name, m.ask))
        return true
      }
    }
    return false
  }

  return {
    pairings: (): Pairing[] => store.pairings,
    /** Opens the relay connection. Safe to call once per page. */
    async start(): Promise<void> {
      store = load()
      identity = deserializeIdentity(store.identity)
      persist()
      channel.onRawWire((from, payload) => { void handle(from, payload).catch(() => false); return false })
      void channel.connect(identity).catch(() => { /* the channel keeps retrying; Sync now says "not on" until it is */ })
    },
    /** The code to show on the device that offers: its DID and a fresh one-time secret (valid 10 minutes, one use). */
    async offerCode(): Promise<string> {
      const secret = toB64u(randomBytes(16))
      offer = { secret, key: await pairKeyOf(fromB64u(secret)), until: now() + OFFER_MS }
      return pairingCode(identity.did, secret)
    },
    /** The device that scanned or typed the code: sends itself, and returns what to confirm (null: not a code). */
    async join(code: string): Promise<PairRequest | null> {
      const c = parsePairingCode(code)
      if (!c) return null
      await channel.sendRaw(c.did, await sealMsg(await pairKeyOf(fromB64u(c.secret)), { t: 'pair', did: identity.did, name: d.deviceName(), ...ask(), exp: stamp() }))
      return request(c.did, 'Other device')
    },
    unlink(did: string): void {
      store.pairings = store.pairings.filter((x) => x.did !== did)
      keys.delete(did)
      persist()
    },
    /** Starts a sync: only when the other device answers "ready" within 30 s and runs the same SYNC_VERSION. Rejects with "offline", "version" or "too large" (and with the relay's error if a send fails). */
    async syncNow(did: string): Promise<void> {
      const p = store.pairings.find((x) => x.did === did)
      if (!p) throw new Error('not linked')
      const sid = randomId(12)
      d.onLog(`Asking ${p.name} if it is on…`)
      const ready = new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => { waiting.delete(sid); resolve(null) }, d.handshakeMs ?? HANDSHAKE_MS)
        waiting.set(sid, (v) => { clearTimeout(timer); waiting.delete(sid); resolve(v) })
      })
      await send(did, { t: 'hello', sid, name: d.deviceName(), v: version, ...ask(), exp: stamp() })
      const v = await ready
      if (v === null) { d.onLog(`${p.name} did not answer: open TrustWeb there and try again`); throw new Error('offline') }
      if (v !== version) { d.onLog(`${p.name} runs an other version of TrustWeb: update it there`); throw new Error('version') }
      await sendBundle(p, false)
    },
    stop: (): void => channel.close(),
  }
}

export type SyncLink = ReturnType<typeof createSyncLink>
