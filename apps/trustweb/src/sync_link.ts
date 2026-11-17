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
 * 30 s or no sync starts; both carry SYNC_VERSION, a device of another version is told to update instead of a silent no-op) and data pieces (sync_core.ts toChunks).
 * Wave 40 (take another device's state): `want` asks a linked device for its record, which comes back as data pieces flagged `a: 'take'`; pieces flagged
 * `a: 'give'` are a device offering its record to replace this one's. Either way the receiver only asks its person (device_adopt.ts); unflagged pieces merge as before. The relay accepts unauthenticated ingress and holds a wire until
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
import { SCHEMA_VERSION, assertReadable } from './schema_version'
import { HANDSHAKE_MS, SYNC_TTL_MS, SYNC_VERSION, bundleOf, countsOf, deltaOf, fingerprintOf, fromChunks, mergeBundle, pairingCode, parsePairingCode, recordReview, refreshStamps, stampsAfterMerge, toChunks } from './sync_core'
import type { Counts, MergeResult, Stamps, SyncBundle } from './sync_core'
import { mergeCodes, withoutCodes } from './sync_code'
import type { CodeMerge } from './sync_code'
import { adoptBundle, differences, otherDifferences, previewChanges } from './device_adopt'
import type { ChangePreview, Differences } from './device_adopt'

export interface Pairing {
  did: string; name: string; fp: string; linkedAt: number; lastSyncAt: number
  /** Wave 15: the DID this device asks and answers with (the one its public link carries; hello, ready and pair announce it), so "opens on <device>" can name it. */
  askDid?: string
  /** Wave 15: false = my username and public link are NOT sent to this device (the tick on the confirm sheet). Absent = shared. */
  shareCode?: boolean
  /** Wave 43c: the automatic-sync version the other device announced (pair, hello, ready); absent = an older build: it gets no auto pieces. */
  au?: number
  /** Wave 43c: the stamp time up to which this device's changes went to that device automatically (0/absent: the full record goes first). */
  autoSentAt?: number
  /** Wave 44c: the first automatic send not yet acknowledged, how often it went out, and when the next try may go (backoff). Cleared by an ack. */
  autoPendingAt?: number
  autoTries?: number
  autoTryAt?: number
  autoLastTo?: number
}

interface Store { identity: SerializedIdentityV1; pairings: Pairing[]; stamps: Stamps }

/** A device waiting for the person's "Confirm" (both sides of a pairing show one). */
export interface PairRequest { name: string; fp: string; confirm(opts?: { shareCode?: boolean }): void; cancel(): void }

/** A record that arrived complete and waits for the person's "Confirm". `file`: also hand the person the pre-merge snapshot as an encrypted file (snapshot_view.ts). */
export interface Incoming { from: Pairing; /** Wave 40: set when the record comes to replace this one (take = I asked for it, give = the other device offers it); `accept` then still merges. */ adopt?: { kind: 'take' | 'give'; diff: Differences; /** Review wave 40: resources, meetings, events, tasks, invitations, chats replaced too. */ other: number; /** Wave 42 B17: the read-only difference by name; nothing is archived or replaced by it. */ preview(): ChangePreview; run(): Promise<boolean> }; /** Schema version of a bundle from a newer build: nothing to accept (schema_version.ts). */ newer?: number; counts: Counts; reply: boolean; accept(file: boolean): Promise<MergeResult>; decline(): void }

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
  /** Wave 26 (R52): false = this device only receives (sync_mode.ts): it sends no record, neither on Sync now nor as the reply to one it merged. Absent = sends. */
  canSend?: () => boolean
  /** Wave 40: keeps a copy of the record as it is now before an adoption replaces it; false = nothing kept, so nothing is replaced. */
  archive?: (reason: string, device: string) => boolean
  /** Wave 40: called once after an adoption went through. */
  onAdopted?: (device: string, diff: Differences) => void
  /** Review wave 40: a linked device asks for this record (its "Take this device's state"). Nothing leaves before this device's person taps:
   *  the host shows the question and calls `send` on Send. Absent = never answered. */
  onWant?: (name: string, send: () => Promise<void>) => void
  /** Overrides how long a handshake waits (tests). */
  handshakeMs?: number
  /** Overrides the SYNC_VERSION this device announces (tests). */
  version?: number
  /** Wave 43c: Auto sync is on on this device (sends its changes, merges what arrives without asking). Absent = off. */
  auto?: () => boolean
  /** Wave 43c: after an automatic merge changed the record (the host redraws). */
  onAutoMerged?: (from: Pairing, res: MergeResult) => void
  /** Overrides AUTO_VERSION (tests: 0 = an older build that announces none). */
  autoVersion?: number
}

type Msg =
  | { t: 'pair'; did: string; name: string; ask?: string; au?: number; exp: number }
  | { t: 'hello' | 'ready'; sid: string; name: string; v?: number; ask?: string; au?: number; exp: number }
  | { t: 'data'; sid: string; i: number; n: number; r: boolean; a?: 'take' | 'give'; auto?: true; to?: number; d: string; name: string; exp: number }
  | { t: 'ack'; sid: string; upTo: number; name: string; exp: number }
  | { t: 'want'; sid: string; name: string; exp: number }

const MAX_PIECES = 200
/** Wave 43c: the automatic sync this build speaks (announced as `au`). */
export const AUTO_VERSION = 2
/** Wave 44c: the first automatic-sync version that acknowledges what it merged (a device below it is sent to as before: the send counts). */
export const ACK_VERSION = 2
/** Wave 44c: an unacknowledged automatic send is tried again after this long, doubled each time up to AUTO_RETRY_MAX_MS. */
export const AUTO_RETRY_MS = 30_000
export const AUTO_RETRY_MAX_MS = 30 * 60_000
/** Wave 43c: an automatic piece is read for as long as the relay holds a wire (packages/transport MAX_HOLD_HORIZON_MS, 72 h), so a device that was off catches up. */
export const AUTO_TTL_MS = 72 * 60 * 60_000
/** Wave 43c: at most one snapshot per this long before automatic merges (each merge also keeps the loser in Review merge). */
export const AUTO_SNAPSHOT_MS = 60 * 60_000
/** Own HKDF label for the sync keys: a sync key can never open another channel's message. (No production pairings exist yet, so no migration.) */
const SYNC_KEY_INFO = 'trustweb-device-sync/v1'
const pairKeyOf = (secret: Uint8Array): Promise<CryptoKey> => deriveEcdhPairKey(secret, SYNC_KEY_INFO)
const OFFER_MS = SYNC_TTL_MS
/** An announced asking DID is a did:peer:2 of sane size (it only ever names a device in the list). */
const askOk = (v: unknown): v is string => typeof v === 'string' && /^did:peer:2\.[A-Za-z0-9.:_-]{20,1500}$/.test(v)

function utf8(s: string): Uint8Array { return new TextEncoder().encode(s) }
const auOk = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1000

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
  const partial = new Map<string, { n: number; parts: Uint8Array[]; got: number; reply: boolean; did: string; a?: 'take' | 'give'; auto?: true; to?: number }>()
  /** Devices whose record I asked for ("Take this device's state") and that has not come yet: did -> until when the ask holds (review wave 40). */
  const wanted = new Map<string, number>()
  /** Review wave 40: wants already answered or asked about (sid -> expiry): a relay replaying one never asks twice. */
  const seenWants = new Map<string, number>()
  let offer: { secret: string; key: CryptoKey; until: number } | null = null
  const autoVersion = d.autoVersion ?? AUTO_VERSION
  const au = (): { au?: number } => (autoVersion ? { au: autoVersion } : {})
  let lastAutoSnapshot: number | null = null
  /** Wave 43c: the first connect of the channel; the relay refuses a send of an identity it has not seen connect yet (401), so a send waits for it. */
  let connected: Promise<void> = Promise.resolve()
  /** Wave 43c: one automatic push at a time (a tick and a kick close together must not send the same delta twice). */
  let pushing: Promise<void> | null = null
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
  const send = async (did: string, msg: Msg): Promise<void> => { await connected; await channel.sendRaw(did, await sealMsg(await pairKey(did), msg)) }
  const stamp = (): number => now() + SYNC_TTL_MS
  const ask = (): { ask?: string } => { const a = d.askDid?.(); return askOk(a) ? { ask: a } : {} }

  /** The pairing request both sides show: the fingerprint of the shared secret, and what Confirm does. */
  async function request(did: string, name: string, ask?: string, theirAu?: number): Promise<PairRequest> {
    const fp = await fingerprintOf(ecdhSharedSecret(identity, did))
    return {
      name, fp,
      confirm: (opts) => {
        store.pairings = [...store.pairings.filter((p) => p.did !== did), {
          did, name, fp, linkedAt: now(), lastSyncAt: 0, ...(askOk(ask) ? { askDid: ask } : {}), ...(opts?.shareCode === false ? { shareCode: false } : {}), ...(auOk(theirAu) ? { au: theirAu } : {}),
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
      acc = { n: m.n, parts: [], got: 0, reply: m.r, did: p.did, ...(m.a === 'take' || m.a === 'give' ? { a: m.a } : {}), ...(m.auto === true && !m.a ? { auto: true as const, ...(typeof m.to === 'number' ? { to: m.to } : {}) } : {}) }
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
    if (acc.auto) {
      // Wave 44c: the sender hears of a merge only through this ack; an ignored or held piece set stays unacknowledged and comes again.
      if (await autoApply(p, bundle) && acc.to !== undefined) await send(p.did, { t: 'ack', sid: m.sid, upTo: acc.to, name: d.deviceName(), exp: stamp() }).catch(() => {})
      return
    }
    const asked = (wanted.get(p.did) ?? 0) >= now()
    wanted.delete(p.did)
    const kind = acc.a === 'take' && asked ? 'take' : acc.a ? 'give' : null
    d.onIncoming({
      from: p, ...(kind ? { adopt: { kind, diff: differences(d.state(), bundle), other: otherDifferences(d.state(), bundle), preview: () => previewChanges(d.state(), bundle), run: () => adopt(p, bundle) } } : {}), newer: bundle.schemaVersion !== undefined && bundle.schemaVersion > SCHEMA_VERSION ? bundle.schemaVersion : undefined, counts: countsOf(bundle), reply: acc.reply,
      accept: (file) => accept(p, bundle, acc.reply, file),
      decline: () => d.onLog(`Declined the record from ${p.name}`),
    })
  }

  /** Wave 43c: an automatic piece set merges without asking when Auto sync is on here (snapshot at most hourly), and sends nothing back. */
  async function autoApply(p: Pairing, bundle: SyncBundle): Promise<boolean> {
    if (d.auto?.() !== true) { d.onLog(`Auto sync is off: left a change from ${p.name} for Sync now`); return false }
    if (bundle.schemaVersion !== undefined && bundle.schemaVersion > SCHEMA_VERSION) { d.onLog(`${p.name} runs a newer TrustWeb: update this device`); return false }
    const snap = lastAutoSnapshot === null || now() - lastAutoSnapshot >= AUTO_SNAPSHOT_MS
    if (snap) lastAutoSnapshot = now()
    const res = await accept(p, bundle, true, false, snap)
    d.onAutoMerged?.(p, res)
    return true
  }

  async function accept(p: Pairing, bundle: SyncBundle, reply: boolean, file: boolean, snap = true): Promise<MergeResult> {
    assertReadable(bundle.schemaVersion)
    const s = d.state()
    if (snap) await d.snapshot(`before sync from ${p.name}`, file)
    const t = now()
    const me = d.deviceName()
    const before = refreshStamps(s, store.stamps, t, me)
    // A pairing this device does not share with takes no code and no display name from the other side either (F2, D3).
    const view = p.shareCode === false ? withoutCodes(bundle) : bundle
    const res = mergeBundle(s, before, view, p.lastSyncAt)
    if (view.connectCode) res.codes = mergeCodes(s, view, p.did)
    recordReview(s, res.conflicts)
    store.stamps = stampsAfterMerge(s, before, view, t, me, p.name)
    p.lastSyncAt = t
    persist()
    d.save()
    d.onLog(`Merged from ${p.name}: ${res.added} added, ${res.updated} updated, ${res.conflicts.length} to review`)
    if (res.codes && d.settleCodes) await d.settleCodes(res.codes).catch(() => d.onLog(`Could not settle the username with ${p.name}`))
    if (!reply && d.canSend?.() !== false) await sendBundle(p, true).catch(() => d.onLog(`Could not send ours back to ${p.name}`))
    return res
  }

  /** Wave 40: archive the record, then replace it with the bundle; the stamps follow the bundle so the next sync lists no conflict. False = the archive failed and nothing changed. */
  async function adopt(p: Pairing, bundle: SyncBundle): Promise<boolean> {
    assertReadable(bundle.schemaVersion)
    const s = d.state()
    const diff = differences(s, bundle)
    if (!d.archive?.(`before taking ${p.name}'s state`, p.name)) { d.onLog(`Could not keep a copy of this record: nothing was replaced`); return false }
    const t = now()
    const view = p.shareCode === false ? withoutCodes(bundle) : bundle
    // Review wave 40: replaced on a copy first, so odd data that throws half-way leaves this record as it was.
    const next = structuredClone(s)
    adoptBundle(next, view)
    for (const k of Object.keys(s)) if (!(k in next)) delete (s as unknown as Record<string, unknown>)[k]
    Object.assign(s, next)
    store.stamps = stampsAfterMerge(s, store.stamps, view, t, d.deviceName(), p.name)
    p.lastSyncAt = t
    persist()
    d.save()
    d.onAdopted?.(p.name, diff)
    d.onLog(`Took the state of ${p.name}: ${diff.people} people, ${diff.notes} notes, ${diff.settings} settings differed`)
    return true
  }

  /** Sends one bundle as sealed pieces; `auto` pieces live AUTO_TTL_MS and merge without a sheet on the other side. */
  async function sendPieces(p: Pairing, bundle: SyncBundle, reply: boolean, a?: 'take' | 'give', auto = false, to?: number): Promise<void> {
    const pieces = toChunks(bundle)
    if (pieces.length > MAX_PIECES) { d.onLog(`The record is too large to send (${pieces.length} pieces, the most is ${MAX_PIECES})`); throw new Error('too large') }
    const sid = randomId(12)
    const exp = auto ? now() + AUTO_TTL_MS : stamp()
    for (let i = 0; i < pieces.length; i++) {
      await send(p.did, { t: 'data', sid, i, n: pieces.length, r: reply, ...(a ? { a } : {}), ...(auto ? { auto: true as const } : {}), ...(to ? { to } : {}), d: toB64u(pieces[i]), name: d.deviceName(), exp })
      if (!auto) d.onLog(`Sending to ${p.name}: ${i + 1}/${pieces.length}`)
    }
  }

  /**
   * Wave 43c: one round of the automatic sync. A pairing whose auto version is unknown gets a hello (its ready says it); one that speaks it gets
   * this device's changes since the last round (sync_core.ts deltaOf), or nothing when there are none. A failed send leaves autoSentAt, so the next round retries.
   */
  async function autoPushOnce(): Promise<void> {
    if (d.auto?.() !== true || d.canSend?.() === false || !store.pairings.length) return
    const s = d.state()
    const t = now()
    store.stamps = refreshStamps(s, store.stamps, t, d.deviceName())
    let changed = false
    for (const p of store.pairings) {
      if (!auOk(p.au)) { await send(p.did, { t: 'hello', sid: randomId(12), name: d.deviceName(), v: version, ...ask(), ...au(), exp: stamp() }).catch(() => {}); continue }
      const acks = (p.au ?? 0) >= ACK_VERSION
      // Wave 44c: past the relay horizon the held wires are gone: start over with the full record (changes since the last ack no longer suffice).
      if (acks && p.autoPendingAt !== undefined && t - p.autoPendingAt > AUTO_TTL_MS) { p.autoSentAt = 0; delete p.autoPendingAt; delete p.autoTries; delete p.autoTryAt; delete p.autoLastTo; changed = true }
      if (acks && p.autoTryAt !== undefined && t < p.autoTryAt && !deltaOf(s, store.stamps, p.autoLastTo ?? 0, d.deviceName())) continue
      const delta = deltaOf(s, store.stamps, p.autoSentAt ?? 0, d.deviceName())
      if (!delta) continue
      const full = !p.autoSentAt
      const bundle = full && p.shareCode === false ? bundleOf(s, store.stamps, false) : delta
      try {
        await sendPieces(p, bundle, true, undefined, true, acks ? t : undefined)
        if (acks) { p.autoPendingAt ??= t; p.autoLastTo = t; p.autoTries = (p.autoTries ?? 0) + 1; p.autoTryAt = t + Math.min(AUTO_RETRY_MS * 2 ** (p.autoTries - 1), AUTO_RETRY_MAX_MS) } else p.autoSentAt = t
        changed = true
        d.onLog(`Sent ${full ? 'everything' : 'the changes'} to ${p.name}`)
      } catch { /* the relay is not reachable now: the next round sends the same changes */ }
    }
    if (changed) persist()
  }

  async function sendBundle(p: Pairing, reply: boolean, a?: 'take' | 'give'): Promise<void> {
    const s = d.state()
    // Once the code went out, a dead secret means "sync with the other device", never a new code (F3).
    if (p.shareCode !== false && s.connectCode && s.connectCode.owner !== 'other' && !s.connectCode.shared) { s.connectCode = { ...s.connectCode, shared: true }; d.save() }
    store.stamps = refreshStamps(s, store.stamps, now(), d.deviceName())
    persist()
    await sendPieces(p, bundleOf(s, store.stamps, p.shareCode !== false), reply, a)
  }

  /** Is the other device on and of the same version? Resolves with its pairing; rejects "not linked", "offline" or "version". */
  async function handshake(did: string): Promise<Pairing> {
    const p = store.pairings.find((x) => x.did === did)
    if (!p) throw new Error('not linked')
    const sid = randomId(12)
    d.onLog(`Asking ${p.name} if it is on…`)
    const ready = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { waiting.delete(sid); resolve(null) }, d.handshakeMs ?? HANDSHAKE_MS)
      waiting.set(sid, (v) => { clearTimeout(timer); waiting.delete(sid); resolve(v) })
    })
    await send(did, { t: 'hello', sid, name: d.deviceName(), v: version, ...ask(), ...au(), exp: stamp() })
    const v = await ready
    if (v === null) { d.onLog(`${p.name} did not answer: open TrustWeb there and try again`); throw new Error('offline') }
    if (v !== version) { d.onLog(`${p.name} runs an other version of TrustWeb: update it there`); throw new Error('version') }
    return p
  }

  async function handle(fromDid: string, payload: string): Promise<boolean> {
    const p = store.pairings.find((x) => x.did === fromDid)
    if (p) {
      const m = await openMsg(await pairKey(fromDid), payload)
      if (!m) return false
      if (m.t !== 'pair' && now() <= m.exp) {
        if (m.name && m.name !== p.name) { p.name = m.name; persist() }
        if ((m.t === 'hello' || m.t === 'ready') && askOk(m.ask) && m.ask !== p.askDid) { p.askDid = m.ask; persist() }
        if ((m.t === 'hello' || m.t === 'ready') && auOk(m.au) && m.au !== p.au) { p.au = m.au; persist() }
        if (m.t === 'hello') await send(fromDid, { t: 'ready', sid: m.sid, name: d.deviceName(), v: version, ...ask(), ...au(), exp: stamp() })
        else if (m.t === 'ready') waiting.get(m.sid)?.(m.v ?? 1)
        else if (m.t === 'data') await onData(p, m)
        else if (m.t === 'ack') {
          if (Number.isFinite(m.upTo)) { p.autoSentAt = Math.max(p.autoSentAt ?? 0, Math.min(m.upTo, now())); delete p.autoPendingAt; delete p.autoTries; delete p.autoTryAt; delete p.autoLastTo; persist() }
        }
        else if (m.t === 'want') {
          for (const [sid, until] of seenWants) if (until < now()) seenWants.delete(sid)
          if (seenWants.has(m.sid)) return true
          seenWants.set(m.sid, m.exp)
          if (d.canSend?.() === false) d.onLog(`${p.name} asked for this record, but this device only receives`)
          else if (!d.onWant) d.onLog(`${p.name} asked for this record; not answered`)
          else d.onWant(p.name, () => sendBundle(p, true, 'take').catch(() => d.onLog(`Could not send ours to ${p.name}`)))
        }
      }
      return true
    }
    if (offer && now() < offer.until) {
      const m = await openMsg(offer.key, payload)
      if (m?.t === 'pair' && m.did === fromDid && now() <= m.exp) {
        offer = null
        d.onPairRequest(await request(fromDid, m.name, m.ask, m.au))
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
      // True = this wire was ours and is consumed, so the relay acks it. Anything else stays un-acked and comes again on the next
      // drain; before this returned false for every wire, so the "Receive from <phone>?" sheet reopened on each reconnect.
      channel.onRawWire((from, payload) => handle(from, payload).catch(() => false))
      connected = channel.connect(identity).catch(() => { /* the channel keeps retrying; Sync now says "not on" until it is */ })
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
      await connected
      await channel.sendRaw(c.did, await sealMsg(await pairKeyOf(fromB64u(c.secret)), { t: 'pair', did: identity.did, name: d.deviceName(), ...ask(), ...au(), exp: stamp() }))
      return request(c.did, 'Other device')
    },
    /** The per-pairing tick "Shares my username" (D1). */
    setShare(did: string, on: boolean): void {
      const p = store.pairings.find((x) => x.did === did)
      if (!p) return
      if (on) delete p.shareCode
      else p.shareCode = false
      persist()
      d.onChange()
    },
    unlink(did: string): void {
      store.pairings = store.pairings.filter((x) => x.did !== did)
      keys.delete(did)
      wanted.delete(did)
      persist()
    },
    /** Starts a sync: only when the other device answers "ready" within 30 s and runs the same SYNC_VERSION. Rejects with "offline", "version", "too large" or "receive only" (and with the relay's error if a send fails). */
    async syncNow(did: string): Promise<void> {
      if (d.canSend?.() === false) throw new Error('receive only')
      await sendBundle(await handshake(did), false)
    },
    /** Wave 40: asks the linked device for its record; it arrives as an Incoming with adopt.kind 'take'. Rejects like syncNow (but sends nothing itself). */
    async takeFrom(did: string): Promise<void> {
      const p = await handshake(did)
      const exp = stamp()
      wanted.set(did, exp)
      try { await send(did, { t: 'want', sid: randomId(12), name: d.deviceName(), exp }) } catch (e) { wanted.delete(did); throw e }
      d.onLog(`Asked ${p.name} for its state`)
    },
    /** Wave 40: offers this record to the linked device to replace its own (its person confirms there). Rejects like syncNow. */
    async sendTo(did: string): Promise<void> {
      if (d.canSend?.() === false) throw new Error('receive only')
      await sendBundle(await handshake(did), true, 'give')
    },
    /** Wave 43c: one round of the automatic sync (sync_view.ts runs it on a timer, on visibility and on start); never throws. */
    autoTick(): Promise<void> {
      pushing ??= autoPushOnce().catch(() => { /* logged per pairing */ }).finally(() => { pushing = null })
      return pushing
    },
    /** Wave 43c: what Settings > My devices and MCP sync_status show: linked devices and the last sync with any of them, either way (0: never). */
    status: (): { devices: number; lastAt: number; unacked: number } => ({ devices: store.pairings.length, lastAt: Math.max(0, ...store.pairings.map((p) => Math.max(p.lastSyncAt, p.autoSentAt ?? 0))), unacked: store.pairings.filter((p) => p.autoPendingAt !== undefined).length }),
    stop: (): void => channel.close(),
  }
}

export type SyncLink = ReturnType<typeof createSyncLink>
