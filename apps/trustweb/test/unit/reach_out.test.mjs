/** Wave 8: a reach-out through a public connect link: the colour, the wire field. */
import { REACH_OUT, Ring, ringColor, RING_COLORS } from '../../src/model.ts'
import { buildConnectAck } from '../../../demo/src/connect_link.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'

const me = { id: 'a1', displayName: 'Anna Berger' }
const did = { did: 'did:peer:2.abc' }

describe('reach-out colour', () => {
  it('is green-blue on the intending ring only while reachedOut is set', () => {
    expect(REACH_OUT).toBe('#2E9CA6')
    expect(ringColor({ ring: Ring.Intending, reachedOut: 'sent' })).toBe(REACH_OUT)
    expect(ringColor({ ring: Ring.Intending, reachedOut: 'received' })).toBe(REACH_OUT)
    expect(ringColor({ ring: Ring.Intending })).toBe(RING_COLORS.intending)
    expect(ringColor({ ring: Ring.Acquaintance, reachedOut: 'sent' })).toBe(RING_COLORS.acquaintance)
  })
})

describe('connect-ack reachOut field', () => {
  it('rides the wire when set and is absent otherwise', () => {
    const on = decodeFromQr(encodeForQr(buildConnectAck(me, did, true)))
    expect(on?.t === 'connect-ack' && on.reachOut).toBe(true)
    const off = buildConnectAck(me, did)
    expect('reachOut' in off).toBe(false)
    const back = decodeFromQr(encodeForQr(off))
    expect(back && 'reachOut' in back).toBe(false)
  })
  it('ignores a non-true value', () => {
    const raw = JSON.stringify({ v: 1, t: 'connect-ack', from: me, did: 'did:peer:2.abc', reachOut: 'yes' })
    const env = decodeFromQr(raw)
    expect(env && 'reachOut' in env).toBe(false)
  })
})
