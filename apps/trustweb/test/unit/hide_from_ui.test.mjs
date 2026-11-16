// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * Wave 44b hide-from-crypto: who the sealed list names (hiddenDids), the report wording, the sealed line. Fake data only. */
import { hiddenDids } from '../../src/ask_audience.ts'
import { hideReportText, hideSealedLine } from '../../src/hide_from_view.ts'
import { addHideReport, HIDE_REPORTS_MAX, hideReportsList } from '../../src/hide_reports.ts'
import { Ring } from '../../src/model.ts'
import { S } from '../../src/strings.ts'

const p = (id, extra = {}) => ({ id, name: id, ring: Ring.Friend, peerId: 'peer-' + id, fields: {}, ...extra })
const peer = (id, extra = {}) => ({ id: 'peer-' + id, displayName: id, did: 'did:peer:2.' + id, ring: Ring.Friend, connectedAt: 1, ...extra })
const tags = [{ id: 'yoga', colour: '#112233', label: 'yoga' }]
const base = () => ({
  people: [p('a'), p('b', { fields: { yoga: 'true' } }), p('c', { peerId: undefined, fields: { yoga: 'true' } })],
  peers: [peer('a', { alsoDids: ['did:peer:2.a-laptop'] }), peer('b')],
})

describe('hiddenDids', () => {
  it('nothing hidden: no DIDs', () => expect(hiddenDids(base(), tags)).toEqual([]))
  it('a person: every device of theirs; a tag: its connected holders (one without a connection has no DID)', () => {
    expect(hiddenDids({ ...base(), askAudience: { add: [], exclude: ['person:a'] } }, tags)).toEqual(['did:peer:2.a', 'did:peer:2.a-laptop'])
    expect(hiddenDids({ ...base(), askAudience: { add: [], exclude: ['tag:yoga'] } }, tags)).toEqual(['did:peer:2.b'])
  })
})

describe('the report and the sealed line', () => {
  it('names the hop and the reason', () => {
    expect(hideReportText({ askId: 'r', text: 't', step: 2, why: 'tampered', at: 1 }).body).toBe(S.hideFrom.tampered(2))
    expect(S.hideFrom.tampered(2)).toContain("changed your ask's hidden list (hop 2)")
    expect(hideReportText({ askId: 'r', text: 't', step: 3, why: 'unsupported', at: 1 }).body).toBe(S.hideFrom.unsupported(3))
  })
  it('the record keeps the newest, bounded; the MCP list reads it', () => {
    let l
    for (let i = 0; i < HIDE_REPORTS_MAX + 3; i++) l = addHideReport(l, { askId: 'r' + i, text: 't', step: 2, why: 'tampered', at: i })
    expect(l).toHaveLength(HIDE_REPORTS_MAX)
    expect(l[0].askId).toBe('r' + (HIDE_REPORTS_MAX + 2))
    expect(hideReportsList({ hideReports: l }).reports).toHaveLength(HIDE_REPORTS_MAX)
    expect(hideReportsList({})).toEqual({ reports: [] })
  })
  it('the sealed line carries the lock and the sentence', () => {
    const n = hideSealedLine()
    expect(n.getAttribute('data-hide-sealed')).toBe('')
    expect(n.textContent).toContain('🔒')
    expect(n.textContent).toContain(S.hideFrom.sealed)
  })
})
