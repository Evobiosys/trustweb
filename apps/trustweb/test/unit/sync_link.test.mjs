/** Device sync, the network part (src/sync_link.ts): pair, confirm, sync both ways over a fake relay that sees only sealed text. */
import { createSyncLink } from '../../src/sync_link.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
globalThis.location = { origin: 'http://127.0.0.1:1' }

function hub() {
  const sinks = new Map()
  const wires = []
  const channel = () => {
    let did = ''
    let cb = null
    return {
      connect: async (id) => { did = id.did; sinks.set(did, cb) },
      onRawWire: (f) => { cb = f },
      sendRaw: async (to, payload) => { wires.push({ to, from: did, payload }); await new Promise((r) => setTimeout(r, 0)); sinks.get(to)?.(did, payload) },
      close: () => {}, onEnvelope: () => {}, onStatus: () => {}, send: async () => {},
    }
  }
  return { channel, wires, sinks }
}

const line = (id) => ({ id, text: id, tag: 'note', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 })
const person = (id, name, lines = []) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines })
const mk = (name, people) => ({ v: 1, me: { name }, people, peers: [], inventory: [], log: [], meetings: [] })

async function device(h, name, state, persona) {
  const log = []
  const box = { requests: [], incoming: [] }
  const api = createSyncLink({
    persona, state: () => state, save: () => {}, deviceName: name, channel: h.channel(), storage: mem(),
    onPairRequest: (r) => box.requests.push(r), onIncoming: (i) => box.incoming.push(i), onLog: (l) => log.push(l), onChange: () => {}, handshakeMs: 300,
  })
  await api.start()
  return { api, log, box, state }
}

const until = async (f) => { for (let i = 0; i < 100; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 20)) } throw new Error('timeout') }

describe('pair and sync', () => {
  it('pairs with a code, shows one fingerprint, syncs a record both ways, the relay sees no plaintext', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', mk('J', [person('a', 'Ada', [line('l1')])]), 'mac')
    const phone = await device(h, 'Phone', mk('J', [person('b', 'Ben')]), 'phone')
    const code = await mac.api.offerCode()
    const mine = await phone.api.join(code)
    expect(mine.fp).toMatch(/^[0-9A-F]{4}$/)
    await until(() => mac.box.requests.length === 1)
    expect(mac.box.requests[0].fp).toBe(mine.fp)
    mine.confirm(); mac.box.requests[0].confirm()
    expect(mac.api.pairings()).toHaveLength(1)
    expect(phone.api.pairings()[0].fp).toBe(mine.fp)

    // phone -> mac
    const macDid = phone.api.pairings()[0].did
    await phone.api.syncNow(macDid)
    await until(() => mac.box.incoming.length === 1)
    expect(mac.box.incoming[0].counts).toMatchObject({ people: 1 })
    expect(mac.box.incoming[0].reply).toBe(false)
    await mac.box.incoming[0].accept()
    expect(mac.state.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
    // mac sends its (merged) record back; phone confirms
    await until(() => phone.box.incoming.length === 1)
    expect(phone.box.incoming[0].reply).toBe(true)
    await phone.box.incoming[0].accept()
    expect(phone.state.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(phone.box.incoming).toHaveLength(1)

    const all = h.wires.map((w) => w.payload).join('')
    expect(all).not.toContain('Ada')
    expect(all).not.toContain('Ben')
  })

  it('a code is one use: a second device with the same code gets no request', async () => {
    const h = hub()
    const a = await device(h, 'A', mk('J', []), 'a')
    const b = await device(h, 'B', mk('J', []), 'b')
    const c = await device(h, 'C', mk('J', []), 'c')
    const code = await a.api.offerCode()
    await b.api.join(code)
    await until(() => a.box.requests.length === 1)
    await c.api.join(code)
    await new Promise((r) => setTimeout(r, 150))
    expect(a.box.requests).toHaveLength(1)
  })

  it('Sync now says offline when the other device does not answer within the handshake', async () => {
    const h = hub()
    const a = await device(h, 'A', mk('J', []), 'a')
    const b = await device(h, 'B', mk('J', []), 'b')
    const code = await a.api.offerCode()
    const mine = await b.api.join(code)
    await until(() => a.box.requests.length === 1)
    mine.confirm(); a.box.requests[0].confirm()
    h.sinks.delete(b.api.pairings()[0].did) // A is gone
    await expect(b.api.syncNow(b.api.pairings()[0].did)).rejects.toThrow('offline')
  })

  it('a not-a-code string is refused', async () => {
    const h = hub()
    const a = await device(h, 'A', mk('J', []), 'a')
    expect(await a.api.join('hello')).toBeNull()
  })
})
