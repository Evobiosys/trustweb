// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 mastodon-beta-events: the Mastodon instance of an event is set under Settings > Events > Beta features, no longer in the event's Advanced box. Fake data only. */
import { readFileSync } from 'node:fs'
import { betaEvents, setEventMastodon } from '../../src/events_beta_settings.ts'
import { newEvent } from '../../src/events.ts'
import { S } from '../../src/strings.ts'

const mk = (name, hosts, id) => newEvent({ name, from: '2026-12-30', where: 'Vienna', hosts }, id, 5)
const ME = { id: 'me1', displayName: 'Ben Example' }

describe('betaEvents: the events whose Mastodon instance I may set', () => {
  it('lists the events I host, not the ones others host', () => {
    const state = { me: ME, people: [], events: [mk('Mine', ['Ben Example'], 'e1'), mk('Theirs', ['Clara Other'], 'e2')] }
    expect(betaEvents(state).map((e) => e.id)).toEqual(['e1'])
  })
  it('no events = empty list', () => {
    expect(betaEvents({ me: ME, people: [] })).toEqual([])
  })
})

describe('setEventMastodon', () => {
  it('stores a host lower-case, returns it; empty clears', () => {
    const ev = mk('Mine', ['Ben Example'], 'e1')
    expect(setEventMastodon(ev, 'Mastodon.Social')).toBe('mastodon.social')
    expect(ev.mastodonInstance).toBe('mastodon.social')
    expect(setEventMastodon(ev, '')).toBe('')
    expect(ev.mastodonInstance).toBeUndefined()
  })
  it('a bad host throws and keeps the old one', () => {
    const ev = mk('Mine', ['Ben Example'], 'e1')
    setEventMastodon(ev, 'fosstodon.org')
    expect(() => setEventMastodon(ev, 'not a host')).toThrow()
    expect(ev.mastodonInstance).toBe('fosstodon.org')
  })
})

describe('strings and the old place', () => {
  it('the new section has its strings; the old keys stay', () => {
    expect(S.w45mastodon.title).toMatch(/Beta/)
    expect(S.w45mastodon.hint.length).toBeGreaterThan(10)
    expect(S.w43answers.mastodon.length).toBeGreaterThan(0)
  })
  it('the event editor no longer draws the Mastodon field', () => {
    const src = readFileSync(new URL('../../src/events_view.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('data-event-mastodon')
    expect(src).not.toContain('mastodonInput(')
  })
})
