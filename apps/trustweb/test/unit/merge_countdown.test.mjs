// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { createCountdown, suggestKeep } from '../../src/merge_countdown.ts'

describe('createCountdown', () => {
  it('counts 3, 2, 1 and fires once at 0', () => {
    const c = createCountdown()
    c.start(1000)
    expect(c.tick(1000)).toEqual({ secondsLeft: 3, fire: false })
    expect(c.tick(1999)).toEqual({ secondsLeft: 3, fire: false })
    expect(c.tick(2000)).toEqual({ secondsLeft: 2, fire: false })
    expect(c.tick(3000)).toEqual({ secondsLeft: 1, fire: false })
    expect(c.tick(4000)).toEqual({ secondsLeft: 0, fire: true })
    expect(c.tick(5000)).toEqual({ secondsLeft: 0, fire: false })
  })
  it('cancel stops it; idle never fires; start again restarts', () => {
    const c = createCountdown()
    expect(c.tick(9000).fire).toBe(false)
    c.start(0)
    c.cancel()
    expect(c.tick(9000).fire).toBe(false)
    c.start(9000)
    expect(c.tick(9000).secondsLeft).toBe(3)
  })
})

describe('suggestKeep', () => {
  const p = (id, n, metAt) => ({ id, metAt, lines: Array.from({ length: n }, (_, i) => i) })
  it('more lines wins', () => expect(suggestKeep(p('a', 1, 1), p('b', 2, 9)).id).toBe('b'))
  it('tie: older record wins', () => expect(suggestKeep(p('a', 1, 5), p('b', 1, 2)).id).toBe('b'))
  it('tie again: first argument', () => expect(suggestKeep(p('a', 1, 5), p('b', 1, 5)).id).toBe('a'))
})
