import { describe, expect, it } from 'vitest'
import { isFacebookFriendsJson, parseFacebookJson } from '../../src/import/facebook_json'
import { ContactSource } from '../../src/import/types'
import yourFriends from '../fixtures/contacts/fb_your_friends.json?raw'
import oldFriends from '../fixtures/contacts/fb_friends_old.json?raw'
import removedFriends from '../fixtures/contacts/fb_removed_friends.json?raw'

const fixture = (f: string): string =>
  ({ 'fb_your_friends.json': yourFriends, 'fb_friends_old.json': oldFriends, 'fb_removed_friends.json': removedFriends })[f] ?? ''

describe('parseFacebookJson', () => {
  it('reads friends_v2, repairs mojibake, skips empty names', () => {
    const r = parseFacebookJson(fixture('fb_your_friends.json'), 'your_friends.json')
    expect(r.skipped).toBe(1)
    expect(r.contacts.map((c) => c.name)).toEqual([
      'Anna Müller', 'Bernhard Grünwald', 'Lena Schönauer 🌸', 'Stefan Ährenthal', 'Maria Steinbacher', 'Josef Hinterleitner',
    ])
    const [anna, , , stefan, , josef] = r.contacts
    expect(anna).toMatchObject({
      source: ContactSource.FacebookJson, file: 'your_friends.json', sourceRef: '#1', phones: [], emails: [], labels: [], since: 1585699200000,
    })
    expect(stefan.emails).toEqual(['stefan@example.at'])
    expect(stefan.sourceRef).toBe('#4')
    expect(josef.since).toBeUndefined()
  })

  it('reads the older friends shape', () => {
    const r = parseFacebookJson(fixture('fb_friends_old.json'), 'friends.json')
    expect(r.contacts.map((c) => c.name)).toEqual(['Karin Eder', 'Franz Gruber', 'Gerda Weißenböck'])
  })

  it('gives nothing for other Facebook lists and other JSON', () => {
    const none = { contacts: [], skipped: 0 }
    expect(parseFacebookJson(fixture('fb_removed_friends.json'), 'r.json')).toEqual(none)
    expect(parseFacebookJson('[1,2]', 'a.json')).toEqual(none)
    expect(parseFacebookJson('{"friends_v2":"x"}', 'a.json')).toEqual(none)
  })

  it('keeps strings that are not valid UTF-8 bytes or hold code points above 255', () => {
    const json = JSON.stringify({ friends_v2: [{ name: 'Caf\u00e9' }, { name: 'Zoë \u4e2d' }] })
    expect(parseFacebookJson(json, 'f.json').contacts.map((c) => c.name)).toEqual(['Café', 'Zoë 中'])
  })

  it('ignores bad timestamps and non-string emails, counts malformed records', () => {
    const json = JSON.stringify({ friends_v2: [
      { name: 'A', timestamp: 'x', email: 5 }, { name: 'B', timestamp: -1, contact_info: 'b@example.com' }, 7, { timestamp: 1 },
    ] })
    const r = parseFacebookJson(json, 'f.json')
    expect(r.skipped).toBe(2)
    expect(r.contacts[0]).toMatchObject({ emails: [] })
    expect(r.contacts[0].since).toBeUndefined()
    expect(r.contacts[1].emails).toEqual(['b@example.com'])
    expect(r.contacts[1].since).toBeUndefined()
  })

  it('never throws on invalid JSON', () => {
    expect(parseFacebookJson('{nope', 'x.json')).toEqual({ contacts: [], skipped: 0 })
    expect(parseFacebookJson('', 'x.json')).toEqual({ contacts: [], skipped: 0 })
  })

  it('parses 5,000 friends under 1 s', () => {
    const friends = Array.from({ length: 5000 }, (_, i) => ({ name: `Fr\u00c3\u00bcnd ${i}`, timestamp: 1500000000 + i }))
    const t = performance.now()
    const r = parseFacebookJson(JSON.stringify({ friends_v2: friends }), 'big.json')
    expect(performance.now() - t).toBeLessThan(1000)
    expect(r.contacts).toHaveLength(5000)
    expect(r.contacts[4999].sourceRef).toBe('#5000')
  })
})

describe('isFacebookFriendsJson', () => {
  it('detects only friends lists', () => {
    expect(isFacebookFriendsJson(JSON.parse(fixture('fb_your_friends.json')))).toBe(true)
    expect(isFacebookFriendsJson(JSON.parse(fixture('fb_friends_old.json')))).toBe(true)
    expect(isFacebookFriendsJson(JSON.parse(fixture('fb_removed_friends.json')))).toBe(false)
    expect(isFacebookFriendsJson(null)).toBe(false)
    expect(isFacebookFriendsJson([])).toBe(false)
  })
})
