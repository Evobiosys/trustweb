/**
 * state.ts's `evaluateIncomingAsk` -- the RECEIVING device's own integration
 * of cooldown.ts's pure `decideAsk`. Mute is checked here (state.ts's
 * `Peer.muted`), and the qid-memoisation (`askEvaluationCache`) is what
 * keeps main.ts's TWO call sites for one ambient-surfaced query (once in
 * `handleAmbientQuery`, once again in `runConsentCeremony` once a human
 * looks) from double-counting a single-use escalation or shifting the
 * window twice -- see state.ts's own doc comment on why that matters.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { evaluateIncomingAsk, __resetAskEvaluationCacheForTests } from '../src/state'
import { cooldownKey, ASK_COOLDOWN_MS } from '../src/cooldown'
import type { DeviceState, Peer } from '../src/state'

// evaluateIncomingAsk memoises by qid across the whole process (state.ts's
// own doc comment on `askEvaluationCache`) so main.ts's two call sites for
// one ambient-surfaced query never double-count it. That means literal
// qids reused across THESE test cases ('qid-1', 'qid-2', ...) would collide
// with each other too, unless the cache is cleared between tests -- a real
// device never reuses a `randomId(12)` qid, so this reset exists for tests
// only (see its own doc comment in state.ts).
beforeEach(() => { __resetAskEvaluationCacheForTests() })

const peer = (over: Partial<Peer> = {}): Peer => ({
  id: 'marlene0',
  displayName: 'Marlene',
  nonceSelf: 'a',
  noncePeer: 'b',
  connectedAt: 1_000,
  blocked: false,
  ...over,
})

const stateWith = (p: Peer[]): DeviceState => ({
  me: { id: 'nora0000', displayName: 'Nora' },
  threads: [],
  peers: p,
  profile: { displayName: 'Nora', bio: '', neighbourhood: '', languages: [] },
  inventory: [],
  queryLog: [],
})

const NOW = 1_757_000_000_000

describe('evaluateIncomingAsk', () => {
  it('allows and records a first-ever ask', () => {
    const s = stateWith([peer()])
    const r = evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    expect(r).toEqual({ outcome: 'ok', escalationGranted: false })
    expect(s.askCooldowns?.[cooldownKey('marlene0', 'wot.ski.v1')]).toEqual({ windowStartAt: NOW, escalationUsedInWindow: false })
  })

  it('drops a repeat within the window and does not touch the stored record', () => {
    const s = stateWith([peer()])
    evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    const before = { ...s.askCooldowns![cooldownKey('marlene0', 'wot.ski.v1')] }
    const r = evaluateIncomingAsk(s, 'qid-2', 'marlene0', 'wot.ski.v1', false, NOW + 1000)
    expect(r).toEqual({ outcome: 'cooldown', escalationGranted: false })
    expect(s.askCooldowns![cooldownKey('marlene0', 'wot.ski.v1')]).toEqual(before)
  })

  it('a mute takes priority over cooldown and never opens a window', () => {
    const s = stateWith([peer({ muted: true })])
    const r = evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    expect(r).toEqual({ outcome: 'muted', escalationGranted: false })
    expect(s.askCooldowns?.[cooldownKey('marlene0', 'wot.ski.v1')]).toBeUndefined()
  })

  it('grants a single-use escalation, and refuses a second one in the same window', () => {
    const s = stateWith([peer()])
    evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    const escalated = evaluateIncomingAsk(s, 'qid-2', 'marlene0', 'wot.ski.v1', true, NOW + 1000)
    expect(escalated).toEqual({ outcome: 'ok', escalationGranted: true })
    const secondEscalation = evaluateIncomingAsk(s, 'qid-3', 'marlene0', 'wot.ski.v1', true, NOW + 2000)
    expect(secondEscalation).toEqual({ outcome: 'cooldown', escalationGranted: false })
  })

  it('escalation is available again once the window naturally expires', () => {
    const s = stateWith([peer()])
    evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    evaluateIncomingAsk(s, 'qid-2', 'marlene0', 'wot.ski.v1', true, NOW + 1000) // spends it
    const afterExpiry = evaluateIncomingAsk(s, 'qid-3', 'marlene0', 'wot.ski.v1', true, NOW + ASK_COOLDOWN_MS + 1)
    // A fresh window: this is an ordinary first ask of the new window, not a
    // "granted escalation" (nothing needed spending -- see cooldown.test.ts).
    expect(afterExpiry).toEqual({ outcome: 'ok', escalationGranted: false })
  })

  it('is idempotent per qid: the SAME query evaluated twice never double-spends an escalation or double-shifts the window', () => {
    const s = stateWith([peer()])
    evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    const first = evaluateIncomingAsk(s, 'qid-2', 'marlene0', 'wot.ski.v1', true, NOW + 1000)
    // Re-evaluate the SAME qid ('qid-2'), simulating handleAmbientQuery
    // then runConsentCeremony both evaluating one ambient-surfaced query.
    const second = evaluateIncomingAsk(s, 'qid-2', 'marlene0', 'wot.ski.v1', true, NOW + 5000)
    expect(second).toEqual(first)
    // A third, genuinely NEW ask still finds the escalation already spent --
    // proving the cache did not silently re-open the window either.
    const third = evaluateIncomingAsk(s, 'qid-3', 'marlene0', 'wot.ski.v1', true, NOW + 6000)
    expect(third).toEqual({ outcome: 'cooldown', escalationGranted: false })
  })

  it('cooldownPolicy "off" allows every repeat through', () => {
    const s = stateWith([peer()])
    s.cooldownPolicy = 'off'
    evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    const r = evaluateIncomingAsk(s, 'qid-2', 'marlene0', 'wot.ski.v1', false, NOW + 1)
    expect(r.outcome).toBe('ok')
  })

  it('different askers, or different questions from the same asker, do not share a window', () => {
    const s = stateWith([peer({ id: 'marlene0' }), peer({ id: 'ben00000', displayName: 'Ben' })])
    evaluateIncomingAsk(s, 'qid-1', 'marlene0', 'wot.ski.v1', false, NOW)
    expect(evaluateIncomingAsk(s, 'qid-2', 'ben00000', 'wot.ski.v1', false, NOW + 1).outcome).toBe('ok')
    expect(evaluateIncomingAsk(s, 'qid-3', 'marlene0', 'wot.wohnung.v1', false, NOW + 1).outcome).toBe('ok')
  })
})
