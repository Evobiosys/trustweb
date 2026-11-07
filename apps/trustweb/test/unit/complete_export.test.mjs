// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { peopleCsv, timelineCsv, updatesCsv, EXPORT_FILES } from '../../src/complete_export.ts'
import { Ring } from '../../src/model.ts'

const DAY = 86_400_000
const NOW = 5000 * DAY
const person = (id, o = {}) => ({ id, name: id, context: '', ring: Ring.Friend, metAt: NOW - 100 * DAY, lines: [], ...o })
const opts = { now: NOW, ringLabel: (r) => String(r), lastContact: (p) => p.metAt }
const ctx = (people, extra = {}) => ({ s: { people, events: [], shareProfiles: [], ...extra }, opts, groupsOf: () => [] })
const lines = (csv) => csv.replace(/^﻿/, '').trim().split('\r\n')

describe('people.csv', () => {
  it('adds cadence_days, next_reminder and groups to the contacts columns', () => {
    const p = person('Ann', { cadenceDays: 30 })
    const out = lines(peopleCsv([p], { ...ctx([p]), groupsOf: () => ['Choir', 'Gardens'] }))
    expect(out[0].split(',').slice(-3)).toEqual(['cadence_days', 'next_reminder', 'groups'])
    expect(out[1]).toContain(',30,')
    expect(out[1]).toContain('Choir ::: Gardens')
  })
  it('guards formulas and never writes the only-me note', () => {
    const p = person('=cmd()', { generalNote: 'only me', sharedNotes: [{ text: 'shared' }] })
    const csv = peopleCsv([p], ctx([p]))
    expect(csv).toContain("'=cmd()")
    expect(csv).not.toContain('only me')
  })
})

describe('timeline.csv', () => {
  it('lists timeline entries and events per person, without notes', () => {
    const p = person('Ann', { events: ['e1'], timeline: [
      { at: NOW - DAY, channel: 'email', direction: 'in', summary: 'Re: garden', source: 'import' },
      { at: NOW - 2 * DAY, channel: 'note', direction: 'both', summary: 'private thought', source: 'manual' },
    ] })
    const out = lines(timelineCsv([p], ctx([p], { events: [{ id: 'e1', name: 'Fair', from: '2026-05-01', where: '' }] })))
    expect(out[0]).toBe('person,date,kind,text')
    expect(out.join('\n')).toContain('Ann,')
    expect(out.join('\n')).toContain('Re: garden')
    expect(out.join('\n')).toContain('Fair')
    expect(out.join('\n')).not.toContain('private thought')
    expect(out).toHaveLength(3)
  })
})

describe('updates.csv', () => {
  it('writes one ring snapshot row per person', () => {
    const p = person('Ann', { prevRing: Ring.Close })
    const out = lines(updatesCsv([p], ctx([p])))
    expect(out[0]).toBe('person,date,ring_before,ring_after')
    expect(out[1].startsWith('Ann,')).toBe(true)
    expect(out).toHaveLength(2)
  })
})

describe('files', () => {
  it('names the three files', () => {
    expect(EXPORT_FILES).toEqual(['people.csv', 'timeline.csv', 'updates.csv'])
  })
})
