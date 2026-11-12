// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 review fixes: the sparkle knows whether the assistant really runs, mail links stay short, legacy community links move once, a link names a variation the receiver knows. */
import { createRegistry, createBus } from '../../src/ext/tw_registry.ts'
import { emailLinks, MAILTO_MAX } from '../../src/support_delivery.ts'
import { legacyLinksPatch, parseCommunity } from '../../src/ext/community-mighty/community_data.ts'
import { linkableProfile, profileOfLink, withProfile } from '../../src/profile_link.ts'

describe('registry: isActive says whether a module was initialised (the sparkle falls back when the assistant could not load)', () => {
  const ctx = () => ({ store: () => ({}), strings: {}, bus: createBus(), navigate: () => {}, profile: () => 'full' })
  const make = () => { let tw; return createRegistry({ settings: () => tw, save: (t) => { tw = t }, ctx }) }
  it('false before start, true after init, false after switching off', async () => {
    const reg = make()
    reg.registerModule({ id: 'a', title: 'a', kind: 'service', enabledByDefault: true, heavy: true, load: async () => ({ init: () => {} }) })
    expect(reg.isActive('a')).toBe(false)
    await reg.start()
    expect(reg.isActive('a')).toBe(true)
    await reg.setEnabled('a', false)
    expect(reg.isActive('a')).toBe(false)
  })
  it('stays false when the chunk fails to load (switch on, nothing running)', async () => {
    const reg = make()
    const err = console.error
    console.error = () => {}
    try {
      reg.registerModule({ id: 'b', title: 'b', kind: 'service', enabledByDefault: true, heavy: true, load: async () => { throw new Error('Failed to fetch dynamically imported module') } })
      await reg.start()
    } finally { console.error = err }
    expect(reg.isEnabled('b')).toBe(true)
    expect(reg.isActive('b')).toBe(false)
  })
  it('unknown module: false', () => expect(make().isActive('nope')).toBe(false))
})

describe('support delivery: e-mail links stay under the mailto length mail programs accept', () => {
  const addrs = (n) => Array.from({ length: n }, (_, i) => `person${String(i).padStart(3, '0')}@example.org`)
  it('a few addresses: one link, every address in BCC', () => {
    const links = emailLinks(addrs(3), 'Subject', 'Body')
    expect(links).toHaveLength(1)
    expect(decodeURIComponent(links[0])).toContain('person000@example.org,person001@example.org,person002@example.org')
  })
  it('many addresses: several links, each at most MAILTO_MAX long, every address exactly once', () => {
    const all = addrs(200)
    const links = emailLinks(all, 'I could use some support', 'Hi, I could use some support. This is open until Fri 18:00. You can answer me in TrustWeb: https://app.trustweb.one/')
    expect(links.length).toBeGreaterThan(1)
    for (const l of links) expect(l.length).toBeLessThanOrEqual(MAILTO_MAX)
    const got = links.flatMap((l) => decodeURIComponent(new URL(l).searchParams.get('bcc') ?? '').split(','))
    expect(got.sort()).toEqual([...all].sort())
  })
  it('every link carries the subject and the body', () => {
    for (const l of emailLinks(addrs(150), 'S', 'B')) { const u = new URL(l); expect(u.searchParams.get('subject')).toBe('S'); expect(u.searchParams.get('body')).toBe('B') }
  })
  it('no addresses: no link', () => expect(emailLinks([], 'S', 'B')).toEqual([]))
})

describe('community: wave 39 Docs/Telegram links move into the embeds record once', () => {
  const legacy = { docsUrl: 'https://docs.google.com/document/d/e/abc/pub', telegramUrl: 'https://t.me/iyg' }
  it('first mount: the missing links are adopted and the slice is marked moved (the old fields stay, nothing deleted)', () => {
    const r = legacyLinksPatch(legacy, {})
    expect(r.patch).toEqual({ docsUrl: legacy.docsUrl, telegramUrl: legacy.telegramUrl })
    expect(r.next.linksMoved).toBe(true)
    expect(r.next.docsUrl).toBe(legacy.docsUrl)
  })
  it('a link the embeds record already has is not overwritten', () => {
    const r = legacyLinksPatch(legacy, { docsUrl: 'https://docs.google.com/document/d/e/new/pub?embedded=true' })
    expect(r.patch).toEqual({ telegramUrl: legacy.telegramUrl })
  })
  it('after the move a link cleared in embeds is NOT brought back on the next mount', () => {
    const moved = legacyLinksPatch(legacy, {}).next
    expect(legacyLinksPatch(moved, {})).toEqual({ patch: null, next: null })
  })
  it('nothing to move: nothing to do', () => expect(legacyLinksPatch({}, {})).toEqual({ patch: null, next: null }))
  it('the moved mark survives the slice parse (device sync)', () => expect(parseCommunity({ ...legacy, linksMoved: true }).linksMoved).toBe(true))
})

describe('connection link with a variation: only ids the receiver knows', () => {
  const tw = { custom: [{ id: 'custom-calm', name: 'Calm', base: 'reader', modules: {} }] }
  it('a built-in variation stays itself', () => expect(linkableProfile('iyg-support', tw)).toBe('iyg-support'))
  it('a variation made with the assistant travels as its base', () => expect(linkableProfile('custom-calm', tw)).toBe('reader'))
  it('an unknown custom id falls back to Full', () => expect(linkableProfile('custom-gone', tw)).toBe('full'))
  it('the receiver reads it back', () => expect(profileOfLink(new URL(withProfile('https://app.trustweb.one/#c=1', linkableProfile('custom-calm', tw))).hash)).toBe('reader'))
})
