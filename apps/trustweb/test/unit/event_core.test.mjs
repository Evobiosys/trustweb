// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Event core time (wave 36 event-desires): validation, label, event link, own-device sync.
import { coreLabel, newEvent } from '../../src/events.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { bundleOf } from '../../src/sync_core.ts'

const base = { name: 'Retreat', from: '2026-12-27', to: '2027-01-08', where: 'Hut' }
const make = (core) => newEvent({ ...base, ...(core ? { core } : {}) }, 'e1', 1)

describe('event core time', () => {
  it('keeps a valid core and leaves it out when absent', () => {
    expect(make({ from: '2026-12-30', to: '2027-01-04' }).core).toEqual({ from: '2026-12-30', to: '2027-01-04' })
    expect('core' in make()).toBe(false)
    expect('core' in make({ from: '', to: '' })).toBe(false)
  })

  it('refuses one end alone, a reversed core and a core outside the event', () => {
    expect(make({ from: '2026-12-30', to: '' })).toBe('core')
    expect(make({ from: '', to: '2027-01-04' })).toBe('core')
    expect(make({ from: '2027-01-04', to: '2026-12-30' })).toBe('core')
    expect(make({ from: '2026-12-26', to: '2027-01-04' })).toBe('core')
    expect(make({ from: '2026-12-30', to: '2027-01-09' })).toBe('core')
    expect(make({ from: 'x', to: 'y' })).toBe('core')
  })

  it('without an end date the core must not start before the event', () => {
    const e = (core) => newEvent({ name: 'A', from: '2026-12-27', where: '', core }, 'e', 1)
    expect(e({ from: '2026-12-26', to: '2026-12-28' })).toBe('core')
    expect(e({ from: '2026-12-28', to: '2026-12-30' }).core).toBeTruthy()
  })

  it('labels day and short month without a year, across New Year', () => {
    expect(coreLabel(make({ from: '2026-12-30', to: '2027-01-04' }))).toBe('Core time 30 Dec – 4 Jan')
    expect(coreLabel(make())).toBe('')
  })

  it('travels in the event link and survives the round trip', () => {
    const ev = make({ from: '2026-12-30', to: '2027-01-04' })
    const link = encodeEventLink(ev, 'https://app.trustweb.one', 'peer')
    expect(decodeEventLink(link.split('/#')[1]).core).toEqual({ from: '2026-12-30', to: '2027-01-04' })
  })

  it('a mangled core in a link drops only the core, the event still comes through', () => {
    const o = { kind: 'peer', id: 'e', name: 'A', from: '2026-12-27', where: '', core: { from: '2026-12-30' } }
    const ev = decodeEventLink('#ev=' + Buffer.from(JSON.stringify(o)).toString('base64url'))
    expect(ev?.name).toBe('A')
    expect(ev && 'core' in ev).toBe(false)
  })

  it('rides with the event in the own-device bundle', () => {
    const ev = make({ from: '2026-12-30', to: '2027-01-04' })
    const b = bundleOf({ people: [], inventory: [], meetings: [], events: [ev], me: { displayName: 'A' } }, {})
    expect(b.events[0].core).toEqual({ from: '2026-12-30', to: '2027-01-04' })
  })
})
