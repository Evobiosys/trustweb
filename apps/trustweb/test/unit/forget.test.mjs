// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (sovereign-switch): "Be forgotten: TrustWeb" (forget.ts). The sender of a forget request IS the owner of the data it names. */
import { applyForget, forgetStatus, forgetText, isForgetText, noteForgetAck, noteForgetSent, parseForgetText, retractOwn, shareAgain } from '../../src/forget.ts'

const APP = 'https://app.example/'
const state = () => ({
  people: [
    { id: 'p1', name: 'Ana', peerId: 'peer1', theirChannels: { signal: '+430000000' }, theirChannelsAt: 3, theirProfile: { bio: 'x' }, lines: [{ id: 'l', text: 'my own note about Ana', tag: 'offer' }] },
    { id: 'p2', name: 'Bo', peerId: 'peer2', theirChannels: { signal: '+430000001' }, lines: [] },
  ],
  received: [{ id: 'r1', fromPeerId: 'peer1' }, { id: 'r2', fromPeerId: 'peer2' }],
  found: [{ id: 'f1', at: 1, text: 'bike', shared: [{ from: 'Ana', peerId: 'peer1', items: [] }, { from: 'Bo', peerId: 'peer2', items: [] }] }, { id: 'f2', at: 2, text: 'tent', shared: [{ from: 'Ana', peerId: 'peer1', items: [] }] }],
  inventory: [{ id: 'i1', included: true }, { id: 'i2', included: false }],
})

describe('forget: the wire text', () => {
  it('a request and an ack, each read back; anything else is not one', () => {
    const req = forgetText(APP, { op: 'forget', scope: 'all', ts: 42 })
    expect(isForgetText(APP, req)).toBe(true)
    expect(parseForgetText(APP, req)).toEqual({ op: 'forget', scope: 'all', ts: 42 })
    const ack = forgetText(APP, { op: 'forget-ack', ts: 42 })
    expect(parseForgetText(APP, ack)).toEqual({ op: 'forget-ack', ts: 42 })
    expect(parseForgetText(APP, `${APP}?forget=1#op=forget&scope=some&ts=1`)).toBeNull()
    expect(parseForgetText(APP, `${APP}?forget=1#op=forget&scope=all&ts=x`)).toBeNull()
    expect(parseForgetText(APP, 'hello')).toBeNull()
    expect(isForgetText(APP, 'hello')).toBe(false)
  })
})

describe('forget: the receiving side', () => {
  it('removes exactly what the sender shared, nothing of anyone else and none of my own notes', () => {
    const s = state()
    expect(applyForget(s, 'peer1')).toBe(6) // 1 share + 2 answers in finds + 3 card fields
    expect(s.received.map((r) => r.id)).toEqual(['r2'])
    expect(s.found).toEqual([{ id: 'f1', at: 1, text: 'bike', shared: [{ from: 'Bo', peerId: 'peer2', items: [] }] }])
    expect(s.people[0].theirChannels).toBeUndefined()
    expect(s.people[0].theirChannelsAt).toBeUndefined()
    expect(s.people[0].theirProfile).toBeUndefined()
    expect(s.people[0].lines).toHaveLength(1)
    expect(s.people[1].theirChannels).toEqual({ signal: '+430000001' })
  })
  it('a second request removes nothing more', () => {
    const s = state()
    applyForget(s, 'peer1')
    const after = JSON.stringify(s)
    expect(applyForget(s, 'peer1')).toBe(0)
    expect(JSON.stringify(s)).toBe(after)
  })
})

describe('forget: the sending side', () => {
  it('tracks sent and acknowledged per peer', () => {
    const s = {}
    expect(forgetStatus(s, 'peer1')).toBe('not-sent')
    noteForgetSent(s, 'peer1', 100)
    expect(forgetStatus(s, 'peer1')).toBe('sent')
    expect(noteForgetAck(s, 'peer1', 200)).toBe(true)
    expect(forgetStatus(s, 'peer1')).toBe('acked')
    expect(s.sovereign.forget.peers.peer1).toEqual({ sentAt: 100, ackAt: 200 })
    expect(noteForgetAck(s, 'peer9', 300)).toBe(false) // an ack nobody was asked for counts nothing
  })
  it('pauses my own shared lines, and Share again brings back exactly those', () => {
    const s = state()
    expect(retractOwn(s, 50)).toBe(1)
    expect(s.inventory).toEqual([{ id: 'i1', included: false, retractedAt: 50 }, { id: 'i2', included: false }])
    expect(shareAgain(s)).toBe(1)
    expect(s.inventory).toEqual([{ id: 'i1', included: true }, { id: 'i2', included: false }])
  })
})

describe('forget: routed as its own kind, never shown as a chat message', () => {
  it('routeText', async () => {
    const { routeText, TextKind } = await import('../../src/chat.ts')
    expect(routeText(APP, forgetText(APP, { op: 'forget', scope: 'all', ts: 1 }))).toBe(TextKind.Forget)
    expect(routeText(APP, forgetText(APP, { op: 'forget-ack', ts: 1 }))).toBe(TextKind.Forget)
    expect(routeText(APP, `${APP}?forget=1#op=nonsense`)).toBe(TextKind.Ignore)
  })
})
