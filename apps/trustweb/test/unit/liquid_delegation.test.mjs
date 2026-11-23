// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 settings-suggest: packages/liquid-delegation, who follows whom per topic; chains resolve to depth 1 now, A->B->C by API. */
import { MAX_DEPTH, delegate, delegateOf, followersOf, resolve, revoke, setAuto, cleanDelegations } from '../../../../packages/liquid-delegation/src/index.ts'

const d = (from, to, topic, auto = false) => ({ from, to, topic, auto, since: 1 })

describe('liquid-delegation', () => {
  it('one delegate per (from, topic): a new delegation replaces the old one', () => {
    let b = delegate([], d('a', 'b', 'privacy'))
    b = delegate(b, d('a', 'c', 'privacy'))
    b = delegate(b, d('a', 'b', 'feed'))
    expect(b).toHaveLength(2)
    expect(delegateOf(b, 'a', 'privacy').to).toBe('c')
    expect(delegateOf(b, 'a', 'feed').to).toBe('b')
    expect(delegateOf(b, 'a', 'events')).toBeUndefined()
  })
  it('never delegates to oneself and never mutates the input', () => {
    const b0 = Object.freeze([d('a', 'b', 'privacy')])
    expect(() => delegate(b0, d('a', 'a', 'feed'))).toThrow(/oneself/)
    const b1 = delegate(b0, d('x', 'b', 'privacy'))
    expect(b0).toHaveLength(1)
    expect(b1).toHaveLength(2)
  })
  it('revoke and followersOf', () => {
    let b = [d('a', 'me', 'privacy'), d('c', 'me', 'privacy'), d('a', 'me', 'feed'), d('me', 'z', 'privacy')]
    expect(followersOf(b, 'me', 'privacy').map((x) => x.from)).toEqual(['a', 'c'])
    b = revoke(b, 'a', 'privacy')
    expect(followersOf(b, 'me', 'privacy').map((x) => x.from)).toEqual(['c'])
    expect(delegateOf(b, 'a', 'feed')).toBeTruthy()
  })
  it('setAuto flips only that delegation', () => {
    const b = setAuto([d('a', 'b', 'privacy'), d('a', 'b', 'feed')], 'a', 'feed', true)
    expect(delegateOf(b, 'a', 'feed').auto).toBe(true)
    expect(delegateOf(b, 'a', 'privacy').auto).toBe(false)
  })
  it('resolve: depth 1 now stops at the direct delegate and says the chain went on', () => {
    expect(MAX_DEPTH).toBe(1)
    const b = [d('a', 'b', 'privacy'), d('b', 'c', 'privacy')]
    expect(resolve(b, 'a', 'privacy', MAX_DEPTH)).toEqual({ chain: ['a', 'b'], final: 'b', cycle: false, truncated: true })
    expect(resolve(b, 'b', 'privacy', MAX_DEPTH)).toEqual({ chain: ['b', 'c'], final: 'c', cycle: false, truncated: false })
    expect(resolve(b, 'c', 'privacy', MAX_DEPTH)).toEqual({ chain: ['c'], final: null, cycle: false, truncated: false })
  })
  it('resolve: the API already walks A->B->C with a deeper limit, and stops on a cycle', () => {
    const b = [d('a', 'b', 'privacy'), d('b', 'c', 'privacy'), d('c', 'a', 'feed')]
    expect(resolve(b, 'a', 'privacy', 5)).toEqual({ chain: ['a', 'b', 'c'], final: 'c', cycle: false, truncated: false })
    const loop = [d('a', 'b', 't'), d('b', 'c', 't'), d('c', 'a', 't')]
    expect(resolve(loop, 'a', 't', 5)).toEqual({ chain: ['a', 'b', 'c'], final: 'c', cycle: true, truncated: false })
  })
  it('cleanDelegations keeps well-formed rows only, the last per (from, topic)', () => {
    const raw = [d('a', 'b', 't'), { from: 'a' }, null, d('a', 'a', 't'), d('a', 'c', 't', true), { ...d('x', 'y', 'u'), auto: 'yes' }]
    expect(cleanDelegations(raw)).toEqual([d('a', 'c', 't', true), d('x', 'y', 'u', false)])
    expect(cleanDelegations('junk')).toEqual([])
  })
})
