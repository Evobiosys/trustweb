// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c sync-devices: a connection's other devices (alsoDids), what to tell whom, and the sealed 'devices' envelope on the wire. */
import { ALSO_DIDS_MAX, addAlsoDids, devicesToTell, didsOf, peerForDid, toldKey } from '../../src/device_alias.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'

const DID = (c) => 'did:peer:2.' + c.repeat(40)
const peer = (id, c, over = {}) => ({ id, displayName: id, did: DID(c), ring: 'friend', connectedAt: 1, ...over })

describe('device alias', () => {
  it('finds a peer by its own DID first, then by one of its other devices', () => {
    const peers = [peer('o1', 'a', { alsoDids: [DID('b')] }), peer('o2', 'b')]
    expect(peerForDid(peers, DID('b')).id).toBe('o2')
    expect(peerForDid(peers, DID('a')).id).toBe('o1')
    expect(peerForDid([peer('o1', 'a', { alsoDids: [DID('z')] })], DID('z')).id).toBe('o1')
    expect(peerForDid(peers, DID('q'))).toBeUndefined()
    expect(didsOf(peers[0])).toEqual([DID('a'), DID('b')])
  })

  it('adds only well-formed DIDs that are no other connection\'s own and not mine, at most ALSO_DIDS_MAX', () => {
    const o1 = peer('o1', 'a')
    const peers = [o1, peer('o2', 'b')]
    expect(addAlsoDids(peers, o1, [DID('c'), DID('b'), DID('a'), 'nonsense', DID('m')], [DID('m')])).toBe(true)
    expect(o1.alsoDids).toEqual([DID('c')])
    expect(addAlsoDids(peers, o1, [DID('c')], [])).toBe(false)
    const many = 'defghijklmnop'.split('').map(DID)
    addAlsoDids(peers, o1, many, [])
    expect(o1.alsoDids).toHaveLength(ALSO_DIDS_MAX)
  })

  it('tells every connection made on this device (not one that came by sync) the DIDs of my other devices, once per set', () => {
    const peers = [peer('o1', 'a'), peer('o2', 'b', { synced: true }), peer('o3', 'c', { toldDevices: toldKey([DID('x')]) })]
    expect(devicesToTell(peers, [DID('x')]).map((p) => p.id)).toEqual(['o1'])
    expect(devicesToTell(peers, [DID('y'), DID('x')]).map((p) => p.id)).toEqual(['o1', 'o3'])
    expect(devicesToTell(peers, [])).toEqual([])
  })

  it('the devices envelope survives the wire; anything malformed is null', () => {
    const env = { v: 1, t: 'devices', dids: [DID('a'), DID('b')] }
    expect(decodeFromQr(encodeForQr(env))).toEqual(env)
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'devices', dids: 'x' }))).toBeNull()
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'devices', dids: Array(20).fill(DID('a')) }))).toBeNull()
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'devices', dids: [1] }))).toBeNull()
  })
})
