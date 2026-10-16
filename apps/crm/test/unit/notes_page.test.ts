// @ts-nocheck  (the page module is plain JS; shapes checked by its d.mts in src use)
import { describe, expect, it } from 'vitest'
import { blockChanges, diffPage, parseBlocks, parsePage, renderPage, slug, updatePage, upsertBlock } from '../../scripts/notes_page.mjs'

const NOW = Date.UTC(2026, 9, 16, 9, 30)
const line = (id, text, extra = {}) => ({ id, text, tag: 'note', audience: 'me', status: 'current', notedAt: Date.UTC(2026, 6, 11, 12), checkedAt: 1, ...extra })
const mira = () => ({
  id: 'tana-abc', name: 'Mira Hollenstein', context: 'Met at the bonfire', ring: 'friend', metAt: 1,
  lines: [line('tana-abc-0', 'Plays chess'), line('local-1-2-0', 'Runs a repair café in Graz', { source: { kind: 'local', path: 'journals/2026_07_11.md' } }), line('tana-abc-9', 'Old', { status: 'gone' })],
  fields: {},
})

describe('person page', () => {
  it('renders front matter, the marked block with dated bullets and hidden ids, a Tana link for Tana people; gone lines left out', () => {
    const t = renderPage(mira(), { now: NOW })
    expect(t).toBe(`---
trustweb: tana-abc
name: Mira Hollenstein
ring: friend
tana: https://app.tana.inc?nodeid=abc
updated: 2026-10-16T09:30:00.000Z
---
# Mira Hollenstein
<!-- trustweb:begin -->
- context: Met at the bonfire
- 2026-07-11 Plays chess <!-- tw:tana-abc-0 -->
- 2026-07-11 Runs a repair café in Graz <!-- tw:local-1-2-0 -->
<!-- trustweb:end -->
`)
    expect(slug(mira())).toMatch(/^Mira Hollenstein \([0-9a-f]{6}\)\.md$/)
    expect(slug({ id: 'x', name: 'A/B: "c"?' })).toMatch(/^AB c \(/)
  })
  it('parses back what it rendered; a name with a colon survives the front matter', () => {
    const p = { ...mira(), name: 'Dr. Mira: Hollenstein' }
    const page = parsePage(renderPage(p, { now: NOW }))
    expect(page.id).toBe('tana-abc')
    expect(page.name).toBe('Dr. Mira: Hollenstein')
    expect(page.ring).toBe('friend')
    expect(page.updated).toBe(NOW)
    expect(page.context).toBe('Met at the bonfire')
    expect(page.lines).toEqual([{ id: 'tana-abc-0', text: 'Plays chess', date: '2026-07-11' }, { id: 'local-1-2-0', text: 'Runs a repair café in Graz', date: '2026-07-11' }])
    expect(page.userLines).toEqual([])
    expect(parsePage('# not ours\n')).toBeNull()
    expect(parsePage('---\ntitle: x\n---\n')).toBeNull()
  })
  it('keeps the text the person wrote after the end marker, reads their bullets as new lines, and is stable when nothing changed', () => {
    const first = renderPage(mira(), { now: NOW })
    const edited = `${first}\nMy own paragraph.\n- 2026-10-01 Lent me the printer\n- Plays chess\n- Likes tea\n`
    const page = parsePage(edited)
    expect(page.userLines).toEqual([{ text: 'Lent me the printer', date: '2026-10-01' }, { text: 'Plays chess', date: '' }, { text: 'Likes tea', date: '' }])
    expect(diffPage(page, mira())).toEqual({ ring: null, newLines: [{ text: 'Lent me the printer', date: '2026-10-01' }, { text: 'Likes tea', date: '' }] })
    expect(updatePage(edited, mira(), { now: NOW + 1000 })).toBe(edited)   // nothing changed in the record: file untouched (the stamp too)
    const p2 = mira(); p2.lines.push(line('tana-abc-1', 'Moved to Leoben'))
    const next = updatePage(edited, p2, { now: NOW + 1000 })
    expect(next).toContain('- 2026-07-11 Moved to Leoben <!-- tw:tana-abc-1 -->')
    expect(next.endsWith('\nMy own paragraph.\n- 2026-10-01 Lent me the printer\n- Plays chess\n- Likes tea\n')).toBe(true)
    expect(next).toContain('updated: 2026-10-16T09:30:01.000Z')
  })
  it('a ring changed in the file shows up in the diff', () => {
    const page = parsePage(renderPage(mira(), { now: NOW }).replace('ring: friend', 'ring: close'))
    expect(diffPage(page, mira()).ring).toBe('close')
    expect(parsePage(renderPage(mira(), { now: NOW }).replace('ring: friend', 'ring: bogus')).ring).toBe('')
  })
})

describe('block in the home note', () => {
  const note = '# 2026-07-11\n- Met Mira at the bonfire.\n- TODO milk\n'
  it('appends a marked block, replaces it in place next time, leaves the note alone when nothing changed', () => {
    const a = upsertBlock(note, mira(), { now: NOW })
    expect(a).toBe(`${note}
<!-- trustweb:begin tana-abc -->
- TrustWeb: Mira Hollenstein · ring: friend · https://app.tana.inc?nodeid=abc · updated: 2026-10-16T09:30:00.000Z
- 2026-07-11 Plays chess <!-- tw:tana-abc-0 -->
- 2026-07-11 Runs a repair café in Graz <!-- tw:local-1-2-0 -->
<!-- trustweb:end tana-abc -->
`)
    expect(upsertBlock(a, mira(), { now: NOW + 5000 })).toBe(a)
    const p2 = { ...mira(), ring: 'close' }
    const b = upsertBlock(`${a}\n- later note\n`, p2, { now: NOW + 5000 })
    expect(b).toContain('ring: close · https://app.tana.inc?nodeid=abc · updated: 2026-10-16T09:30:05.000Z')
    expect(b.endsWith('<!-- trustweb:end tana-abc -->\n\n- later note\n')).toBe(true)
    expect(b.match(/trustweb:begin/g)).toHaveLength(1)
  })
  it('bullets added inside the block are read as new lines and kept until TrustWeb has them; the ring follows newer-wins', () => {
    const a = upsertBlock(note, mira(), { now: NOW })
    const edited = a.replace('ring: friend', 'ring: acquaintance').replace('<!-- trustweb:end tana-abc -->', '- 2026-10-02 Lent me the printer\n- Plays chess\n<!-- trustweb:end tana-abc -->')
    const [b] = parseBlocks(edited)
    expect(b).toMatchObject({ id: 'tana-abc', name: 'Mira Hollenstein', ring: 'acquaintance', updated: NOW })
    expect(b.userLines).toEqual([{ text: 'Lent me the printer', date: '2026-10-02' }, { text: 'Plays chess', date: '' }])
    expect(blockChanges(b, mira(), NOW + 60_000)).toEqual({ ring: 'acquaintance', newLines: [{ text: 'Lent me the printer', date: '2026-10-02' }] })
    expect(blockChanges(b, mira(), NOW)).toEqual({ ring: null, newLines: [{ text: 'Lent me the printer', date: '2026-10-02' }] })   // file not saved after the block: TrustWeb's ring stands
    const rewritten = upsertBlock(edited, mira(), { now: NOW + 5000 })
    expect(rewritten).toContain('- 2026-10-02 Lent me the printer\n<!-- trustweb:end tana-abc -->')
    expect(rewritten).not.toContain('- Plays chess\n<!--')
    const p3 = mira(); p3.lines.push(line('tana-abc-2', 'Lent me the printer'))
    expect(upsertBlock(rewritten, p3, { now: NOW + 9000 })).toContain('- 2026-07-11 Lent me the printer <!-- tw:tana-abc-2 -->\n<!-- trustweb:end tana-abc -->')
  })
})
