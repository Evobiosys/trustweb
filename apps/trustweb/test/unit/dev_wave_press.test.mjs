// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { approveEach, retryFor, unapprovedLine, waveBusy, waveIdle, waveLabel, waveStep } from '../../src/dev_wave_press.ts'

describe('Approve wave press state machine', () => {
  it('a press turns the label to Approving… at once, then Touch ID…, then hands over to the merge poll', () => {
    expect(waveLabel(waveIdle)).toBe('Approve wave')
    const a = waveStep(waveIdle, { type: 'press' })
    expect([a.phase, waveLabel(a), waveBusy(a)]).toEqual(['approving', 'Approving…', true])
    const t = waveStep(a, { type: 'merging' })
    expect([t.phase, waveLabel(t), waveBusy(t)]).toEqual(['touchid', 'Touch ID…', true])
    expect(waveStep(t, { type: 'handed' })).toEqual(waveIdle)
  })
  it('a press while busy is ignored (no second run)', () => {
    const a = waveStep(waveIdle, { type: 'press' })
    expect(waveStep(a, { type: 'press' })).toBe(a)
  })
  it('any failure keeps its reason, restores the label and lets the next press start again', () => {
    for (const from of ['press', 'merging']) {
      let s = waveStep(waveIdle, { type: 'press' })
      if (from === 'merging') s = waveStep(s, { type: 'merging' })
      const f = waveStep(s, { type: 'fail', reason: 'Preview server not answering' })
      expect(f).toEqual({ phase: 'failed', error: 'Preview server not answering' })
      expect(waveBusy(f)).toBe(false)
      expect(waveLabel(f)).toBe('Approve wave')
      expect(waveStep(f, { type: 'press' })).toEqual({ phase: 'approving', error: '' })
    }
  })
  it('the reminder line counts the unapproved items', () => {
    expect(unapprovedLine(3)).toBe('3 unapproved items open')
    expect(unapprovedLine(1)).toBe('1 unapproved items open')
  })
})

describe('retryFor (a restarting server)', () => {
  const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms } } }
  it('retries a failing call every 500 ms and returns the first success', async () => {
    const c = clock(); let n = 0
    const run = vi.fn(async () => { if (++n < 4) throw new Error('down'); return 'up' })
    await expect(retryFor(run, c)).resolves.toBe('up')
    expect(run).toHaveBeenCalledTimes(4); expect(c.now()).toBe(1500)
  })
  it('gives up after 10 s with the last error', async () => {
    const c = clock(); let n = 0
    await expect(retryFor(async () => { throw new Error('down ' + ++n) }, c)).rejects.toThrow(/^down \d+$/)
    expect(c.now()).toBeGreaterThanOrEqual(9500); expect(c.now()).toBeLessThanOrEqual(10000)
  })
  it('does not wait when the first call works', async () => {
    const c = clock()
    await retryFor(async () => 1, c)
    expect(c.now()).toBe(0)
  })
})

describe('approveEach (the per-row loop of Approve wave and Approve all)', () => {
  const rows = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }, { key: 'c', title: 'C' }]
  it('posts one row after the other', async () => {
    const seen = []
    await approveEach(rows, async (k) => { seen.push(k); return true })
    expect(seen).toEqual(['a', 'b', 'c'])
  })
  it('stops at the first row that was refused and names it', async () => {
    const seen = []
    await expect(approveEach(rows, async (k) => { seen.push(k); return k !== 'b' })).rejects.toThrow('Could not approve B')
    expect(seen).toEqual(['a', 'b'])
  })
})
