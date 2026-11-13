// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 review-panel: flat rows, state glyphs, derived Approve-wave box, conflict view (mark merged / fix session), pop-out state. */
import {
  afterKeys, approveBoxVisible, approveGate, conflictKey, conflictView, flatRows, rerunOffered, popoutHides, popoutIdle, popoutStep, rowState, sections, sessionIdOf, tree, waveReady,
} from '../../src/dev_preview_rules.ts'
import { S } from '../../src/strings.ts'

const f = (key, over = {}) => ({ key, branch: `wave41/${key}`, title: key, requires: [], checked: true, verdict: null, ...over })
const wave41 = [f('keyring-di-export'), f('review-fixes-41', { requires: ['keyring-di-export'] })]

describe('flat rows (B12/P07)', () => {
  it('keyring-di-export and review-fixes-41 are two siblings; tree() would nest them', () => {
    expect(tree(wave41)[0].children).toHaveLength(1)
    const rows = flatRows(wave41)
    expect(rows.map((n) => [n.feature.key, n.depth, n.children.length])).toEqual([['keyring-di-export', 0, 0], ['review-fixes-41', 0, 0]])
    expect(sections(rows)[0].nodes.map((n) => n.depth)).toEqual([0, 0])
  })
  it('requires only becomes the "after" chip', () => {
    expect(afterKeys(wave41[1])).toBe('keyring-di-export')
    expect(afterKeys(wave41[0])).toBeNull()
    expect(S.panelAfter('a, b')).toBe('after a, b')
  })
})

describe('row state glyphs (B03)', () => {
  it('to review = empty box, approved = check, needs work = cross; one string each', () => {
    expect(rowState(f('a'))).toBe('review')
    expect(rowState(f('a', { verdict: 'merge' }))).toBe('approved')
    expect(rowState(f('a', { verdict: 'needs-work', checked: false }))).toBe('needs-work')
    expect([S.panelStateReview, S.panelStateApproved, S.panelStateNeedsWork]).toEqual(['⬜️', '✅', '❌'])
  })
  it('a verdict on an unticked row does not show as approved', () => {
    expect(rowState(f('a', { verdict: 'merge', checked: false }))).toBe('review')
  })
})

describe('Approve wave box reappears (B14)', () => {
  const rows = (v1, v2) => [f('a', { verdict: v1 }), f('b', { verdict: v2 })]
  it('waveReady only when every loaded row is approved', () => {
    expect(waveReady(rows('merge', null))).toBe(false)
    expect(waveReady(rows('merge', 'merge'))).toBe(true)
    expect(waveReady([])).toBe(false)
    expect(waveReady([f('a', { checked: false })])).toBe(false)
  })
  it('the last merge verdict shows the box at once even in focus mode', () => {
    expect(approveBoxVisible({ collapsed: false, focused: true, ready: waveReady(rows('merge', null)) })).toBe(false)
    expect(approveBoxVisible({ collapsed: false, focused: true, ready: waveReady(rows('merge', 'merge')) })).toBe(true)
    expect(approveBoxVisible({ collapsed: true, focused: true, ready: true })).toBe(false)
  })
})

describe('conflict view (B01/B16)', () => {
  const err = 'wave36/ai-subscription: CONFLICT (content): Merge conflict in src/main.ts\nsecond line'
  const feats = [f('ai-subscription', { branch: 'wave36/ai-subscription', verdict: 'merge' })]
  it('gate.kind squashed-in-main with gate.action gives the one-tap mark-merged view', () => {
    const v = conflictView({ assembled: { error: err }, features: feats, gate: { kind: 'squashed-in-main', action: 'mark-merged ai-subscription', hint: 'ai-subscription is already in main (PR #61): mark it merged' } })
    expect(v).toEqual({ kind: 'mark-merged', key: 'ai-subscription', text: 'ai-subscription is already in main (PR #61): mark it merged' })
  })
  it('without gate fields (older ops): first conflict line, details, and the named row to fix', () => {
    const v = conflictView({ assembled: { error: err }, features: feats })
    expect(v).toMatchObject({ kind: 'conflict', fixKey: 'ai-subscription', detail: err })
    expect(v.head).toBe('Fix the conflict first: wave36/ai-subscription: CONFLICT (content): Merge conflict in src/main.ts')
  })
  it('an unknown gate kind or a malformed action falls back to the conflict text; nothing to say without error', () => {
    expect(conflictView({ assembled: { error: err }, features: feats, gate: { kind: 'other', action: 'x' } }).kind).toBe('conflict')
    expect(conflictView({ assembled: { error: err }, features: feats, gate: { kind: 'squashed-in-main', action: 'mark-merged' } }).kind).toBe('conflict')
    expect(conflictView({ assembled: null, features: feats })).toBeNull()
  })
  it('a pending assembly does not show the old mark-merged button', () => {
    expect(conflictView({ assembled: { error: err }, pending: true, features: feats, gate: { kind: 'squashed-in-main', action: 'mark-merged ai-subscription' } }).kind).toBe('conflict')
  })
  it('the gate mirror says "mark it merged" instead of the raw conflict', () => {
    const g = approveGate({ assembled: { sha: 'x', error: err }, features: feats, gate: { kind: 'squashed-in-main', action: 'mark-merged ai-subscription', hint: 'ai-subscription is already in main: mark it merged' } })
    expect(g).toEqual({ ok: false, hint: 'ai-subscription is already in main: mark it merged' })
    expect(approveGate({ assembled: { sha: 'x', error: err }, features: feats }).hint).toMatch(/^Fix the conflict first: wave36\/ai-subscription/)
  })
  it('conflictKey finds a row by key or branch, else null', () => {
    expect(conflictKey(feats, err)).toBe('ai-subscription')
    expect(conflictKey(feats, 'something else')).toBeNull()
  })
  it('a red CI (approvals step failed, text "CI failed ...") offers "Re-run the failed checks"; nothing else does (review wave 42)', () => {
    expect(rerunOffered({ step: 'failed', text: 'CI failed on PR #90: unit (re-running the failed jobs once)' })).toBe(true)
    for (const j of [{ step: 'failed', text: 'push refused' }, { step: 'ci-failed', text: 'CI failed on PR #90' }, { step: 'ready', text: 'CI failed' }, { step: 'failed' }]) expect(rerunOffered(j)).toBe(false)
    expect(S.panelRerunFailed).toBeTruthy()
  })
  it('sessionIdOf also reads the launched window the ops route answers (review wave 42)', () => {
    expect(sessionIdOf({ started: true, brief: '/d/conflict-x.txt', window: '4711' })).toBe('4711')
  })
  it('sessionIdOf reads the launcher answer', () => {
    expect(sessionIdOf({ sessionId: 'pi261112a' })).toBe('pi261112a')
    expect(sessionIdOf({ session: 'x' })).toBe('x')
    expect(sessionIdOf({})).toBeNull()
    expect(sessionIdOf(null)).toBeNull()
  })
})

describe('pop-out state (F11)', () => {
  it('open hides the inline panel while beats are fresh; close or silence restores it', () => {
    let s = popoutStep(popoutIdle, { type: 'open' }, 1000)
    expect(popoutHides(s, 1500)).toBe(true)
    s = popoutStep(s, { type: 'beat' }, 2000)
    expect(popoutHides(s, 5000)).toBe(true)
    expect(popoutHides(s, 5600)).toBe(false)   // the window died without "close"
    expect(popoutHides(popoutStep(s, { type: 'close' }, 2100), 2200)).toBe(false)
    expect(popoutHides(popoutIdle, 0)).toBe(false)
  })
})
