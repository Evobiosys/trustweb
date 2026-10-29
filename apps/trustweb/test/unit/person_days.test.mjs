// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the Days section on a person's card (person_days.ts). */
import { ChatDirection } from '../../src/chat.ts'
import { personDays, DAYS_PAGE } from '../../src/person_days.ts'

const at = (d, h = 10) => new Date(2026, 9, d, h).getTime()
const person = (o = {}) => ({ id: 'p1', name: 'Anna', context: '', ring: 'close', metAt: 0, lines: [], peerId: 'pe1', ...o })
const state = (o = {}) => ({ people: [], peers: [], log: [], ...o })

describe('personDays', () => {
  it('groups chat messages per day as one entry with the count, newest day first', () => {
    const s = state({ chats: { pe1: { unread: 0, messages: [
      { dir: ChatDirection.In, at: at(5, 9) }, { dir: ChatDirection.Out, at: at(5, 11) }, { dir: ChatDirection.In, at: at(7) },
    ] } } })
    const r = personDays(s, person(), DAYS_PAGE)
    expect(r.days.map((d) => d.entries.length)).toEqual([1, 1])
    expect(r.days[0].day).toBeGreaterThan(r.days[1].day)
    expect(r.days[1].entries[0].summary).toContain('2')
    expect(r.more).toBe(false)
  })
  it('adds meetings, events together and typed timeline entries', () => {
    const s = state({
      meetings: [{ id: 'm1', personId: 'p1', startedAt: at(3), endedAt: at(3, 11) }, { id: 'm2', personId: 'x', startedAt: at(4), endedAt: at(4) }],
      events: [{ id: 'e1', name: 'Fair', from: '2026-10-02', people: ['p1'] }],
    })
    const p = person({ timeline: [{ at: at(1), channel: 'email', direction: 'in', summary: 'Re: garden', source: 'manual' }] })
    expect(personDays(s, p, DAYS_PAGE).days.map((d) => d.entries.map((e) => e.channel))).toEqual([['in_person'], ['in_person'], ['email']])
  })
  it('shows only the newest n days and says when there are more', () => {
    const p = person({ timeline: Array.from({ length: 40 }, (_, i) => ({ at: at(1) - i * 86_400_000, channel: 'call', direction: 'both', summary: 'c' + i, source: 'manual' })) })
    const r = personDays(state(), p, DAYS_PAGE)
    expect(r.days).toHaveLength(30)
    expect(r.more).toBe(true)
    expect(personDays(state(), p, 60).more).toBe(false)
  })
})
