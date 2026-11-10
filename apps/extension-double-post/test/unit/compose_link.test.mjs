// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { buildComposeLink, normalizeBaseUrl, MAX_TEXT, DEFAULT_BASE_URL } from '../../src/compose_link'

describe('normalizeBaseUrl', () => {
  it('defaults to app.trustweb.one', () => {
    expect(DEFAULT_BASE_URL).toBe('https://app.trustweb.one')
    expect(normalizeBaseUrl('')).toBe('https://app.trustweb.one')
  })
  it('accepts https origins and strips path, query, hash', () => {
    expect(normalizeBaseUrl('https://example.org/x?y#z')).toBe('https://example.org')
  })
  it('adds https when no scheme is typed', () => {
    expect(normalizeBaseUrl('app.trustweb.one')).toBe('https://app.trustweb.one')
  })
  it('allows http only for loopback (with port)', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:5270')).toBe('http://127.0.0.1:5270')
    expect(normalizeBaseUrl('http://localhost:5270/')).toBe('http://localhost:5270')
    expect(normalizeBaseUrl('http://evil.example')).toBeNull()
  })
  it('rejects other schemes and junk', () => {
    expect(normalizeBaseUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeBaseUrl('ftp://x.org')).toBeNull()
    expect(normalizeBaseUrl('https://user:pw@x.org')).toBeNull()
    expect(normalizeBaseUrl('not a url')).toBeNull()
  })
})

describe('buildComposeLink', () => {
  it('builds base/#compose=<urlencoded>&from=<site>', () => {
    expect(buildComposeLink('https://app.trustweb.one', 'Hallo Welt & mehr #tag', 'mastodon'))
      .toBe('https://app.trustweb.one/#compose=Hallo%20Welt%20%26%20mehr%20%23tag&from=mastodon')
  })
  it('clips text to MAX_TEXT characters', () => {
    const link = buildComposeLink('https://a.b', 'x'.repeat(MAX_TEXT + 50), 'x')
    const text = decodeURIComponent(link.split('#compose=')[1].split('&from=')[0])
    expect(text.length).toBe(MAX_TEXT)
  })
  it('does not split a surrogate pair when clipping', () => {
    const link = buildComposeLink('https://a.b', 'a'.repeat(MAX_TEXT - 1) + '😀😀', 'x')
    expect(() => decodeURIComponent(link)).not.toThrow()
  })
  it('returns null for empty or whitespace-only text', () => {
    expect(buildComposeLink('https://a.b', '   \n', 'x')).toBeNull()
  })
})
