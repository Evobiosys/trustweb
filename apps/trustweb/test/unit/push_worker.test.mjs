/**
 * Wave 11 (APK + notifications): the per-kind switches (src/notify_kinds.ts) and the service worker's peek
 * (src/sw/sw.ts peekDrain) against the real RelayServer: after a wake it reads the waiting wires under the pair keys,
 * names the kinds, and acks NOTHING, so the page still gets every wire when it opens. Node's own WebSocket (node >= 22).
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { createIdentity, ecdhSharedSecret, serializeIdentity } from '../../../demo/src/did.ts'
import { buildOuterWire, encryptEnvelope } from '../../../demo/src/relay.ts'
import { deriveEcdhPairKey } from '../../../demo/src/crypto.ts'
import { encodeForQr } from '../../../demo/src/wire.ts'
import { ALL_KINDS_ON, kindOfWire, kindsOf, wantsKind, workerLines, WORKER_FALLBACK } from '../../src/notify_kinds.ts'
import { peekDrain } from '../../src/sw/sw.ts'

describe('notify_kinds', () => {
  it('maps every wire type to a kind or to nothing', () => {
    expect(kindOfWire('connect')).toBe('connect')
    expect(kindOfWire('connect-ack')).toBe('connect')
    expect(kindOfWire('query')).toBe('ask')
    expect(kindOfWire('ask-again')).toBe('ask')
    expect(kindOfWire('chat')).toBe('chat')
    expect(kindOfWire('answer')).toBeNull()
    expect(kindOfWire('ping')).toBeNull()
  })
  it('an older record has all kinds on; the master switch gates every kind', () => {
    expect(kindsOf({})).toEqual(ALL_KINDS_ON)
    expect(kindsOf({ notifyKinds: { connect: false, ask: true, chat: true } }).connect).toBe(false)
    expect(wantsKind({ notificationsOn: false }, 'chat')).toBe(false)
    expect(wantsKind({ notificationsOn: true }, 'chat')).toBe(true)
    expect(wantsKind({ notificationsOn: true, notifyKinds: { connect: true, ask: true, chat: false } }, 'chat')).toBe(false)
  })
  it('one line per kind that is on, naming who', () => {
    const arrivals = [
      { kind: 'chat', name: 'Max' }, { kind: 'chat', name: 'Max' }, { kind: 'ask', name: 'Anna' }, { kind: 'connect', name: null },
    ]
    expect(workerLines(arrivals, ALL_KINDS_ON)).toEqual(['Someone wants to connect.', 'Anna is sending you a query.', 'Max sent you 2 messages.'])
    expect(workerLines(arrivals, { connect: true, ask: false, chat: false })).toEqual(['Someone wants to connect.'])
    expect(workerLines([{ kind: 'chat', name: 'A' }, { kind: 'chat', name: 'B' }, { kind: 'chat', name: 'C' }], ALL_KINDS_ON)).toEqual(['A and 2 others sent you 3 messages.'])
    expect(workerLines([], ALL_KINDS_ON)).toEqual([])
    expect(WORKER_FALLBACK).toMatch(/Open TrustWeb/)
  })
})

describe('service worker peek', () => {
  let relay, origin, queue
  beforeAll(async () => {
    queue = new InMemoryRelayQueueStore()
    relay = new RelayServer({ queueStore: queue })
    const { port } = await relay.listen(0, '127.0.0.1')
    origin = `http://127.0.0.1:${port}`
  })
  afterAll(async () => { await relay.close() })

  it('reads waiting wires under the pair keys, names the kinds, acks nothing', async () => {
    const me = createIdentity(origin + '/relay')
    const max = createIdentity(origin + '/relay')
    const stranger = createIdentity(origin + '/relay')
    const key = await deriveEcdhPairKey(ecdhSharedSecret(max, me.did))
    const chat = await encryptEnvelope({ v: 1, t: 'chat', from: { id: 'max00001', displayName: 'Max' }, text: 'hi', ts: Date.now() }, key)
    const ask = await encryptEnvelope({ v: 1, t: 'query', from: { id: 'max00001', displayName: 'Max' }, templateId: 'free', templateVersion: 1, qid: 'q1234567', issuedAt: Date.now(), freeText: 'spare bike?' }, key)
    const ack = encodeForQr({ v: 1, t: 'connect-ack', from: { id: 'str00001', displayName: 'Nora' }, did: stranger.did })
    expect(relay.submit(buildOuterWire(me.did, max.did, chat)).routed).toBe('accepted')
    expect(relay.submit(buildOuterWire(me.did, max.did, ask)).routed).toBe('accepted')
    expect(relay.submit(buildOuterWire(me.did, stranger.did, ack)).routed).toBe('accepted')
    expect(queue.count(me.did)).toBe(3)

    const bundle = { v: 1, identity: serializeIdentity(me), peers: [{ did: max.did, name: 'Max' }], kinds: ALL_KINDS_ON, relayOrigin: origin, appName: 'TrustWeb' }
    const arrivals = await peekDrain(bundle, me, globalThis.WebSocket)
    expect(arrivals.map((a) => `${a.kind}:${a.name}`).sort()).toEqual(['ask:Max', 'chat:Max', 'connect:Nora'])
    expect(queue.count(me.did)).toBe(3) // nothing acked: the page gets them all
    expect(workerLines(arrivals, { connect: true, ask: true, chat: false })).toEqual(['Nora wants to connect.', 'Max is sending you a query.'])
  })

  it('an empty queue reads as no arrivals; a wrong identity reads as null', async () => {
    const me = createIdentity(origin + '/relay')
    const bundle = { v: 1, identity: serializeIdentity(me), peers: [], kinds: ALL_KINDS_ON, relayOrigin: origin, appName: 'TrustWeb' }
    expect(await peekDrain(bundle, me, globalThis.WebSocket)).toEqual([])
    const liar = { ...me, did: createIdentity(origin).did }
    expect(await peekDrain(bundle, liar, globalThis.WebSocket)).toBeNull()
  })
})
