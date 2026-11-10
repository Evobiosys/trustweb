// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 small-ui-c: the embeds module's pure rules: which links may be framed, the per-tag record, its device merge. */
import { docsEmbedUrl, telegramUrl, parseEmbeds, mergeEmbeds, entryFor, withEntry, NO_TAG, MODULE_ID } from '../../src/ext/embeds/embeds_model.ts'

describe('embed URL validation: only Google Docs and Telegram', () => {
  it('Docs: a published link keeps /pub and gets embedded=true', () => {
    expect(docsEmbedUrl('https://docs.google.com/document/d/e/2PACX-1/pub')).toBe('https://docs.google.com/document/d/e/2PACX-1/pub?embedded=true')
    expect(docsEmbedUrl('https://docs.google.com/document/d/e/2PACX-1/pub?embedded=true')).toBe('https://docs.google.com/document/d/e/2PACX-1/pub?embedded=true')
    expect(docsEmbedUrl('https://docs.google.com/spreadsheets/d/e/2PACX-2/pub?output=html')).toBe('https://docs.google.com/spreadsheets/d/e/2PACX-2/pub?embedded=true')
  })
  it('Docs: an /edit link becomes the /preview page of the same document (query and hash dropped)', () => {
    expect(docsEmbedUrl('https://docs.google.com/document/d/abc123/edit?usp=sharing#heading=h.x')).toBe('https://docs.google.com/document/d/abc123/preview')
    expect(docsEmbedUrl('https://docs.google.com/presentation/d/abc123/edit')).toBe('https://docs.google.com/presentation/d/abc123/preview')
  })
  it('Docs: the normalised link is accepted again unchanged (the record is parsed on every read)', () => {
    for (const raw of ['https://docs.google.com/document/d/e/2PACX-1/pub', 'https://docs.google.com/document/d/abc123/edit', 'https://docs.google.com/presentation/d/abc123/edit']) {
      const once = docsEmbedUrl(raw)
      expect(docsEmbedUrl(once), raw).toBe(once)
    }
  })
  it('Docs: any other host, scheme or page is refused', () => {
    for (const bad of ['', 'not a link', 'http://docs.google.com/document/d/e/x/pub', 'https://evil.org/docs.google.com/pub', 'https://docs.google.com.evil.org/document/d/a/edit',
      'https://drive.google.com/file/d/a/edit', 'https://docs.google.com/document/d/abc/comment', 'https://user@docs.google.com/document/d/abc/edit', 'javascript:alert(1)']) expect(docsEmbedUrl(bad), bad).toBeNull()
  })
  it('Telegram: https on t.me, telegram.me, telegram.org or web.telegram.org; a bare t.me/x gets https', () => {
    expect(telegramUrl('https://t.me/somegroup')).toBe('https://t.me/somegroup')
    expect(telegramUrl('t.me/somegroup')).toBe('https://t.me/somegroup')
    expect(telegramUrl('https://telegram.org/dl')).toBe('https://telegram.org/dl')
    expect(telegramUrl('https://web.telegram.org/k/#@somegroup')).toBe('https://web.telegram.org/k/#@somegroup')
  })
  it('Telegram: look-alikes, http and script links are refused', () => {
    for (const bad of ['', 'http://t.me/x', 'https://t.me.evil.org/x', 'https://evil.org/t.me/x', 'https://nott.me/x', 'javascript:alert(1)', 'https://user@t.me/x']) expect(telegramUrl(bad), bad).toBeNull()
  })
})

describe('the per-community-tag record', () => {
  it('parse keeps only valid, normalised links per tag and drops everything else', () => {
    const d = parseEmbeds({ byTag: { iyg: { docsUrl: 'https://docs.google.com/document/d/abc/edit', telegramUrl: 't.me/iyg', junk: 1 }, bad: { docsUrl: 'https://evil.org/x', telegramUrl: 'https://evil.org' }, __proto__: { docsUrl: 'x' } }, other: 1 })
    expect(d).toEqual({ byTag: { iyg: { docsUrl: 'https://docs.google.com/document/d/abc/preview', telegramUrl: 'https://t.me/iyg' } } })
    expect(parseEmbeds(null)).toEqual({})
    expect(parseEmbeds('x')).toEqual({})
  })
  it('entryFor reads one tag (NO_TAG when no community tag exists), withEntry sets or clears one link', () => {
    const a = withEntry({}, 'iyg', { docsUrl: 'https://docs.google.com/document/d/e/1/pub' })
    expect(entryFor(a, 'iyg')).toEqual({ docsUrl: 'https://docs.google.com/document/d/e/1/pub?embedded=true' })
    expect(entryFor(a, 'other')).toEqual({})
    const b = withEntry(a, 'iyg', { telegramUrl: 't.me/iyg' })
    expect(entryFor(b, 'iyg')).toEqual({ docsUrl: 'https://docs.google.com/document/d/e/1/pub?embedded=true', telegramUrl: 'https://t.me/iyg' })
    const c = withEntry(b, 'iyg', { docsUrl: null })
    expect(entryFor(c, 'iyg')).toEqual({ telegramUrl: 'https://t.me/iyg' })
    expect(withEntry(c, 'iyg', { telegramUrl: null })).toEqual({})
    expect(entryFor(withEntry({}, NO_TAG, { telegramUrl: 't.me/x' }), NO_TAG).telegramUrl).toBe('https://t.me/x')
    expect(withEntry({}, 'iyg', { docsUrl: 'https://evil.org' })).toEqual({})
  })
  it('two of my devices: tags join, per tag the incoming link wins where it has one', () => {
    const mine = { byTag: { a: { docsUrl: 'https://docs.google.com/document/d/e/1/pub?embedded=true', telegramUrl: 'https://t.me/a' } } }
    const theirs = { byTag: { a: { telegramUrl: 'https://t.me/a2' }, b: { telegramUrl: 'https://t.me/b' } } }
    expect(mergeEmbeds(mine, theirs)).toEqual({ byTag: { a: { docsUrl: 'https://docs.google.com/document/d/e/1/pub?embedded=true', telegramUrl: 'https://t.me/a2' }, b: { telegramUrl: 'https://t.me/b' } } })
    expect(mergeEmbeds(undefined, theirs)).toEqual(parseEmbeds(theirs))
  })
  it('module id', () => expect(MODULE_ID).toBe('embeds'))
})

describe('the embeds module stub', () => {
  it('is a heavy view module, off by default, never loaded while off; its slice merges even while off', async () => {
    const { module } = await import('../../src/ext/embeds/index.ts')
    const { createRegistry, createBus } = await import('../../src/ext/tw_registry.ts')
    const { EXT_DATA_MERGERS } = await import('../../src/ext/ext_data.ts')
    expect(module).toMatchObject({ id: 'embeds', kind: 'view', heavy: true, enabledByDefault: false })
    expect(EXT_DATA_MERGERS.get('embeds')).toBe(mergeEmbeds)
    let tw
    const load = vi.fn(async () => ({ views: [{ id: 'docs-chat', title: 'Docs & chat', icon: 'inventory', mount: () => () => {} }] }))
    const reg = createRegistry({ settings: () => tw, save: (n) => { tw = n }, ctx: () => ({ bus: createBus() }) })
    reg.registerModule({ ...module, load })
    await reg.start()
    expect(load).not.toHaveBeenCalled()
    await reg.setEnabled('embeds', true)
    expect(reg.views().map((v) => v.id)).toEqual(['docs-chat'])
  })
})
