// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** "Ask your web" also searches the person's own web and offers the search engine (ask_web_search.ts). */
import { ALL_SCOPE, ENGINE_DEFAULT, askScopes, matchWeb, searchEngineUrl, summaryPrompt } from '../../src/ask_web_search.ts'

const person = (id, name, context, extra = {}) => ({ id, name, context, lines: [], ...extra })
const rec = {
  askSets: [{ id: 's1', name: 'Housing', personIds: ['maya'], tags: ['flat'] }],
  people: [
    person('maya', 'Maya', 'has a spare room in Vienna', { peerId: 'pm' }),
    person('ben', 'Ben', 'cargo bike', { fields: { flat: 'true' } }),
    person('zed', 'Zed', 'spare room too'),
  ],
  inventory: [{ id: 'i1', text: 'Cargo bike, free on weekends', included: true }, { id: 'i2', text: 'Drill', included: false }],
  found: [{ id: 'f1', at: 1, text: 'room', shared: [{ from: 'Maya', peerId: 'pm', items: [{ text: 'Spare room Vienna', context: 'c', when: 'w' }] }] }],
}

describe('searchEngineUrl', () => {
  it('fills {q} with the encoded words', () => expect(searchEngineUrl('https://example.org/s?q={q}', ' spare room ')).toBe('https://example.org/s?q=spare%20room'))
  it('falls back to DuckDuckGo for an empty, non-https or {q}-less template', () => {
    for (const t of [undefined, '', 'http://x.org/?q={q}', 'https://x.org/']) expect(searchEngineUrl(t, 'a')).toBe(ENGINE_DEFAULT.replace('{q}', 'a'))
  })
  it('gives null for no words', () => expect(searchEngineUrl(undefined, '   ')).toBeNull())
})

describe('askScopes', () => {
  it('starts with everyone, then the named source sets', () => expect(askScopes(rec)).toEqual([{ id: ALL_SCOPE, name: '' }, { id: 's1', name: 'Housing' }]))
  it('is just everyone without sets', () => expect(askScopes({})).toEqual([{ id: ALL_SCOPE, name: '' }]))
})

describe('matchWeb', () => {
  it('finds people, own resources and shared items; every word must match, accents ignored', () => {
    const m = matchWeb(rec, 'spare ROOM')
    expect(m.map((x) => [x.kind, x.label])).toEqual([['person', 'Maya'], ['person', 'Zed'], ['shared', 'Spare room Vienna']])
    expect(matchWeb(rec, 'cargo').map((x) => x.kind)).toEqual(['person', 'resource'])
  })
  it('skips resources that are switched off', () => expect(matchWeb(rec, 'drill')).toEqual([]))
  it('limits a source set to its people, its tags and what they shared; no own resources', () => {
    expect(matchWeb(rec, 'room', 's1').map((x) => x.label)).toEqual(['Maya', 'Spare room Vienna'])
    expect(matchWeb(rec, 'cargo', 's1').map((x) => x.label)).toEqual(['Ben'])
  })
  it('finds nothing for no words', () => expect(matchWeb(rec, '  ')).toEqual([]))
})

describe('summaryPrompt', () => {
  it('numbers the matches so the answer can cite them', () => {
    const p = summaryPrompt('room', matchWeb(rec, 'room'))
    expect(p).toContain('[1] Maya')
    expect(p).toContain('[3] Spare room Vienna')
    expect(p).toContain('room')
  })
})
