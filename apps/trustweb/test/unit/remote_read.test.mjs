// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Review-44: one copy of the remote read helpers (remote_read.ts), shared by fediverse.ts and feed_embed.ts. */
import { readFileSync } from 'node:fs'
import * as leaf from '../../src/remote_read.ts'
import * as fedi from '../../src/fediverse.ts'

describe('remote_read: the shared leaf', () => {
  it('fediverse.ts re-exports the leaf (same functions, no copies)', () => {
    expect(fedi.htmlToText).toBe(leaf.htmlToText)
    expect(fedi.safeRemoteUrl).toBe(leaf.safeRemoteUrl)
  })
  it('feed_embed.ts holds no copies and imports nothing but types and the leaf (apps/mcp loads it under plain node)', () => {
    const src = readFileSync(new URL('../../src/feed_embed.ts', import.meta.url), 'utf8')
    for (const name of ['function htmlToText', 'function safeRemoteUrl', 'HOST_RE', 'RESERVED']) expect(src).not.toContain(name)
    const valueImports = src.split('\n').filter((l) => /^import (?!type)/.test(l))
    expect(valueImports).toEqual([expect.stringContaining("from './remote_read.ts'")])
    expect(readFileSync(new URL('../../src/remote_read.ts', import.meta.url), 'utf8')).not.toMatch(/^import /m)
  })
  it('safeRemoteUrl: public https only; local http only when allowed; no SVG picture', () => {
    expect(leaf.safeRemoteUrl('https://example.social/x')).toBe('https://example.social/x')
    expect(leaf.safeRemoteUrl('https://router.lan/x')).toBeUndefined()
    expect(leaf.safeRemoteUrl('https://10.0.0.1/x')).toBeUndefined()
    expect(leaf.safeRemoteUrl('https://u:p@example.social/x')).toBeUndefined()
    expect(leaf.safeRemoteUrl('http://127.0.0.1:5000/x')).toBeUndefined()
    expect(leaf.safeRemoteUrl('http://127.0.0.1:5000/x', true)).toBe('http://127.0.0.1:5000/x')
    expect(leaf.safeRemoteUrl('https://example.social/a.svg', false, true)).toBeUndefined()
  })
  it('htmlToText: text only, scripts gone, an out-of-range entity kept as written', () => {
    expect(leaf.htmlToText('<p>a</p><p>b<script>x()</script></p>')).toBe('a\n\nb')
    expect(leaf.htmlToText('&#99999999; &amp;')).toBe('&#99999999; &')
  })
})
