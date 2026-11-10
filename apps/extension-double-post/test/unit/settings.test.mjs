// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { DEFAULT_SETTINGS, mergeSettings, shouldAsk } from '../../src/settings'

describe('mergeSettings', () => {
  it('returns defaults for nothing or junk', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings({ baseUrl: 5, sites: 'x', never: 3 })).toEqual(DEFAULT_SETTINGS)
  })
  it('keeps valid values, drops bad base URL and non-string hosts', () => {
    const s = mergeSettings({ baseUrl: 'http://127.0.0.1:5270', sites: { x: false }, never: ['a.org', 7] })
    expect(s.baseUrl).toBe('http://127.0.0.1:5270')
    expect(s.sites).toEqual({ mastodon: true, x: false, facebook: true, linkedin: true })
    expect(s.never).toEqual(['a.org'])
    expect(mergeSettings({ baseUrl: 'http://evil.example' }).baseUrl).toBe(DEFAULT_SETTINGS.baseUrl)
  })
})

describe('shouldAsk', () => {
  it('asks by default', () => {
    expect(shouldAsk(DEFAULT_SETTINGS, 'x', 'x.com')).toBe(true)
  })
  it('respects the per-network toggle and the never-on-this-site list', () => {
    expect(shouldAsk(mergeSettings({ sites: { x: false } }), 'x', 'x.com')).toBe(false)
    expect(shouldAsk(mergeSettings({ never: ['mastodon.social'] }), 'mastodon', 'mastodon.social')).toBe(false)
    expect(shouldAsk(mergeSettings({ never: ['mastodon.social'] }), 'mastodon', 'other.social')).toBe(true)
  })
})

describe('instanceHost (review wave 40)', () => {
  it('a plain host name only; not a built-in site, not one added already', async () => {
    const { instanceHost } = await import('../../src/settings')
    expect(instanceHost(' Mastodon.Social ', [])).toBe('mastodon.social')
    for (const bad of ['..a.com', '-.com', 'a..b.com', 'a.-b.com', 'https://x.org', 'x', 'a_b.com']) expect(instanceHost(bad, [])).toBeNull()
    expect(instanceHost('www.linkedin.com', [])).toBeNull()
    expect(instanceHost('x.com', [])).toBeNull()
    expect(instanceHost('mastodon.social', ['mastodon.social'])).toBeNull()
  })
})
