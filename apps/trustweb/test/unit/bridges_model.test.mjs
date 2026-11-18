// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c feed-ext (ι): Bridgy Fed and Threads handle construction, the Meta portability switch. Pure, no network. */
import { BRIDGY_DOCS_URL, META_PORTABILITY_ENABLED, bridgedOnBluesky, bridgyFromBluesky, bridgyFromWebsite, bskyHandle, threadsHandle, websiteDomain, websiteOnBluesky } from '../../src/ext/bridges/bridges_model.ts'

describe('bskyHandle', () => {
  it.each([
    ['alice.bsky.social', 'alice.bsky.social'],
    ['@Alice.BSKY.social', 'alice.bsky.social'],
    ['  @jay.example.org ', 'jay.example.org'],
    ['https://bsky.app/profile/alice.bsky.social', 'alice.bsky.social'],
    ['did:plc:abc234xyz', 'did:plc:abc234xyz'],
  ])('%j -> %j', (input, want) => { expect(bskyHandle(input)).toBe(want) })
  it.each(['', 'alice', '@alice@mastodon.social', 'a..b.social', 'https://example.org/x', 'alice.localhost', 'x y.social', 'did:web:'])('refuses %j', (s) => { expect(bskyHandle(s)).toBeNull() })
})

describe('Bridgy Fed handles', () => {
  it('a Bluesky person appears on the fediverse as @<handle>@bsky.brid.gy', () => {
    expect(bridgyFromBluesky('@alice.bsky.social')).toBe('@alice.bsky.social@bsky.brid.gy')
    expect(bridgyFromBluesky('did:plc:abc234xyz')).toBeNull()   // a did has no bridged handle
    expect(bridgyFromBluesky('nope')).toBeNull()
  })
  it('a web site appears as @<domain>@web.brid.gy (scheme, www, path dropped)', () => {
    expect(websiteDomain('https://www.Example.org/blog/')).toBe('example.org')
    expect(websiteDomain('example.org')).toBe('example.org')
    expect(bridgyFromWebsite('https://example.org/about')).toBe('@example.org@web.brid.gy')
    for (const bad of ['http://127.0.0.1:8080', 'https://localhost', 'not a site', '', 'ftp://example.org']) expect(bridgyFromWebsite(bad)).toBeNull()
  })
  it('the same accounts as Bluesky reads them (public AppView): <domain>.web.brid.gy, <user>.<host>.ap.brid.gy', () => {
    expect(websiteOnBluesky('example.org')).toBe('example.org.web.brid.gy')
    expect(bridgedOnBluesky('@zuck@threads.net')).toBe('zuck.threads.net.ap.brid.gy')
    expect(bridgedOnBluesky('@a_b.c@mastodon.social')).toBe('a-b.c.mastodon.social.ap.brid.gy')
    expect(bridgedOnBluesky('nope')).toBeNull()
  })
  it('the docs link is the official one', () => { expect(BRIDGY_DOCS_URL).toBe('https://fed.brid.gy/docs') })
})

describe('threadsHandle', () => {
  it.each([
    ['zuck', '@zuck@threads.net'],
    ['@Zuck', '@zuck@threads.net'],
    ['@zuck@threads.net', '@zuck@threads.net'],
    ['zuck@threads.com', '@zuck@threads.net'],
    ['https://www.threads.net/@zu.ck_1', '@zu.ck_1@threads.net'],
    ['https://www.threads.com/@zuck/', '@zuck@threads.net'],
  ])('%j -> %j', (input, want) => { expect(threadsHandle(input)).toBe(want) })
  it.each(['', '@zuck@mastodon.social', 'a b', 'https://example.org/@zuck', 'x'.repeat(31)])('refuses %j', (s) => { expect(threadsHandle(s)).toBeNull() })
})

describe('Meta portability', () => {
  it('stays off until Meta approves the application (a true external)', () => { expect(META_PORTABILITY_ENABLED).toBe(false) })
})
