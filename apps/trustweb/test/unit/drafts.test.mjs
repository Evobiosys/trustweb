// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c event-autosave (eta): the generic draft store, its 10 MB cap, the 500 ms autosave, and that drafts stay on this device. Fake data only. */
import { DRAFT_MAX_BYTES, DRAFT_STORE_MAX_BYTES, DRAFT_DEBOUNCE_MS, createAutosave, discardDraft, draftKey, draftSize, getDraft, listDrafts, putDraft, withoutDrafts } from '../../src/drafts.ts'
import { SYNC_EXCLUDED, bundleOf, settingsOf } from '../../src/sync_core.ts'
import { exportFiles } from '../../src/sovereign_switch.ts'
import { askSources } from '../../src/cascade.ts'
import { Ring } from '../../src/model.ts'

const rec = () => ({ v: 1, me: { id: 'm', displayName: 'Test Person' }, people: [], inventory: [], peers: [], log: [] })

describe('the draft store', () => {
  it('caps a draft at exactly 10 MB', () => {
    expect(DRAFT_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(DRAFT_DEBOUNCE_MS).toBe(500)
  })
  it('keeps the form state under editor + target with its size and time', () => {
    const s = rec()
    expect(putDraft(s, 'ask', 'new', { text: 'Who has a ladder?' }, 1000)).toBe('saved')
    const d = getDraft(s, 'ask', 'new')
    expect(d).toEqual({ editor: 'ask', target: 'new', value: { text: 'Who has a ladder?' }, updatedAt: 1000, size: draftSize({ text: 'Who has a ladder?' }) })
    expect(draftKey('ask', 'new')).toBe('ask:new')
    expect(Object.keys(s.drafts)).toEqual(['ask:new'])
  })
  it('counts UTF-8 bytes of the JSON form', () => {
    expect(draftSize('ä')).toBe(4) // "ä" with quotes: 1 + 2 + 1
  })
  it('skips (and does not store) a state over 10 MB; an earlier draft stays', () => {
    const s = rec()
    putDraft(s, 'feed', 'new', { text: 'short' }, 1)
    expect(putDraft(s, 'feed', 'new', { text: 'x'.repeat(DRAFT_MAX_BYTES) }, 2)).toBe('too-big')
    expect(getDraft(s, 'feed', 'new').value).toEqual({ text: 'short' })
    const exact = 'y'.repeat(DRAFT_MAX_BYTES - 2) // with its two quotes: exactly the cap
    expect(draftSize(exact)).toBe(DRAFT_MAX_BYTES)
    // review-44c R3: the record (one localStorage value, ~5 MB) cannot hold a 10 MB draft; all drafts together stay under DRAFT_STORE_MAX_BYTES
    expect(putDraft(s, 'feed', 'big', exact, 3)).toBe('too-big')
    const fits = 'z'.repeat(DRAFT_STORE_MAX_BYTES - 2 - draftSize({ text: 'short' }))
    expect(putDraft(s, 'feed', 'big', fits, 4)).toBe('saved')
  })
  it('an empty state drops the draft', () => {
    const s = rec()
    putDraft(s, 'chat', 'p1', { text: 'hi' }, 1)
    expect(putDraft(s, 'chat', 'p1', { text: '' }, 2, (v) => !v.text)).toBe('empty')
    expect(getDraft(s, 'chat', 'p1')).toBeUndefined()
    expect(s.drafts).toBeUndefined()
  })
  it('lists newest first and discards by key', () => {
    const s = rec()
    putDraft(s, 'a', '1', 'one', 1)
    putDraft(s, 'b', '2', 'two', 5)
    expect(listDrafts(s).map((d) => draftKey(d.editor, d.target))).toEqual(['b:2', 'a:1'])
    expect(discardDraft(s, 'b:2')).toBe(true)
    expect(discardDraft(s, 'b:2')).toBe(false)
    expect(listDrafts(s).length).toBe(1)
  })
})

describe('drafts stay on this device', () => {
  const s = () => { const r = rec(); putDraft(r, 'ask', 'new', { text: 'private draft words' }, 1); return r }
  it('never sync: excluded from the settings a bundle carries', () => {
    expect(SYNC_EXCLUDED.has('drafts')).toBe(true)
    expect(settingsOf(s())).not.toHaveProperty('drafts')
    expect(JSON.stringify(bundleOf(s(), {}))).not.toContain('private draft words')
  })
  it('are stripped from the export and from what an ask is matched against', () => {
    const files = exportFiles(s(), 0)
    expect(files.find((f) => f.name === 'record.json').data).not.toContain('private draft words')
    expect(withoutDrafts(s())).not.toHaveProperty('drafts')
    expect(JSON.stringify(askSources(s(), Ring.Friend, 0))).not.toContain('private draft words')
  })
})

describe('createAutosave: debounced 500 ms, flush on leave, clear on send', () => {
  function harness(value = { text: '' }) {
    const state = rec()
    const timers = []
    let saves = 0
    const host = { state: () => state, save: () => { saves++ }, now: () => 42, later: (fn, ms) => { const t = { fn, ms, off: false }; timers.push(t); return () => { t.off = true } } }
    let v = value
    const auto = createAutosave(host, 'ask', 'new', () => v, (x) => !x.text)
    return { state, timers, auto, set: (x) => { v = x }, saves: () => saves, run: () => timers.filter((t) => !t.off).splice(0).forEach((t) => { t.off = true; t.fn() }) }
  }
  it('saves once, 500 ms after the last change', () => {
    const h = harness()
    h.set({ text: 'W' }); h.auto.changed()
    h.set({ text: 'Who' }); h.auto.changed()
    expect(h.timers.filter((t) => !t.off).map((t) => t.ms)).toEqual([500])
    expect(getDraft(h.state, 'ask', 'new')).toBeUndefined()
    h.run()
    expect(getDraft(h.state, 'ask', 'new').value).toEqual({ text: 'Who' })
    expect(h.saves()).toBe(1)
  })
  it('flush saves at once (tab switch, page hidden) and cancels the timer', () => {
    const h = harness()
    h.set({ text: 'Ladder' }); h.auto.changed(); h.auto.flush()
    expect(getDraft(h.state, 'ask', 'new').value).toEqual({ text: 'Ladder' })
    expect(h.timers.every((t) => t.off)).toBe(true)
  })
  it('clear drops the draft and any pending save (after a send)', () => {
    const h = harness()
    h.set({ text: 'sent' }); h.auto.changed(); h.auto.clear()
    h.run()
    expect(getDraft(h.state, 'ask', 'new')).toBeUndefined()
  })
  it('reports a state over 10 MB as too big, quietly', () => {
    const h = harness()
    h.set({ text: 'x'.repeat(DRAFT_MAX_BYTES) }); h.auto.flush()
    expect(h.auto.last()).toBe('too-big')
    expect(getDraft(h.state, 'ask', 'new')).toBeUndefined()
  })
  it('stored() is what a reopening editor restores', () => {
    const h = harness()
    h.set({ text: 'keep me' }); h.auto.flush()
    const again = createAutosave({ state: () => h.state, save: () => {}, now: () => 1, later: () => () => {} }, 'ask', 'new', () => ({ text: '' }))
    expect(again.stored()?.value).toEqual({ text: 'keep me' })
  })
})
