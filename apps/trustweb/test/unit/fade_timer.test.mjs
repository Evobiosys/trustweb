// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Toast/notice life (src/fade_timer.ts): shown -> fading -> gone, pause on hover, close on the x, reduced motion. */
import { createFadeTimer } from '../../src/fade_timer.ts'

const make = (fadeMs = 400) => {
  const log = []
  const t = createFadeTimer({ ms: 5000, fadeMs, onFading: () => log.push('fading'), onGone: () => log.push('gone') })
  return { t, log }
}

describe('fade timer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is shown, fades after 5 s, is gone 400 ms later', () => {
    const { t, log } = make()
    t.start()
    expect(t.state).toBe('shown')
    vi.advanceTimersByTime(4999)
    expect(log).toEqual([])
    vi.advanceTimersByTime(1)
    expect(t.state).toBe('fading')
    vi.advanceTimersByTime(400)
    expect(t.state).toBe('gone')
    expect(log).toEqual(['fading', 'gone'])
  })
  it('hover pauses (also during the fade) and restarts the full wait on leave', () => {
    const { t, log } = make()
    t.start()
    vi.advanceTimersByTime(5100)
    t.pause()
    expect(t.state).toBe('shown')
    vi.advanceTimersByTime(60000)
    expect(t.state).toBe('shown')
    t.resume()
    vi.advanceTimersByTime(4999)
    expect(t.state).toBe('shown')
    vi.advanceTimersByTime(401)
    expect(log).toEqual(['fading', 'fading', 'gone'])
  })
  it('the x closes at once and only once', () => {
    const { t, log } = make()
    t.start()
    t.close()
    t.close()
    vi.advanceTimersByTime(10000)
    expect(log).toEqual(['gone'])
  })
  it('stop drops the timer silently (a replaced bar)', () => {
    const { t, log } = make()
    t.start()
    t.stop()
    vi.advanceTimersByTime(10000)
    expect(log).toEqual([])
  })
  it('reduced motion (fadeMs 0) hides without a fade', () => {
    const { t, log } = make(0)
    t.start()
    vi.advanceTimersByTime(5000)
    expect(log).toEqual(['gone'])
  })
})
