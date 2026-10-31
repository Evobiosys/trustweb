// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-host): what "Extend" on the Chat screen shows (messenger_host.ts). Pure. */
import { pickExtended } from '../../src/messenger_host.ts'

const src = (id, status) => ({ id, label: id, icon: '', status: () => status, threads: () => [], open: () => {} })

describe('messenger host', () => {
  it('nothing installed: the setup row, with nothing to set up', () => {
    expect(pickExtended([])).toEqual({ kind: 'setup', sources: [] })
  })
  it('Geb is the default extended chat once it is set up', () => {
    const r = pickExtended([src('matrix', 'live'), src('geb', 'live')])
    expect(r.kind).toBe('source')
    expect(r.source.id).toBe('geb')
  })
  it('without Geb, the first source that is set up (live or archive)', () => {
    expect(pickExtended([src('geb', 'needs-setup'), src('signal-link', 'archive'), src('matrix', 'live')]).source.id).toBe('signal-link')
  })
  it('a chosen source wins while it is set up', () => {
    expect(pickExtended([src('geb', 'live'), src('matrix', 'live')], 'matrix').source.id).toBe('matrix')
    expect(pickExtended([src('geb', 'live'), src('matrix', 'needs-setup')], 'matrix').source.id).toBe('geb')
  })
  it('nothing set up: the setup row lists every source to set up', () => {
    const r = pickExtended([src('geb', 'needs-setup'), src('matrix', 'needs-setup')])
    expect(r).toMatchObject({ kind: 'setup' })
    expect(r.sources.map((s) => s.id)).toEqual(['geb', 'matrix'])
  })
})
