/** Flood cap for reach-outs via the public link: sliding window of accepted times. */
import { allowReachOut } from '../../src/reach_out_guard.ts'

const H = 3600_000

describe('allowReachOut', () => {
  it('accepts under the cap and records the time', () => {
    expect(allowReachOut([1, 2], 3)).toEqual({ ok: true, log: [1, 2, 3] })
  })
  it('refuses at the cap and leaves the log as it was', () => {
    const log = Array.from({ length: 10 }, (_, i) => 100 + i)
    expect(allowReachOut(log, 200)).toEqual({ ok: false, log })
  })
  it('slides: entries older than the window stop counting', () => {
    const log = Array.from({ length: 10 }, (_, i) => i + 1)
    const r = allowReachOut(log, H + 11)
    expect(r.ok).toBe(true)
    expect(r.log).toEqual([H + 11])
  })
})
