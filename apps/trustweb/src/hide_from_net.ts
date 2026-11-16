// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b hide-from-crypto, the wire side (net.ts calls in at four points). The asker signs its "Hide from" list into every ask that
 * travels; a receiver checks it before it honours the ask (and before it passes it on), never passes it to a hidden device, and sends a
 * tamper report back the way the ask came when the list was changed. Each hop relays a report one level up (once per ask it passed on);
 * the asker verifies it and keeps it (AppState.hideReports) and the app shows it (onReport). Reports and level secrets of asks in flight
 * live in memory: a report that arrives after a reload of the asker's app is dropped.
 */
import type { Identity } from '../../demo/src/did'
import { fromB64u, toB64u } from '../../demo/src/crypto'
import type { HideReportEnvelope, QueryEnvelope } from '../../demo/src/types'
import {
  blobHash, deriveHopSecret, HIDE_TAGS_MAX, isExcluded, makeTamperReport, newAskSecret, signAskExclusion, verifyAskExclusion, verifyTamperReport,
} from './hide_from_crypto'
import type { ExclusionBlob, HideReason } from './hide_from_crypto'
import { addHideReport } from './hide_reports'
import type { HideReportEntry } from './hide_reports'
import type { AppState } from './model'

/** Asks in flight (asker side) and report routes (forwarder side) kept at most. */
const MEMORY_MAX = 500

/** What a receiver may do with an incoming ask: `drop` = answer like no match, show nothing, pass nothing on. */
export interface HideGate { drop: boolean; blob?: ExclusionBlob; sk?: Uint8Array }
export const NO_GATE: HideGate = { drop: false }

interface Sent { s0: Uint8Array; hash: string; text: string }
interface Route { upQid: string; upDid: string; toDid: string }

export interface HideNetDeps {
  identity(): Identity
  state(): AppState
  save(): void
  /** Seals with the pair key of `did` and sends. */
  send(did: string, env: HideReportEnvelope): Promise<void>
  onReport?(e: HideReportEntry): void
}

const remember = <K, V>(m: Map<K, V>, k: K, v: V): void => {
  m.set(k, v)
  if (m.size > MEMORY_MAX) m.delete(m.keys().next().value as K)
}

export class HideFromNet {
  private sent = new Map<string, Sent>()
  private qidRoot = new Map<string, string>()
  private routes = new Map<string, Route>()
  private nonces: string[] = []

  constructor(private d: HideNetDeps) {}

  /** Too many hidden DIDs to seal: the ask must not travel (it goes to direct contacts only). */
  static tooMany(hidden: readonly string[]): boolean { return new Set(hidden).size > HIDE_TAGS_MAX }

  /** Asker: the fields of an ask that travels (reach >= 2), sent with every one of `qids`. Always present, also for an empty list (padding). */
  async outgoing(a: { text: string; root: string; maxHops: number; issuedAt: number; hidden: readonly string[]; qids: readonly string[] }): Promise<Pick<QueryEnvelope, 'hx' | 'hk'>> {
    const s0 = newAskSecret()
    const blob = await signAskExclusion(this.d.identity(), { root: a.root, maxHops: a.maxHops, issuedAt: a.issuedAt, s0, dids: a.hidden })
    remember(this.sent, a.root, { s0, hash: await blobHash(blob), text: a.text })
    for (const q of a.qids) remember(this.qidRoot, q, a.root)
    return { hx: blob as unknown as Record<string, unknown>, hk: toB64u(s0) }
  }

  /**
   * Receiver: the gate of an ask at `hop`. No blob: an ask of an asker before this build (nothing to check). A blob that fails, or a level key
   * that is missing: dropped and reported to `senderDid` (qid of the ask it sent). A receiver that is itself hidden at its level: dropped quietly.
   */
  async gate(q: QueryEnvelope, c: { root: string | null; maxHops: number; hop: number; senderDid: string; now: number }): Promise<HideGate> {
    if (q.hx === undefined) return NO_GATE
    let sk: Uint8Array | null = null
    try { sk = q.hk ? fromB64u(q.hk) : null } catch { sk = null }
    const check = verifyAskExclusion(q.hx, c)
    if (check !== 'ok' || !sk || sk.length !== 32 || !c.root) {
      if (sk && c.root) void this.report(q, c.root, c.hop, check === 'unsupported' ? 'unsupported' : 'tampered', sk, c.senderDid, c.now)
      return { drop: true }
    }
    const blob = q.hx as unknown as ExclusionBlob
    const me = this.d.identity().did
    if (c.hop > 0 && await isExcluded(blob, c.hop, sk, [me])) return { drop: true }
    return { drop: false, blob, sk }
  }

  /** Forwarder at `gate`'s hop: is this candidate (all its DIDs) hidden at the next level? */
  async hides(g: HideGate, hop: number, dids: readonly string[]): Promise<boolean> {
    if (!g.blob || !g.sk) return false
    return isExcluded(g.blob, hop + 1, deriveHopSecret(g.sk, g.blob.r, 1), dids)
  }

  /** Forwarder: the fields of the ask passed on (the blob unchanged, the next level's secret), and the way back for a report. */
  passOn(g: HideGate, route: { qid: string; upQid: string; upDid: string; toDid: string }): Pick<QueryEnvelope, 'hx' | 'hk'> {
    if (!g.blob || !g.sk) return {}
    remember(this.routes, route.qid, { upQid: route.upQid, upDid: route.upDid, toDid: route.toDid })
    return { hx: g.blob as unknown as Record<string, unknown>, hk: toB64u(deriveHopSecret(g.sk, g.blob.r, 1)) }
  }

  private async report(q: QueryEnvelope, root: string, hop: number, why: HideReason, sk: Uint8Array, toDid: string, at: number): Promise<void> {
    const rep = await makeTamperReport(this.d.identity(), { root, hop, received: q.hx, why, sk, at })
    await this.d.send(toDid, { v: 1, t: 'hide-report', qid: q.qid, rep: rep as unknown as Record<string, unknown> }).catch(() => {})
  }

  /** A report arrived from `fromDids` (the sender's DIDs): passed one level up once, or, at the asker, verified and kept. */
  async onReport(env: HideReportEnvelope, fromDids: readonly string[]): Promise<void> {
    const route = this.routes.get(env.qid)
    if (route) {
      if (!fromDids.includes(route.toDid)) return
      this.routes.delete(env.qid)
      await this.d.send(route.upDid, { v: 1, t: 'hide-report', qid: route.upQid, rep: env.rep }).catch(() => {})
      return
    }
    const root = this.qidRoot.get(env.qid)
    const sent = root ? this.sent.get(root) : undefined
    if (!root || !sent) return
    const got = await verifyTamperReport(env.rep, { root, s0: sent.s0, sentHash: sent.hash, seen: this.nonces, now: Date.now() })
    if (!got.ok) return
    this.nonces = got.seen
    const entry: HideReportEntry = { askId: root, text: sent.text, step: got.report.hop + 1, why: got.report.why, at: got.report.at }
    const s = this.d.state()
    s.hideReports = addHideReport(s.hideReports, entry)
    this.d.save()
    this.d.onReport?.(entry)
  }
}
