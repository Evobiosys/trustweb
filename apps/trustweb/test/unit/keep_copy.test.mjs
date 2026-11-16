// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-settings-sync: backup staleness and the once-only leave warning. */
import { COPY_STALE_MS, lastKept, markCopy, markWarned, shouldWarn, stale, markOffered, wasOffered } from '../../src/keep_copy.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } }
const DAY = 86_400_000

describe('keep_copy', () => {
  it('lastKept is the newer of the file copy and the server backup', () => {
    const s = mem()
    expect(lastKept(s)).toBe(0)
    markCopy(s, 500)
    expect(lastKept(s, 300)).toBe(500)
    expect(lastKept(s, 900)).toBe(900)
  })
  it('stale only after more than 7 days', () => {
    expect(stale({ lastKept: 0, now: 7 * DAY })).toBe(false)
    expect(stale({ lastKept: 0, now: 7 * DAY + 1 })).toBe(true)
  })
  it('warns once per stale period, never without data or while fresh', () => {
    const base = { hasData: true, lastKept: 1000, warnedAt: 0, now: 1000 + COPY_STALE_MS + 1 }
    expect(shouldWarn(base)).toBe(true)
    expect(shouldWarn({ ...base, hasData: false })).toBe(false)
    expect(shouldWarn({ ...base, now: 1000 + DAY })).toBe(false)
    expect(shouldWarn({ ...base, warnedAt: base.now })).toBe(false)
  })
  it('a new copy starts a new period', () => {
    expect(shouldWarn({ hasData: true, lastKept: 20 * DAY, warnedAt: 10 * DAY, now: 28 * DAY + 1 })).toBe(true)
  })
  it('remembers the offer and a damaged store counts as offered', () => {
    const s = mem()
    expect(wasOffered(s)).toBe(false)
    markOffered(s, 400)
    expect(wasOffered(s)).toBe(true)
    expect(lastKept(s)).toBe(400)
    expect(wasOffered({ getItem: () => { throw new Error('x') } })).toBe(true)
    markWarned(s, 1)
  })
})
