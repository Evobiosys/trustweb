/** Wave 8: the non-responsive field greys people and keeps them out of asks; the generators keep the tw-* entry on regeneration. */
import { describe, expect, it } from 'vitest'
import { askPeers, isBlocked, isNonResponsive } from '../../src/non_responsive.ts'
import { render } from '../../../../packages/person-fields/scripts/tana_schema_to_fields.mjs'

const peer = (id) => ({ id, displayName: id })
const person = (id, peerId, on) => ({ id, peerId, fields: on === undefined ? undefined : { 'tw-non-responsive': on } })

describe('non-responsive', () => {
  it('reads a ticked box as boolean or string', () => {
    expect(isNonResponsive(person('a', 'p', true))).toBe(true)
    expect(isNonResponsive(person('a', 'p', 'true'))).toBe(true)
    expect(isNonResponsive(person('a', 'p', false))).toBe(false)
    expect(isNonResponsive(person('a', 'p'))).toBe(false)
  })
  it('asks skip marked peers only', () => {
    const s = { peers: [peer('p1'), peer('p2'), peer('p3')], people: [person('a', 'p1', true), person('b', 'p2', false), person('c', undefined, true)] }
    expect(askPeers(s).map((p) => p.id)).toEqual(['p2', 'p3'])
  })
  it('a blocked person is skipped by asks; 0 is the unblock tombstone', () => {
    const s = { peers: [peer('p1'), peer('p2'), peer('p3')], people: [{ ...person('a', 'p1'), blocked: 5 }, { ...person('b', 'p2'), blocked: 0 }, person('c', 'p3')] }
    expect(askPeers(s).map((p) => p.id)).toEqual(['p2', 'p3'])
    expect([isBlocked(s.people[0]), isBlocked(s.people[1]), isBlocked(s.people[2]), isBlocked(undefined)]).toEqual([true, false, false, false])
  })
  it('the generator keeps the tw-non-responsive entry', () => {
    expect(render([])).toContain('"id": "tw-non-responsive"')
  })
})
