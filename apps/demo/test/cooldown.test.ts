import { describe, expect, it } from 'vitest'
import { ASK_COOLDOWN_MS, askIdentityKey, cooldownKey, decideAsk } from '../src/cooldown'
import type { AskCooldownRecord } from '../src/types'

/**
 * `decideAsk` is the pure math the receiving device runs before any
 * match/consent logic -- state.ts's `evaluateIncomingAsk` is a thin,
 * state-mutating wrapper around exactly this function, and main.ts's
 * `handleAmbientQuery`/`runConsentCeremony` call that wrapper. These tests
 * pin the decision table directly, same discipline as
 * test/incoming_query.test.ts's own header comment explains for
 * `classifyIncomingQuery`.
 */

const NOW = 1_757_000_000_000 // arbitrary fixed instant

describe('decideAsk', () => {
  it('allows a first-ever ask (no record) and opens a fresh window', () => {
    const d = decideAsk({ record: undefined, now: NOW, cooldownMs: ASK_COOLDOWN_MS, policy: 'default', escalationRequested: false })
    expect(d.allow).toBe(true)
    expect(d.escalationConsumed).toBe(false)
    expect(d.reason).toBe('first-ask')
    expect(d.nextRecord).toEqual({ windowStartAt: NOW, escalationUsedInWindow: false })
  })

  it('blocks a repeat within the window', () => {
    const record: AskCooldownRecord = { windowStartAt: NOW, escalationUsedInWindow: false }
    const d = decideAsk({
      record, now: NOW + ASK_COOLDOWN_MS - 1, cooldownMs: ASK_COOLDOWN_MS, policy: 'default', escalationRequested: false,
    })
    expect(d.allow).toBe(false)
    expect(d.reason).toBe('cooldown-active')
    expect(d.nextRecord).toBeUndefined() // a dropped ask must not touch the stored window
  })

  it('allows a repeat once the window has naturally elapsed, and opens a fresh one', () => {
    const record: AskCooldownRecord = { windowStartAt: NOW, escalationUsedInWindow: true }
    const d = decideAsk({
      record, now: NOW + ASK_COOLDOWN_MS, cooldownMs: ASK_COOLDOWN_MS, policy: 'default', escalationRequested: false,
    })
    expect(d.allow).toBe(true)
    expect(d.reason).toBe('window-elapsed')
    // A fresh window always starts with its escalation unspent, regardless
    // of whether the PRIOR window's was -- "gone until the cooldown
    // naturally expires" means it comes BACK once the window is fresh.
    expect(d.nextRecord).toEqual({ windowStartAt: NOW + ASK_COOLDOWN_MS, escalationUsedInWindow: false })
  })

  it('grants a single-use escalation within the window, without moving the window start', () => {
    const record: AskCooldownRecord = { windowStartAt: NOW, escalationUsedInWindow: false }
    const d = decideAsk({
      record, now: NOW + 1000, cooldownMs: ASK_COOLDOWN_MS, policy: 'default', escalationRequested: true,
    })
    expect(d.allow).toBe(true)
    expect(d.escalationConsumed).toBe(true)
    expect(d.reason).toBe('escalation-granted')
    // windowStartAt unchanged -- the natural expiry stays on its original
    // schedule even though an escalated ask just got through.
    expect(d.nextRecord).toEqual({ windowStartAt: NOW, escalationUsedInWindow: true })
  })

  it('refuses a second escalation in the same window', () => {
    const record: AskCooldownRecord = { windowStartAt: NOW, escalationUsedInWindow: true }
    const d = decideAsk({
      record, now: NOW + 2000, cooldownMs: ASK_COOLDOWN_MS, policy: 'default', escalationRequested: true,
    })
    expect(d.allow).toBe(false)
    expect(d.escalationConsumed).toBe(false)
    expect(d.reason).toBe('escalation-already-used')
    expect(d.nextRecord).toBeUndefined()
  })

  it('escalation becomes available again once the window naturally expires', () => {
    const record: AskCooldownRecord = { windowStartAt: NOW, escalationUsedInWindow: true }
    const d = decideAsk({
      record, now: NOW + ASK_COOLDOWN_MS + 1, cooldownMs: ASK_COOLDOWN_MS, policy: 'default', escalationRequested: true,
    })
    // The window elapsed BEFORE the escalation flag is even consulted -- a
    // fresh window, so this is an ordinary allowed ask, not an "escalation
    // granted" one (escalationConsumed is false: nothing needed spending).
    expect(d.allow).toBe(true)
    expect(d.escalationConsumed).toBe(false)
    expect(d.reason).toBe('window-elapsed')
    expect(d.nextRecord).toEqual({ windowStartAt: NOW + ASK_COOLDOWN_MS + 1, escalationUsedInWindow: false })
  })

  it('policy "off" allows every ask through regardless of window state', () => {
    const record: AskCooldownRecord = { windowStartAt: NOW, escalationUsedInWindow: false }
    const d = decideAsk({ record, now: NOW + 1, cooldownMs: ASK_COOLDOWN_MS, policy: 'off', escalationRequested: false })
    expect(d.allow).toBe(true)
    expect(d.reason).toBe('policy-off')
  })

  it('an escalation request is irrelevant, not an error, when the ask was never in cooldown to begin with', () => {
    const d = decideAsk({ record: undefined, now: NOW, cooldownMs: ASK_COOLDOWN_MS, policy: 'default', escalationRequested: true })
    expect(d.allow).toBe(true)
    expect(d.escalationConsumed).toBe(false) // nothing was spent; there was nothing to escalate past
    expect(d.reason).toBe('first-ask')
  })
})

describe('cooldownKey / askIdentityKey', () => {
  it('keys different askers separately even for the same question', () => {
    expect(cooldownKey('alice', 'tpl.ski')).not.toBe(cooldownKey('bob', 'tpl.ski'))
  })

  it('keys different questions from the same asker separately', () => {
    expect(cooldownKey('alice', 'tpl.ski')).not.toBe(cooldownKey('alice', 'tpl.wohnung'))
  })

  it('askIdentityKey prefers freeText over templateId, so two different free-text asks never share a window', () => {
    expect(askIdentityKey({ templateId: 'wot.freetext', freeText: 'Ski?' }))
      .toBe('Ski?')
    expect(askIdentityKey({ templateId: 'wot.freetext', freeText: 'Bohrmaschine?' }))
      .not.toBe(askIdentityKey({ templateId: 'wot.freetext', freeText: 'Ski?' }))
  })

  it('askIdentityKey falls back to templateId for a fixed-template ask', () => {
    expect(askIdentityKey({ templateId: 'wot.ski.v1' })).toBe('wot.ski.v1')
  })
})
