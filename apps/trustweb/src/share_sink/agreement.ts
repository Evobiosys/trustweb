// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (D1, S7, S8): a mutual feed agreement. A proposes, B signs; nothing flows until both have signed. Each party's cutoff is
 * the seq up to which that party's lines reach the other side. A standing feed moves its cutoff forward; a revoke lowers it from
 * a seq on and freezes it. Pure: values in, values out.
 */
import type { Scope } from './share_lines'

export interface Agreement {
  id: string
  parties: [string, string]
  scope: Scope
  terms: 'read-keep'
  /** Per party: the seq up to which their lines flow to the other party. */
  cutoff: Record<string, number>
  /** Per party: when they signed (ISO). Absent: not signed. */
  signedBy: Record<string, string>
  /** Per party: the seq a revoke took effect from. */
  revokedAt: Record<string, number>
}

export interface Line { seq: number; by: string; itemId: string }

export function proposeAgreement(id: string, from: string, to: string, scope: Scope, headSeq: number): Agreement {
  return { id, parties: [from, to], scope, terms: 'read-keep', cutoff: { [from]: headSeq }, signedBy: {}, revokedAt: {} }
}

export function signAgreement(a: Agreement, who: string, headSeq: number, now: Date): Agreement {
  if (!a.parties.includes(who)) throw new Error(`agreement ${a.id}: ${who} is not a party`)
  return { ...a, signedBy: { ...a.signedBy, [who]: now.toISOString() }, cutoff: { ...a.cutoff, [who]: headSeq } }
}

/** Active only when both parties have signed (I9: nothing flows by default). */
export const isActive = (a: Agreement): boolean => a.parties.every((p) => a.signedBy[p] !== undefined)

/** A standing feed moves its cutoff forward, never back, and not after a revoke. */
export function moveCutoff(a: Agreement, who: string, seq: number): Agreement {
  if (!isActive(a) || a.revokedAt[who] !== undefined) return a
  return { ...a, cutoff: { ...a.cutoff, [who]: Math.max(a.cutoff[who] ?? 0, seq) } }
}

/** Lines from seq `seq` on stop flowing; earlier lines are not taken back (S8). */
export function revokeFrom(a: Agreement, who: string, seq: number): Agreement {
  return { ...a, revokedAt: { ...a.revokedAt, [who]: seq }, cutoff: { ...a.cutoff, [who]: Math.min(a.cutoff[who] ?? 0, seq - 1) } }
}

/** What `viewer` receives: only the other party's lines, within their cutoff, and only while the agreement is active. */
export function visibleLines(a: Agreement, viewer: string, lines: readonly Line[]): Line[] {
  if (!isActive(a) || !a.parties.includes(viewer)) return []
  return lines.filter((l) => l.by !== viewer && a.parties.includes(l.by) && l.seq <= (a.cutoff[l.by] ?? 0))
}

/** A line may be retracted only before the receiver has opened it (S8). */
export const canRetract = (openedByReceiver: boolean): boolean => !openedByReceiver
