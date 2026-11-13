// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { EXCERPT_MAX, parseFrontmatter, parseNote } from '../../src/ext/obsidian/obsidian_parse.ts'
import { NOTES } from '../fixtures/synthetic_vault.mjs'

// Algorithmic bound instead of a wall clock: T(4n)/T(n) stays below SCALE_RATIO_MAX (linear-ish; quadratic would give ~16),
// plus a generous absolute ceiling as a freeze guard. Best of 3 per size damps scheduler noise; a 5 ms floor damps timer jitter.
const SCALE_RATIO_MAX = 10   // linear ~4, observed up to ~7 in a loaded full run; quadratic ~16
const FREEZE_MS = 10_000
const best = (fn, n) => { let m = Infinity; for (let i = 0; i < 3; i++) { const t0 = performance.now(); fn(n); m = Math.min(m, performance.now() - t0) } return m }
const scaling = (fn, n) => ({ small: Math.max(best(fn, n), 5), big: best(fn, 4 * n) })

describe('parseFrontmatter', () => {
  it('reads scalars, quoted values, inline lists and block lists', () => {
    const { data, body } = parseFrontmatter(NOTES['People/Bruno Cesar.md'])
    expect(data.name).toBe('Bruno Cesar')
    expect(data.emails).toEqual(['bruno@example.org', 'b.cesar@example.net'])
    expect(data.tags).toEqual(['person', 'garden'])
    expect(body.startsWith('Neighbour')).toBe(true)
    const a = parseFrontmatter(NOTES['People/Alma Brandt.md']).data
    expect(a.name).toBe('Alma Brandt')
    expect(a.phone).toBe('+43 660 000 0001')
    expect(a.aliases).toEqual(['Almi', 'A. Brandt'])
  })
  it('keeps a text without frontmatter whole, and ignores a block that is not closed', () => {
    expect(parseFrontmatter('Just text\n')).toEqual({ data: {}, body: 'Just text\n' })
    expect(parseFrontmatter('---\nname: X\nno end here').data).toEqual({})
  })
  it('accepts CRLF and a BOM; keys are lower-cased', () => {
    const { data, body } = parseFrontmatter('﻿---\r\nName: Zed\r\nTags: [a, b]\r\n---\r\nBody')
    expect(data).toEqual({ name: 'Zed', tags: ['a', 'b'] })
    expect(body).toBe('Body')
  })
  it('never throws on junk', () => {
    for (const t of ['', '---', '---\n---', '---\n: : :\n---\nx', '---\n- a\n- b\n---\nx']) expect(() => parseFrontmatter(t)).not.toThrow()
  })
})

describe('parseNote', () => {
  it('title from the file name, folders from the path, name from frontmatter', () => {
    const n = parseNote('People/Family/Dmitri Evers.md', NOTES['People/Family/Dmitri Evers.md'])
    expect(n.title).toBe('Dmitri Evers')
    expect(n.name).toBe('Dmitri Evers')
    expect(n.folders).toEqual(['People', 'Family'])
    expect(n.tags).toEqual(['person'])
    expect(parseNote('People/Alma Brandt.md', NOTES['People/Alma Brandt.md']).name).toBe('Alma Brandt')
  })
  it('frontmatter e-mails, phone and aliases; comma string tags', () => {
    const n = parseNote('People/Alma Brandt.md', NOTES['People/Alma Brandt.md'])
    expect(n.emails).toEqual(['alma.brandt@example.org'])
    expect(n.phones).toEqual(['+43 660 000 0001'])
    expect(n.aliases).toEqual(['Almi', 'A. Brandt'])
    expect(n.tags).toEqual(['person', 'family'])
    expect(parseNote('x.md', '---\ntags: a, b\n---\n').tags).toEqual(['a', 'b'])
    expect(parseNote('x.md', '---\ntags: "#a #b"\n---\n').tags).toEqual(['a', 'b'])
  })
  it('inline #tags: nested kept, numbers/urls/headings/code skipped, once each', () => {
    const n = parseNote('x.md', '# Title\nSee http://x.org/#frag and #garden/soil #garden/soil #2026 and #todo.\n```\n#in-code\n```\n`#inline-code`\n')
    expect(n.tags).toEqual(['garden/soil', 'todo'])
  })
  it('wikilinks: alias, heading and folder stripped; embeds and non-notes skipped; once each', () => {
    const n = parseNote('x.md', 'A [[Chiara Dolan|Chiara]] [[Alma Brandt#Music]] [[People/Bruno Cesar]] ![[photo.png]] [[report.pdf]] [[Chiara Dolan]] [[Note.md]]')
    expect(n.links).toEqual(['Chiara Dolan', 'Alma Brandt', 'Bruno Cesar', 'Note'])
  })
  it('body e-mail addresses count as e-mails; invalid ones do not', () => {
    expect(parseNote('x.md', 'write to Ben <ben@example.org> or not-an-email@').emails).toEqual(['ben@example.org'])
  })
  it('excerpt: body without frontmatter, whitespace collapsed, capped', () => {
    expect(parseNote('People/Alma Brandt.md', NOTES['People/Alma Brandt.md']).excerpt).toBe('# Alma Cousin, lives in Graz. Plays cello. Birthday in May.')
    const long = parseNote('x.md', 'word '.repeat(500)).excerpt
    expect(long.length).toBeLessThanOrEqual(EXCERPT_MAX)
    expect(long.endsWith('…')).toBe(true)
  })
  it('same input, same output (pure) and no raw body kept', () => {
    const a = parseNote('x.md', 'Hello [[B]]')
    expect(parseNote('x.md', 'Hello [[B]]')).toEqual(a)
    expect(JSON.stringify(a).length).toBeLessThan(1500)
  })
  it('a pathological note (1 MB of one word, of [[, of base64) scales linearly and never freezes', () => {
    for (const make of [n => 'a'.repeat(n), n => '[['.repeat(n / 2), n => 'QUJD'.repeat(n / 4) + '\n' + '#'.repeat(n / 10), n => '`'.repeat(n / 2), n => '---\n'.repeat(n / 5)]) {
      const { small, big } = scaling(n => parseNote('x.md', make(n)), 250_000)
      expect(big / small).toBeLessThan(SCALE_RATIO_MAX)
      expect(big).toBeLessThan(FREEZE_MS)
    }
  })
})

describe('B2 a line of spaces inside the frontmatter cannot freeze the reader', () => {
  it('900,000 spaces after a key, inside the fences, scales linearly and never freezes', () => {
    for (const line of [n => 'a' + ' '.repeat(n), n => 'a' + ' '.repeat(n) + ':', n => ' '.repeat(n) + 'a: b', n => 'a: ' + 'b '.repeat(n / 2)]) {
      const { small, big } = scaling(n => {
        const { data } = parseFrontmatter(`---\n${line(n)}\nname: Z\n---\nbody`)
        expect(data.name).toBe('Z')
      }, 225_000)
      expect(big / small).toBeLessThan(SCALE_RATIO_MAX)
      expect(big).toBeLessThan(FREEZE_MS)
    }
  })
  it('a normal key with spaces still reads; an over-long key or line is skipped', () => {
    expect(parseFrontmatter('---\nfirst name : Zed\n---\n').data['first name']).toBe('Zed')
    expect(parseFrontmatter(`---\n${'k'.repeat(70)}: v\nok: 1\n---\n`).data).toEqual({ ok: '1' })
    expect(parseFrontmatter(`---\nbig: ${'v'.repeat(2500)}\nok: 1\n---\n`).data).toEqual({ ok: '1' })
  })
  it('a value with colons keeps everything after the first colon', () => {
    expect(parseFrontmatter('---\nurl: https://example.org/a\n---\n').data.url).toBe('https://example.org/a')
  })
})

describe('B12 empty frontmatter is no body text', () => {
  it('--- fences with nothing between (LF and CRLF)', () => {
    expect(parseFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body' })
    expect(parseFrontmatter('---\r\n---\r\nbody')).toEqual({ data: {}, body: 'body' })
    expect(parseNote('x.md', '---\n---\nbody').excerpt).toBe('body')
  })
})

describe('B13 e-mails from the body only when they are unambiguous', () => {
  it('frontmatter e-mail wins; body addresses are not added', () => {
    expect(parseNote('P/x.md', '---\nemail: a@example.org\n---\ncc b@example.org').emails).toEqual(['a@example.org'])
  })
  it('no frontmatter e-mail and exactly one address in the body: used', () => {
    expect(parseNote('P/x.md', 'Write to a@example.org or a@example.org').emails).toEqual(['a@example.org'])
  })
  it('two different addresses in the body: none', () => {
    expect(parseNote('P/x.md', 'a@example.org, cc b@example.org').emails).toEqual([])
  })
})

describe('B14 wikilinks', () => {
  it('a table-escaped alias keeps the name without the backslash', () => {
    expect(parseNote('x.md', '| [[Alma Brandt\\|Alma]] |').links).toEqual(['Alma Brandt'])
  })
  it('names with a dot are kept; real attachments are skipped', () => {
    expect(parseNote('x.md', '[[Mary.Jones]] [[J.Smith]] [[Folder/Dr. Who]] [[pic.png]] [[doc.PDF]] [[note.md]] [[sheet.xlsx]]').links).toEqual(['Mary.Jones', 'J.Smith', 'Dr. Who', 'note'])
  })
})
