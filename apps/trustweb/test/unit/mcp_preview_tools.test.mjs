// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 review-panel MCP parity: the panel's rows, verdicts and "Mark as merged" through the dev server's /__tw/preview, with a fake fetch. */
import { previewTools } from '../../../mcp/src/preview_tools.ts'

const reg = { id: 'tw1', features: [
  { key: 'a', title: 'Alpha', branch: 'wave42/a', requires: [], checked: true, verdict: 'merge', merged: false },
  { key: 'b', title: 'Beta', branch: 'wave42/b', requires: ['a'], checked: false, verdict: null, merged: false },
  { key: 'm', title: 'Merged', branch: 'wave41/m', requires: [], checked: true, verdict: 'merge', merged: true },
], assembled: { sha: 's', at: 't', error: 'wave42/b: CONFLICT\nline 2' }, gate: { kind: 'squashed-in-main', action: 'mark-merged b', hint: 'b is already in main' } }
function fixture(over = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    return { ok: over.ok ?? true, status: over.status ?? 200, json: async () => over.answer ?? reg }
  }
  const tools = previewTools({ url: 'http://127.0.0.1:5300', write: true, fetch, ...over.opts })
  return { calls, by: Object.fromEntries(tools.map((t) => [t.name, t])), tools }
}

describe('preview tools', () => {
  it('writes off: only preview_rows', () => {
    expect(fixture({ opts: { write: false } }).tools.map((t) => t.name)).toEqual(['preview_rows'])
    expect(fixture().tools.map((t) => t.name)).toEqual(['preview_rows', 'preview_verdict', 'preview_mark_merged'])
  })
  it('preview_rows lists visible rows with state, requires and the conflict with its gate action', async () => {
    const { by, calls } = fixture()
    const out = await by.preview_rows.run({})
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:5300/__tw/preview', method: 'GET' })
    expect(out.rows).toEqual([
      { key: 'a', title: 'Alpha', branch: 'wave42/a', loaded: true, state: 'approved', requires: [] },
      { key: 'b', title: 'Beta', branch: 'wave42/b', loaded: false, state: 'review', requires: ['a'] },
    ])
    expect(out.conflict).toEqual({ first: 'wave42/b: CONFLICT', action: 'mark-merged b' })
  })
  it('preview_verdict posts merge / needs-work / clear (null) for a known row', async () => {
    const { by, calls } = fixture()
    await by.preview_verdict.run({ key: 'a', verdict: 'needs-work' })
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:5300/__tw/preview/verdict', method: 'POST', body: { feature: 'a', verdict: 'needs-work' } })
    await by.preview_verdict.run({ key: 'a', verdict: 'clear' })
    expect(calls[1].body).toEqual({ feature: 'a', verdict: null })
    await expect(by.preview_verdict.run({ key: 'a', verdict: 'later' })).rejects.toThrow(/verdict/)
    await expect(by.preview_verdict.run({ verdict: 'merge' })).rejects.toThrow(/key/)
  })
  it('preview_mark_merged posts the row key', async () => {
    const { by, calls } = fixture()
    await by.preview_mark_merged.run({ key: 'b' })
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:5300/__tw/preview/mark-merged', method: 'POST', body: { feature: 'b' } })
  })
  it('a server error is thrown with its text; a non-loopback url is refused', async () => {
    const { by } = fixture({ ok: false, status: 500, answer: { error: 'boom' } })
    await expect(by.preview_rows.run({})).rejects.toThrow(/boom/)
    expect(() => previewTools({ url: 'http://example.com:5300', write: true })).toThrow(/loopback/)
  })
})
