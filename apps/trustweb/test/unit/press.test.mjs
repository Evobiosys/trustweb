// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: one press = small card, two presses = full page (press.ts singleOrDouble). */
import { DOUBLE_MS, singleOrDouble } from '../../src/press.ts'

describe('singleOrDouble', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('a lone press fires single after the double window', () => {
    const one = vi.fn(); const two = vi.fn()
    const tap = singleOrDouble(one, two)
    tap()
    expect(one).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DOUBLE_MS)
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).not.toHaveBeenCalled()
  })
  it('two presses inside the window fire double only', () => {
    const one = vi.fn(); const two = vi.fn()
    const tap = singleOrDouble(one, two)
    tap(); vi.advanceTimersByTime(DOUBLE_MS - 50); tap()
    vi.advanceTimersByTime(DOUBLE_MS * 2)
    expect(two).toHaveBeenCalledTimes(1)
    expect(one).not.toHaveBeenCalled()
  })
  it('a third press after the double starts over', () => {
    const one = vi.fn(); const two = vi.fn()
    const tap = singleOrDouble(one, two)
    tap(); tap(); tap(); vi.advanceTimersByTime(DOUBLE_MS)
    expect(two).toHaveBeenCalledTimes(1)
    expect(one).toHaveBeenCalledTimes(1)
  })
})
