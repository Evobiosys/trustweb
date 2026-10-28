// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** First chat notification on a device carries "Turn these off" (wave 24). */
import { firstChatNotice } from '../../src/notify_first.ts'

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } }

describe('notify_first', () => {
  it('is true once, then false', () => {
    const s = store()
    expect(firstChatNotice(s)).toBe(true)
    expect(firstChatNotice(s)).toBe(false)
  })
  it('is false when storage is blocked (never nags)', () => {
    expect(firstChatNotice({ getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } })).toBe(false)
  })
})
