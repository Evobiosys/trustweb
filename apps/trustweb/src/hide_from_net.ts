// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b hide-from-crypto, the wire side (net.ts calls in at four points). The asker signs its "Hide from" list into every ask that
 * travels; a receiver checks it before it honours the ask (and before it passes it on), never passes it to a hidden device, and seals a
 * tamper report straight to the asker's DID when the list was changed (answers-44a, Q3: the device that changed it never carries it, and
 * the report names nobody). The asker verifies it and keeps it (AppState.hideReports) and the app shows it (onReport). Level secrets of
 * asks in flight live in memory: a report that arrives after a reload of the asker's app is dropped.
 * Residual: a forwarder that rewrites the asker field of the blob itself (the signature then fails) diverts the report to that DID.
 */
import type { Identity } from '../../demo/src/did'
import { fromB64u, toB64u } from '../../demo/src/crypto'
import type { QueryEnvelope } from '../../demo/src/types'
import {
  blobHash, deriveHopSecret, HIDE_TAGS_MAX, isExcluded, verifyLevelKey, makeTamperReport, newAskSecret, openHideReport, sealHideReport, signAskExclusion,
  verifyAskExclusion, verifyTamperReport,
} from './hide_from_crypto'
import type { ExclusionBlob, HideReason, HideReportWire } from './hide_from_crypto'
import { addHideReport } from './hide_reports'
import type { HideReportEntry } from './hide_reports'
import type { AppState } from './model'

/**
 * Review-44 switch: an ask past the asker's direct contacts that arrives WITHOUT a blob. false = honoured (an asker or a forwarder on a build
 * before wave 44 drops the field; until every phone runs wave 44 a missing blob cannot tell an old build from a forwarder that stripped it).
 * true = dropped like a changed list (fail closed; asks through older phones then stop at them).
 */
export const HIDE_BLOB_REQUIRED = false

/** Asks in flight (asker side) kept at most. */
const MEMORY_MAX = 500

/** What a receiver may do with an incoming ask: `drop` = answer like no match, show nothing, pass nothing on. */
export interface HideGate { drop: boolean; blob?: ExclusionBlob; sk?: Uint8Array }
export const NO_GATE: HideGate = { drop: false }

interface Sent { s0: Uint8Array; hash: string; text: string }

export interface HideNetDeps {
  identity(): Identity
  state(): AppState
  save(): void
  /** Sends a sealed report wire to `did` on the relay's raw path. */
  sendRaw(did: string, wire: string): Promise<void>
  onReport?(e: HideReportEntry): void
}

const remember = <K, V>(m: Map<K, V>, k: K, v: V): void => {
  m.set(k, v)
  if (m.size > MEMORY_MAX) m.delete(m.keys().next().value as K)
}

export class HideFromNet {
  private sent = new Map<string, Sent>()
  private nonces: string[] = []

  constructor(private d: HideNetDeps) {}

  /** Too many hidden DIDs to seal: the ask must not travel (it goes to direct contacts only). */
  static tooMany(hidden: readonly string[]): boolean { return new Set(hidden).size > HIDE_TAGS_MAX }

  /** Asker: the fields of an ask that travels (reach >= 2). Always present, also for an empty list (padding). */
  async outgoing(a: { text: string; root: string; maxHops: number; issuedAt: number; hidden: readonly string[] }): Promise<Pick<QueryEnvelope, 'hx' | 'hk'>> {
    const s0 = newAskSecret()
    const blob = await signAskExclusion(this.d.identity(), { root: a.root, maxHops: a.maxHops, issuedAt: a.issuedAt, s0, dids: a.hidden })
    remember(this.sent, a.root, { s0, hash: await blobHash(blob), text: a.text })
    return { hx: blob as unknown as Record<string, unknown>, hk: toB64u(s0) }
  }

  /**
   * Receiver: the gate of an ask at `hop`. No blob: an ask of an asker before this build (nothing to check). A blob that fails, or a level key
   * that is missing: dropped and reported to the asker (at hop 0 `senderDid`, further out the blob's asker DID). A receiver that is itself
   * hidden at its level: dropped quietly.
   */
  async gate(q: QueryEnvelope, c: { root: string | null; maxHops: number; hop: number; senderDid: string; now: number }): Promise<HideGate> {
    if (q.hx === undefined) return HIDE_BLOB_REQUIRED && c.hop > 0 ? { drop: true } : NO_GATE
    let sk: Uint8Array | null = null
    try { sk = q.hk ? fromB64u(q.hk) : null } catch { sk = null }
    const check = verifyAskExclusion(q.hx, c)
    if (check !== 'ok' || !sk || sk.length !== 32 || !c.root) {
      const asker = c.hop === 0 ? c.senderDid : (q.hx as { d?: unknown } | null)?.d
      if (sk && c.root && typeof asker === 'string') void this.report(q, c.root, c.hop, check === 'unsupported' ? 'unsupported' : 'tampered', sk, asker, c.now)
      return { drop: true }
    }
    const blob = q.hx as unknown as ExclusionBlob
    // Review-44: a level key the asker did not commit to (a forwarder handed on another one): fail closed. No report: the asker could not
    // check its MAC (made with the wrong key).
    if (!(await verifyLevelKey(blob, c.hop, sk))) return { drop: true }
    const me = this.d.identity().did
    if (c.hop > 0 && await isExcluded(blob, c.hop, sk, [me])) return { drop: true }
    return { drop: false, blob, sk }
  }

  /** Forwarder at `gate`'s hop: is this candidate (all its DIDs) hidden at the next level? */
  async hides(g: HideGate, hop: number, dids: readonly string[]): Promise<boolean> {
    if (!g.blob || !g.sk) return false
    return isExcluded(g.blob, hop + 1, deriveHopSecret(g.sk, g.blob.r, 1), dids)
  }

  /** Forwarder: the fields of the ask passed on (the blob unchanged, the next level's secret). */
  passOn(g: HideGate): Pick<QueryEnvelope, 'hx' | 'hk'> {
    if (!g.blob || !g.sk) return {}
    return { hx: g.blob as unknown as Record<string, unknown>, hk: toB64u(deriveHopSecret(g.sk, g.blob.r, 1)) }
  }

  private async report(q: QueryEnvelope, root: string, hop: number, why: HideReason, sk: Uint8Array, askerDid: string, at: number): Promise<void> {
    try {
      const rep = await makeTamperReport({ root, hop, received: q.hx, why, sk, at })
      await this.d.sendRaw(askerDid, await sealHideReport(rep, askerDid))
    } catch { /* an asker DID that does not resolve, or the relay away: nothing to report to */ }
  }

  /** A sealed report arrived (who sent it is not kept): opened, matched to an ask of this device by its root, verified and kept. */
  async onReport(wire: HideReportWire): Promise<void> {
    const rep = await openHideReport(wire, this.d.identity())
    const root = (rep as { r?: unknown } | null)?.r
    const sent = typeof root === 'string' ? this.sent.get(root) : undefined
    if (typeof root !== 'string' || !sent) return
    const got = await verifyTamperReport(rep, { root, s0: sent.s0, sentHash: sent.hash, seen: this.nonces, now: Date.now() })
    if (!got.ok) return
    this.nonces = got.seen
    const entry: HideReportEntry = { askId: root, text: sent.text, step: got.report.hop + 1, why: got.report.why, at: got.report.at }
    const s = this.d.state()
    s.hideReports = addHideReport(s.hideReports, entry)
    this.d.save()
    this.d.onReport?.(entry)
  }
}
