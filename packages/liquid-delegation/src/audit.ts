// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Audit trail: who delegated what to whom, when. The book is the current state; the log is append-only history (never rewritten). */
import { delegate, delegateOf, revoke, setAuto, type Delegation } from './delegation.ts'

export interface AuditEntry {
  at: number
  action: 'delegate' | 'revoke' | 'setAuto'
  from: string
  to?: string
  topic: string
  auto?: boolean
}
export interface Ledger { book: Delegation[]; log: AuditEntry[] }

export const emptyLedger = (): Ledger => ({ book: [], log: [] })

export const ledgerDelegate = (l: Ledger, d: Delegation, at: number): Ledger => ({
  book: delegate(l.book, d),
  log: [...l.log, { at, action: 'delegate', from: d.from, to: d.to, topic: d.topic, auto: d.auto }],
})

/** Revoking nothing logs nothing. */
export const ledgerRevoke = (l: Ledger, from: string, topic: string, at: number): Ledger => {
  const cur = delegateOf(l.book, from, topic)
  if (!cur) return l
  return { book: revoke(l.book, from, topic), log: [...l.log, { at, action: 'revoke', from, to: cur.to, topic }] }
}

export const ledgerSetAuto = (l: Ledger, from: string, topic: string, auto: boolean, at: number): Ledger => {
  const cur = delegateOf(l.book, from, topic)
  if (!cur || cur.auto === auto) return l
  return { book: setAuto(l.book, from, topic, auto), log: [...l.log, { at, action: 'setAuto', from, to: cur.to, topic, auto }] }
}

/** Everything `from` did on `topic`, oldest first. */
export const historyOf = (l: Ledger, from: string, topic: string): AuditEntry[] => l.log.filter((e) => e.from === from && e.topic === topic)
