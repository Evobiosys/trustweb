// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave44 home-dashboard: what the request tiles of the Home board show. Synthetic data; asks I sent show text only, never who answered (I2). */
import { ROWS_MAX, tileData } from '../../src/home_data.ts'

const s = {
  awayAsks: [{ id: 'q1', at: 5, peerId: 'x', from: 'Ana', text: 'a ladder?' }],
  heldAsks: [{ qid: 'q2', peerId: 'y', text: 'a lift?', fromName: 'Ben', through: [] }, { qid: 'q1', peerId: 'x', text: 'a ladder?', fromName: 'Ana', through: [] }],
  wantsToConnect: [{ peerId: 'z', name: 'Cy', at: 9 }],
  sentAsks: [{ id: 's1', text: 'a drill?', at: 3, to: [{ peerId: 'x', state: 'yes' }] }, { id: 's2', text: 'a tent?', at: 8, to: [] }],
  invitesSent: 4,
}

describe('tileData', () => {
  it('asks to me: away and held, one row per ask id', () => {
    const d = tileData(s, 'asksToMe')
    expect(d.count).toBe(2)
    expect(d.rows.map((r) => r.text)).toEqual(['Ana: a ladder?', 'Ben: a lift?'])
  })
  it('pending connects name the person', () => { expect(tileData(s, 'connects')).toMatchObject({ count: 1, rows: [{ text: 'Cy' }] }) })
  it('my asks: newest first, text only', () => {
    const d = tileData(s, 'asksSent')
    expect(d.rows.map((r) => r.text)).toEqual(['a tent?', 'a drill?'])
    expect(JSON.stringify(d)).not.toMatch(/peerId|yes/)
  })
  it('invites: a count only', () => { expect(tileData(s, 'invites')).toEqual({ count: 4, rows: [] }) })
  it('rows are capped, count is not', () => {
    const many = { sentAsks: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, text: `t${i}`, at: i, to: [] })) }
    expect(tileData(many, 'asksSent').rows).toHaveLength(ROWS_MAX)
    expect(tileData(many, 'asksSent').count).toBe(9)
  })
  it('an empty record gives empty tiles; the web tile has no data', () => {
    expect(tileData({}, 'asksToMe')).toEqual({ count: 0, rows: [] })
    expect(tileData({}, 'web')).toEqual({ count: 0, rows: [] })
  })
})
