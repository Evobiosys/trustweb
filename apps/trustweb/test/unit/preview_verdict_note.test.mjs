// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * wave44 answers-44b item 5: a note per row verdict. The phone sheet's needs-work sends it, the dev server passes it to `preview <id> verdict
 * <key> <verdict> --note`, the Mac panel shows it, MCP preview_verdict takes it. Fake rows only. */
import { verdictArgs } from '../../dev_preview_rules.mjs'
import { verdictNote } from '../../src/dev_preview_rules.ts'
import { postVerdict } from '../../src/ext/preview-phone/preview_phone.ts'
import { mountPreviewPhone } from '../../src/ext/preview-phone/preview_phone_view.ts'
import { previewTools } from '../../../mcp/src/preview_tools.ts'

const row = (key, over = {}) => ({ key, title: key.toUpperCase(), branch: `b/${key}`, requires: [], checked: true, verdict: null, ...over })

describe('dev server route: verdictArgs', () => {
  const keys = ['a']
  it('verdict with a note -> --note; without or empty -> none', () => {
    expect(verdictArgs({ feature: 'a', verdict: 'needs-work', note: '  hides Add ' }, keys)).toEqual(['verdict', 'a', 'needs-work', '--note', 'hides Add'])
    expect(verdictArgs({ feature: 'a', verdict: 'needs-work' }, keys)).toEqual(['verdict', 'a', 'needs-work'])
    expect(verdictArgs({ feature: 'a', verdict: 'merge', note: '   ' }, keys)).toEqual(['verdict', 'a', 'merge'])
    expect(verdictArgs({ feature: 'a', verdict: null }, keys)).toEqual(['verdict', 'a', 'clear'])
  })
  it('a note that is not text, too long, an unknown row or verdict: bad request (null)', () => {
    expect(verdictArgs({ feature: 'a', verdict: 'needs-work', note: 5 }, keys)).toBeNull()
    expect(verdictArgs({ feature: 'a', verdict: 'needs-work', note: 'x'.repeat(501) }, keys)).toBeNull()
    expect(verdictArgs({ feature: 'z', verdict: 'merge' }, keys)).toBeNull()
    expect(verdictArgs({ feature: 'a', verdict: 'maybe' }, keys)).toBeNull()
  })
})

describe('postVerdict carries the note only when given', () => {
  it('body', async () => {
    const calls = []
    const fetchFn = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) } }
    await postVerdict(fetchFn, 'a', 'needs-work', 'too slow')
    await postVerdict(fetchFn, 'a', 'merge')
    expect(calls).toEqual([{ feature: 'a', verdict: 'needs-work', note: 'too slow' }, { feature: 'a', verdict: 'merge' }])
  })
})

describe('phone sheet: Needs work sends the typed note; a stored note shows', () => {
  it('sends and shows', async () => {
    const calls = []
    const fetchFn = async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) } }
    mountPreviewPhone({ id: 'tw1', features: [row('a'), row('b', { checked: false, verdict: 'needs-work', note: 'old note' })] }, { fetchFn, copy: async () => {} })
    const a = document.querySelector('.twpp-row[data-key="a"]')
    const box = a.querySelector('[data-twpp-note]')
    expect(box).toBeTruthy()
    box.value = 'button overlaps the bar'
    ;[...a.querySelectorAll('.twpp-v')].find((b) => b.textContent.includes('Needs work')).click()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls[0]).toEqual({ feature: 'a', verdict: 'needs-work', note: 'button overlaps the bar' })
    expect(document.querySelector('.twpp-row[data-key="a"] [data-twpp-note]').value).toBe('button overlaps the bar')
    expect(document.querySelector('.twpp-row[data-key="b"] [data-twpp-note]').value).toBe('old note')
  })
})

describe('Mac panel line and MCP parity', () => {
  it('verdictNote: the note with its mark, nothing without one', () => {
    expect(verdictNote(row('a', { note: 'fix the pill' }))).toBe('📝 fix the pill')
    expect(verdictNote(row('a'))).toBeNull()
  })
  it('preview_verdict passes a note', async () => {
    const calls = []
    const fetch = async (url, init = {}) => { calls.push(init.body ? JSON.parse(init.body) : undefined); return { ok: true, status: 200, json: async () => ({ id: 'tw1', features: [row('a')] }) } }
    const by = Object.fromEntries(previewTools({ url: 'http://127.0.0.1:5300', write: true, fetch }).map((t) => [t.name, t]))
    expect(await by.preview_verdict.run({ key: 'a', verdict: 'needs-work', note: 'hides Add' })).toEqual({ key: 'a', verdict: 'needs-work', note: 'hides Add' })
    expect(calls.at(-1)).toEqual({ feature: 'a', verdict: 'needs-work', note: 'hides Add' })
  })
})
