/**
 * relay_posture.ts's `mayRelayFor` -- the one gate a future carrier feature
 * (this device carrying a THIRD party's sealed traffic -- see that module's
 * own doc comment for why this is NOT the demo-21 second-hop question-
 * forward) must call before agreeing to carry anything. No carrier feature
 * exists in this tree yet, so this pins the posture logic itself: the
 * global default, the global override, and the per-peer override.
 */
import { describe, it, expect } from 'vitest'
import { actAsRelay, mayRelayFor, RELAY_POSTURE_DEFAULT_ON } from '../src/relay_posture'

describe('RELAY_POSTURE_DEFAULT_ON', () => {
  it('defaults to on', () => {
    expect(RELAY_POSTURE_DEFAULT_ON).toBe(true)
  })
})

describe('actAsRelay', () => {
  it('absent reads as the default (on)', () => {
    expect(actAsRelay({})).toBe(true)
  })

  it('an explicit false overrides the default', () => {
    expect(actAsRelay({ actAsRelay: false })).toBe(false)
  })

  it('an explicit true is honoured (even though it matches the default)', () => {
    expect(actAsRelay({ actAsRelay: true })).toBe(true)
  })
})

describe('mayRelayFor', () => {
  it('allows relaying for a peer with no override, when the global posture is on', () => {
    expect(mayRelayFor({}, { doNotRelayFor: false })).toBe(true)
    expect(mayRelayFor({}, undefined)).toBe(true)
    expect(mayRelayFor({}, null)).toBe(true)
  })

  it('the global posture off outranks everything, even a peer with no override', () => {
    expect(mayRelayFor({ actAsRelay: false }, { doNotRelayFor: false })).toBe(false)
    expect(mayRelayFor({ actAsRelay: false }, undefined)).toBe(false)
  })

  it('a per-peer "do not relay for this person" refuses only that peer', () => {
    expect(mayRelayFor({ actAsRelay: true }, { doNotRelayFor: true })).toBe(false)
    // ...while the global default still covers everyone else -- not
    // asserted here directly (that is the same call with a different peer
    // argument), but the function takes the peer as its own independent
    // parameter precisely so one override cannot leak onto another peer.
    expect(mayRelayFor({ actAsRelay: true }, { doNotRelayFor: false })).toBe(true)
  })

  it('global off and per-peer refusal combined still just refuses', () => {
    expect(mayRelayFor({ actAsRelay: false }, { doNotRelayFor: true })).toBe(false)
  })
})
