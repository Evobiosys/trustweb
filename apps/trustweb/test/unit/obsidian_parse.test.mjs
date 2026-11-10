// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { EXCERPT_MAX, parseFrontmatter, parseNote } from '../../src/ext/obsidian/obsidian_parse.ts'
import { NOTES } from '../fixtures/synthetic_vault.mjs'

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
  it('a pathological note (1 MB of one word, of [[, of base64) is read in well under a second', () => {
    for (const body of ['a'.repeat(1_000_000), '[['.repeat(500_000), 'QUJD'.repeat(250_000) + '\n' + '#'.repeat(100_000), '`'.repeat(500_000), '---\n'.repeat(200_000)]) {
      const t0 = performance.now()
      parseNote('x.md', body)
      expect(performance.now() - t0).toBeLessThan(1000)
    }
  })
})
