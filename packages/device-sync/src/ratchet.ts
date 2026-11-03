// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * ratchet.ts -- a symmetric KDF chain per (pairing, direction): "chain key → message key", keys deleted after use.
 *
 * WHY (forward secrecy): with the static per-direction keys of keys.ts, whoever later captures a device's state can open every
 * wire the relay (or anyone) still holds. Here each direction starts from a 32-byte root (keys.ts derivePairRoots) and steps
 * a one-way chain, Signal-style:
 *     message key(ctr) = HKDF-SHA256(chain(ctr), salt empty, info RATCHET_INFO_MSG)    → AES-GCM-256, non-extractable
 *     chain(ctr + 1)   = HKDF-SHA256(chain(ctr), salt empty, info RATCHET_INFO_CHAIN)  → 32 bytes
 * After a step the old chain key is not kept anywhere in the returned state, and a used message key is deleted. HKDF is one-way,
 * so a device state captured LATER (chain(n) plus the skipped keys still held) cannot re-derive chain(k < n) or the key of any
 * message it already sent or received: those earlier wires stay closed.
 *
 * Out-of-order delivery (the relay does not promise order): a counter ahead of `next` derives and keeps the message keys of the
 * gap in `skipped`, at most MAX_SKIP of them (oldest evicted); a counter more than MAX_SKIP ahead is refused. A skipped key is
 * handed out once and deleted, so a second delivery of the same wire finds no key: that is the replay defence (it replaces
 * the retired archive/replay.ts window for ratcheted traffic). Every function is pure: it never mutates its input and returns a fresh, JSON-safe state the
 * caller persists. A caller must commit the new state only after the wire actually opened (the counter comes from an
 * unauthenticated wire prefix; see seal.ts).
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - NO break-in recovery / post-compromise security. There is no DH ratchet: no fresh key agreement ever enters the chain. Whoever
 *    obtains the CURRENT chain key can derive every FUTURE message key of that direction, silently, until the devices pair again.
 *  - Skipped keys are kept for out-of-order delivery, up to MAX_SKIP per direction. They are a bounded window of exposure: a state
 *    captured while they are held opens those not-yet-delivered messages. Evicted ones are gone; those messages cannot be opened.
 *  - "Deleted" means not retained by this module or in the state it returns. JavaScript cannot wipe memory, and old copies of a
 *    persisted state may survive in the storage layer (IndexedDB / localStorage files, OS swap, backups) beyond our control.
 *  - A restore from an older backup REWINDS the chain: the restored device would re-derive keys it already used (and its peer has
 *    moved on), so a restore needs pairing again. This is the price of forward secrecy, not a bug to work around.
 *  - A ctr far ahead (≤ MAX_SKIP) costs the receiver up to 2·MAX_SKIP HKDF steps before the wire is authenticated; bounded, not free.
 *  - The root comes from static X25519 keys: forward secrecy here is only against a LATER capture of the ratchet state, not
 *    against a later theft of the long-term device key together with the pairing epoch (which re-derives the root).
 *  - NO post-quantum security, NO metadata protection (the counter is visible on the wire, see seal.ts).
 */
import { fromB64u, toB64u, utf8 } from './bytes.ts'

export const MAX_SKIP = 1024
export const RATCHET_INFO_MSG = 'trustweb-device-sync/v2/ratchet/msg'
export const RATCHET_INFO_CHAIN = 'trustweb-device-sync/v2/ratchet/chain'

export interface ChainState {
  /** base64url of the current 32-byte chain key */
  chain: string
  /** the ctr this chain key yields; starts at 1 */
  next: number
  /** ctr (decimal string) → base64url 32-byte message key, at most MAX_SKIP entries, all < next */
  skipped: Record<string, string>
}

const KEY_LEN = 32
const subtle = (): SubtleCrypto => globalThis.crypto.subtle
const EMPTY = new Uint8Array(0)

function isCtr(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0
}

async function hkdfBits(ikm: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: EMPTY as BufferSource, info: utf8(info) as BufferSource },
    base,
    KEY_LEN * 8,
  )
  return new Uint8Array(bits)
}

/** One chain step: the raw message key for this chain key, and the next chain key. */
async function step(chain: Uint8Array): Promise<{ mk: Uint8Array; chain: Uint8Array }> {
  return { mk: await hkdfBits(chain, RATCHET_INFO_MSG), chain: await hkdfBits(chain, RATCHET_INFO_CHAIN) }
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** chain = root (32 bytes), next = 1, no skipped keys. Throws on a root that is not 32 bytes. */
export async function initChain(root: Uint8Array): Promise<ChainState> {
  if (!(root instanceof Uint8Array) || root.length !== KEY_LEN) throw new Error(`ratchet root must be ${KEY_LEN} bytes`)
  return { chain: toB64u(root), next: 1, skipped: {} }
}

/** The key for the next outgoing message (ctr = s.next) and the state after it. Never mutates `s`. */
export async function sendKey(s: ChainState): Promise<{ ctr: number; key: CryptoKey; state: ChainState }> {
  if (!isCtr(s.next) || s.next >= Number.MAX_SAFE_INTEGER) throw new Error('ratchet: send counter exhausted or invalid')
  const st = await step(fromB64u(s.chain))
  const key = await aesKey(st.mk)
  st.mk.fill(0)
  return { ctr: s.next, key, state: { chain: toB64u(st.chain), next: s.next + 1, skipped: { ...s.skipped } } }
}

/**
 * The key for an incoming message with counter `ctr`, and the state after it; null when there is no key for it (invalid ctr,
 * more than MAX_SKIP ahead, already used, evicted or older than the chain). Never mutates `s`.
 */
export async function receiveKey(s: ChainState, ctr: number): Promise<{ key: CryptoKey; state: ChainState } | null> {
  if (!isCtr(ctr) || ctr >= Number.MAX_SAFE_INTEGER) return null
  if (ctr < s.next) {
    const id = String(ctr)
    if (!Object.hasOwn(s.skipped, id)) return null
    const skipped = { ...s.skipped }
    const raw = fromB64u(skipped[id])
    delete skipped[id]
    return { key: await aesKey(raw), state: { chain: s.chain, next: s.next, skipped } }
  }
  if (ctr - s.next > MAX_SKIP) return null
  const skipped = { ...s.skipped }
  let chain = fromB64u(s.chain)
  for (let c = s.next; c < ctr; c++) {
    const st = await step(chain)
    skipped[String(c)] = toB64u(st.mk)
    chain = st.chain
  }
  const st = await step(chain)
  const key = await aesKey(st.mk)
  st.mk.fill(0)
  const ids = Object.keys(skipped)
  if (ids.length > MAX_SKIP) {
    ids.sort((a, b) => Number(a) - Number(b))
    for (const id of ids.slice(0, ids.length - MAX_SKIP)) delete skipped[id]
  }
  return { key, state: { chain: toB64u(st.chain), next: ctr + 1, skipped } }
}

function isKey32(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    return fromB64u(v).length === KEY_LEN
  } catch {
    return false
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** A copy of `v` if it is exactly a state this module could have produced; otherwise null. */
export function parseChainState(v: unknown): ChainState | null {
  if (!isPlainObject(v)) return null
  const keys = Object.keys(v)
  if (keys.length !== 3 || !keys.includes('chain') || !keys.includes('next') || !keys.includes('skipped')) return null
  const { chain, next, skipped } = v
  if (!isKey32(chain) || !isCtr(next) || !isPlainObject(skipped)) return null
  const ids = Object.keys(skipped)
  if (ids.length > MAX_SKIP) return null
  const out: Record<string, string> = {}
  for (const id of ids) {
    if (!/^[1-9][0-9]*$/.test(id)) return null
    const c = Number(id)
    if (!isCtr(c) || c >= next) return null
    const mk = skipped[id]
    if (!isKey32(mk)) return null
    out[id] = mk
  }
  return { chain, next, skipped: out }
}
