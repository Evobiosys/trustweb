// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-look: the pure parts of a Mastodon-style Feed row (compact age, handle, first link). */
import { ageCompact, firstLink, handleOf } from '../../src/feed_row.ts'

const NOW = 1_760_000_000_000
const MIN = 60_000, H = 60 * MIN, D = 24 * H

describe('ageCompact', () => {
  it('counts down to the unit like Mastodon', () => {
    expect(ageCompact(NOW - 20_000, NOW)).toBe('now')
    expect(ageCompact(NOW - 5 * MIN, NOW)).toBe('5m')
    expect(ageCompact(NOW - 12 * H, NOW)).toBe('12h')
    expect(ageCompact(NOW - 3 * D, NOW)).toBe('3d')
    expect(ageCompact(NOW - 45 * D, NOW)).toBe('1mo')
    expect(ageCompact(NOW - 800 * D, NOW)).toBe('2y')
  })
  it('a time in the future reads as now', () => { expect(ageCompact(NOW + H, NOW)).toBe('now') })
})

describe('handleOf', () => {
  it('an explicit handle wins and is normalised to @user@host', () => {
    expect(handleOf({ kind: 'remote', who: 'Ulrich', handle: 'ulrichkelber@bonn.social' })).toBe('@ulrichkelber@bonn.social')
  })
  it('a remote post takes its handle from the context', () => {
    expect(handleOf({ kind: 'remote', who: 'Ann', context: '@ann@mastodon.social' })).toBe('@ann@mastodon.social')
  })
  it('a followed account takes it from the label', () => {
    expect(handleOf({ kind: 'follow', who: '@infomaniak@feedsin.space' })).toBe('@infomaniak@feedsin.space')
    expect(handleOf({ kind: 'follow', who: '#permaculture' })).toBeNull()
  })
  it('a local post has none', () => {
    expect(handleOf({ kind: 'social', who: null })).toBeNull()
    expect(handleOf({ kind: 'remote', who: 'Ann', context: 'not a handle' })).toBeNull()
  })
})

describe('firstLink', () => {
  it('finds the first http(s) link and its domain', () => {
    expect(firstLink('see https://www.harald-schirrer.de/seite, ok https://b.example')).toEqual({ url: 'https://www.harald-schirrer.de/seite', domain: 'harald-schirrer.de' })
  })
  it('no link, or only a non-web scheme: null', () => {
    expect(firstLink('nothing here')).toBeNull()
    expect(firstLink('javascript:alert(1) and ftp://x.org/f')).toBeNull()
  })
  it('drops trailing punctuation', () => { expect(firstLink('(https://a.org/x).')?.url).toBe('https://a.org/x') })
})
