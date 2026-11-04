// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29: the TrustZones "Show how my contacts are connected" toggle: no edge touches me, the toggle persists like the filters. */
import { withoutMe, contactPairs, connectionsShown } from '../../src/zone_connections.ts'
import { setUi } from '../../src/trustzones.ts'

const p = (id, knows = []) => ({ id, name: id, context: '', ring: 'close', lines: [], knows })

describe('withoutMe', () => {
  it('drops every edge touching node 0 (me), keeps the rest', () => {
    expect(withoutMe([[0, 1, true], [2, 0, false], [1, 2, true]])).toEqual([[1, 2, true]])
  })
})

describe('contactPairs', () => {
  it('lists contact-to-contact pairs only: a person who knows me or lists me gets no line', () => {
    const people = [p('a', ['me', 'b']), p('b'), p('c', ['me'])]
    expect(contactPairs('me', people)).toEqual([['a', 'b']])
  })
  it('ignores unknown ids and repeats', () => {
    expect(contactPairs('me', [p('a', ['b', 'zz']), p('b', ['a'])])).toEqual([['a', 'b']])
  })
})

describe('toggle', () => {
  it('is off by default and persists in uiRings like the filters', () => {
    const s = {}
    expect(connectionsShown(s)).toBe(false)
    setUi(s, 'connections', true)
    expect(connectionsShown(JSON.parse(JSON.stringify(s)))).toBe(true)
    setUi(s, 'connections', false)
    expect(connectionsShown(s)).toBe(false)
  })
})
