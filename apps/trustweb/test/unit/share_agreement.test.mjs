// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: mutual feed agreements (D1): nothing flows until both sign; the cutoff freezes at signing; revoke and retract (S7, S8). */
import { proposeAgreement, signAgreement, isActive, moveCutoff, revokeFrom, visibleLines, canRetract } from '../../src/share_sink/agreement.ts'

const scope = { zone: 'friend', include: [], exclude: [] }
const LINES = [4, 5, 6, 7, 8].map((seq) => ({ seq, by: 'person:ada', itemId: 'item:post' + seq }))
const seqs = (ls) => ls.map((l) => l.seq)
const NOW = new Date('2026-10-31T10:00:00.000Z')

describe('mutual feed agreement (T8)', () => {
  it('nothing flows with one signature; the both-signed agreement is active', () => {
    let a = proposeAgreement('agr:1', 'person:ada', 'person:bo', scope, 0)
    a = signAgreement(a, 'person:ada', 5, NOW)
    expect(isActive(a)).toBe(false)
    expect(visibleLines(a, 'person:bo', LINES)).toEqual([])
    a = signAgreement(a, 'person:bo', 7, NOW)
    expect(isActive(a)).toBe(true)
  })
  it('the cutoff freezes at the signed seq: later lines do not flow', () => {
    let a = proposeAgreement('agr:1', 'person:ada', 'person:bo', scope, 0)
    a = signAgreement(a, 'person:ada', 5, NOW)
    a = signAgreement(a, 'person:bo', 7, NOW)
    expect(seqs(visibleLines(a, 'person:bo', LINES))).toEqual([4, 5])
  })
  it('only the other party sees a line; the author does not get their own back', () => {
    let a = proposeAgreement('agr:1', 'person:ada', 'person:bo', scope, 9)
    a = signAgreement(a, 'person:ada', 9, NOW)
    a = signAgreement(a, 'person:bo', 9, NOW)
    expect(visibleLines(a, 'person:ada', LINES)).toEqual([])
  })
})

describe('standing feed moves its cutoff (T9)', () => {
  it('a line past the cutoff is visible only once the cutoff moves', () => {
    let a = proposeAgreement('agr:1', 'person:ada', 'person:bo', scope, 5)
    a = signAgreement(a, 'person:ada', 5, NOW)
    a = signAgreement(a, 'person:bo', 5, NOW)
    expect(seqs(visibleLines(a, 'person:bo', LINES))).toEqual([4, 5])
    a = moveCutoff(a, 'person:ada', 8)
    expect(seqs(visibleLines(a, 'person:bo', LINES))).toEqual([4, 5, 6, 7, 8])
    expect(moveCutoff(a, 'person:ada', 6).cutoff['person:ada']).toBe(8)
  })
})

describe('revoke and retract (T10, T11)', () => {
  it('revoke at N hides lines from N on and leaves earlier ones', () => {
    let a = proposeAgreement('agr:1', 'person:ada', 'person:bo', scope, 8)
    a = signAgreement(a, 'person:ada', 8, NOW)
    a = signAgreement(a, 'person:bo', 8, NOW)
    a = revokeFrom(a, 'person:ada', 6)
    expect(seqs(visibleLines(a, 'person:bo', LINES))).toEqual([4, 5])
  })
  it('a revoked feed cannot be moved forward again', () => {
    let a = proposeAgreement('agr:1', 'person:ada', 'person:bo', scope, 8)
    a = signAgreement(a, 'person:ada', 8, NOW)
    a = signAgreement(a, 'person:bo', 8, NOW)
    a = revokeFrom(a, 'person:ada', 6)
    expect(seqs(visibleLines(moveCutoff(a, 'person:ada', 8), 'person:bo', LINES))).toEqual([4, 5])
  })
  it('retract is allowed before the receiver opens the line, refused after', () => {
    expect(canRetract(false)).toBe(true)
    expect(canRetract(true)).toBe(false)
  })
})
