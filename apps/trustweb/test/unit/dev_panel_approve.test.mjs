// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { APPLY_DELAY_MS, applyOutcome, applyVerdicts, debounce, expandFor, noteText, subtreeKeys, waveState, walkShown, withBox } from '../../src/dev_preview_rules.ts'

const row = (key, requires = [], over = {}) => ({ key, branch: 'b/' + key, title: 'T-' + key, ref: 'abc1234', requires, checked: true, ...over })
const rows = [row('a'), row('b', ['a']), row('c', ['b']), row('d'), row('e', [], { checked: false })]

describe('panel approve (wave 28)', () => {
  it('approve is optimistic: the verdict lands on the row at once, the box and the other rows stay', () => {
    const next = applyVerdicts(rows, ['d'], 'merge')
    expect(next.map((f) => [f.key, f.checked, f.verdict])).toEqual([['a', true, undefined], ['b', true, undefined], ['c', true, undefined], ['d', true, 'merge'], ['e', false, undefined]])
    expect(rows[3].verdict).toBeUndefined()
  })
  it('needs work unloads the row (as the registry does) and keeps it; clearing keeps the box', () => {
    const w = applyVerdicts(rows, ['d'], 'needs-work')
    expect(w.find((f) => f.key === 'd')).toMatchObject({ checked: false, verdict: 'needs-work' })
    expect(applyVerdicts(applyVerdicts(rows, ['d'], 'merge'), ['d'], null).find((f) => f.key === 'd')).toMatchObject({ checked: true, verdict: null })
  })
  it('approving a row with sub-rows approves all of them; unchecked sub-rows are left out', () => {
    expect(subtreeKeys(rows, 'a')).toEqual(['a', 'b', 'c'])
    expect(subtreeKeys(rows, 'd')).toEqual(['d'])
    expect(subtreeKeys([...rows, row('f', ['a'], { checked: false })], 'a')).toEqual(['a', 'b', 'c'])
  })
  it('a box written optimistically cascades and drops the merge verdict of a row that leaves the preview', () => {
    const approved = applyVerdicts(rows, ['a', 'b'], 'merge')
    const off = withBox(approved, 'a', false)
    expect(off.map((f) => [f.key, f.checked, f.verdict ?? null])).toEqual([['a', false, null], ['b', false, null], ['c', false, null], ['d', true, null], ['e', false, null]])
  })
  it('the wave button: light green + warning while a loaded row was not approved individually, dark green when all were', () => {
    expect(waveState(rows, [])).toEqual({ warn: true, light: true, implicit: ['a', 'b', 'c', 'd'] })
    expect(waveState(rows, ['a', 'b', 'c', 'd'])).toEqual({ warn: false, light: false, implicit: [] })
    expect(waveState(rows, ['a', 'b', 'c']).implicit).toEqual(['d'])
    expect(waveState(rows.map((f) => ({ ...f, merged: true })), []).warn).toBe(false)
  })
  it('the warning expands the collapsed parents of the rows it names, nothing else', () => {
    expect(expandFor(rows, ['c'], ['a', 'b', 'd'])).toEqual(['d'])
    expect(expandFor(rows, ['d'], ['a'])).toEqual(['a'])
  })
  it('Walk shows only on a stored positive verdict (absent = hidden)', () => {
    expect([undefined, false, true].map((walkOk) => walkShown({ walkOk }))).toEqual([false, false, true])
  })
  it('the note names the preview, row, branch and ref so it pastes identifiably', () => {
    expect(noteText('tw261101_1147', rows[0])).toBe('tw261101_1147 | a | T-a | b/a@abc1234')
  })
  it('an apply is over when the registry stopped being pending: moved (a newer assembly), idle (nothing to assemble), else still running', () => {
    const at = new Date(10_000).toISOString()
    expect(applyOutcome({ pending: false, assembled: { at } }, 5_000, 6_000)).toBe('moved')
    expect(applyOutcome({ pending: false, assembled: { at } }, 20_000, 22_000)).toBe('running')
    expect(applyOutcome({ pending: false, assembled: { at } }, 20_000, 26_000)).toBe('idle')
    expect(applyOutcome({ pending: true, assembled: { at } }, 5_000, 99_000)).toBe('running')
  })
  it('the reassembly waits 1.3 s after the last box so several can be picked', () => {
    vi.useFakeTimers()
    const run = vi.fn(), d = debounce(run, APPLY_DELAY_MS)
    expect(APPLY_DELAY_MS).toBe(1300)
    d(); vi.advanceTimersByTime(1000); d(); vi.advanceTimersByTime(1000)
    expect(run).not.toHaveBeenCalled(); expect(d.waiting()).toBe(true)
    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledTimes(1); expect(d.waiting()).toBe(false)
    vi.useRealTimers()
  })
})
