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

async function device(h, name, state, persona, extra = {}) {
  const log = []
  const box = { requests: [], incoming: [], snapshots: [] }
  const api = createSyncLink({
    persona, state: () => state, save: () => {}, deviceName: () => name, snapshot: async (reason, file) => { box.snapshots.push({ reason, file, people: state.people.length }) }, channel: h.channel(), storage: mem(), ...extra,
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
    const phone = await device(h, 'Phone', mk('J', [person('b', 'Ben Carter')]), 'phone')
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
    await mac.box.incoming[0].accept(false)
    expect(mac.state.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
    // mac sends its (merged) record back; phone confirms
    await until(() => phone.box.incoming.length === 1)
    expect(phone.box.incoming[0].reply).toBe(true)
    await phone.box.incoming[0].accept(false)
    expect(phone.state.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
    expect(phone.box.incoming).toHaveLength(1)

    const all = h.wires.map((w) => w.payload).join('')
    expect(all).not.toContain('Ada Lovelace')
    expect(all).not.toContain('Ben Carter')
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

  it('a snapshot is taken before the merge is applied (with the file wish), and again for the reply', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', mk('J', [person('a', 'Ada Lovelace')]), 'mac')
    const phone = await device(h, 'Phone', mk('J', [person('b', 'Ben Carter')]), 'phone')
    const mine = await phone.api.join(await mac.api.offerCode())
    await until(() => mac.box.requests.length === 1)
    mine.confirm(); mac.box.requests[0].confirm()
    await phone.api.syncNow(phone.api.pairings()[0].did)
    await until(() => mac.box.incoming.length === 1)
    expect(mac.box.snapshots).toHaveLength(0)
    await mac.box.incoming[0].accept(true)
    expect(mac.box.snapshots).toEqual([{ reason: 'before sync from Phone', file: true, people: 1 }])
    expect(mac.state.people).toHaveLength(2)
  })

  it('a device of another SYNC_VERSION is told to update, not silently ignored', async () => {
    const h = hub()
    const a = await device(h, 'A', mk('J', []), 'a', { version: 1 })
    const b = await device(h, 'B', mk('J', []), 'b')
    const mine = await b.api.join(await a.api.offerCode())
    await until(() => a.box.requests.length === 1)
    mine.confirm(); a.box.requests[0].confirm()
    await expect(b.api.syncNow(b.api.pairings()[0].did)).rejects.toThrow('version')
    expect(a.box.incoming).toHaveLength(0)
  })

  it('a not-a-code string is refused', async () => {
    const h = hub()
    const a = await device(h, 'A', mk('J', []), 'a')
    expect(await a.api.join('hello')).toBeNull()
  })
})

describe('one username for all devices (wave 15)', () => {
  const ASK_A = 'did:peer:2.' + 'Vz6MkA'.repeat(8)
  const ASK_B = 'did:peer:2.' + 'Vz6MkB'.repeat(8)
  const link = (c, over = {}) => ({ code: c.repeat(22), secret: c.repeat(43), url: `https://app.trustintheweb.org/?connect=${encodeURIComponent(ASK_A)}`, updatedAt: 5, ...over })
  const paired = async (a, b, opts) => {
    const mine = await b.api.join(await a.api.offerCode())
    await until(() => a.box.requests.length === 1)
    mine.confirm(opts); a.box.requests[0].confirm(opts)
    return b.api.pairings()[0].did
  }

  it('hello and ready announce the asking DID; each side stores it beside the pairing', async () => {
    const h = hub()
    const a = await device(h, 'A', mk('J', []), 'a', { askDid: () => ASK_A })
    const b = await device(h, 'B', mk('J', []), 'b', { askDid: () => ASK_B })
    const did = await paired(a, b)
    expect(a.api.pairings()[0].askDid).toBe(ASK_B) // the joining side's pair message carried it
    expect(b.api.pairings()[0].askDid).toBeUndefined()
    await b.api.syncNow(did)
    await until(() => a.box.incoming.length === 1)
    expect(b.api.pairings()[0].askDid).toBe(ASK_A) // A's ready carried it
  })

  it('the code travels sealed; the receiver adopts it as owner other and settles; ticked off, nothing of it is sent', async () => {
    const h = hub()
    const merges = []
    const a = await device(h, 'A', { ...mk('J', []), connectCode: link('A', { name: 'ada' }) }, 'a')
    const b = await device(h, 'B', mk('J', []), 'b', { settleCodes: async (m) => { merges.push(m) } })
    await paired(a, b)
    await a.api.syncNow(a.api.pairings()[0].did)
    await until(() => b.box.incoming.length === 1)
    const res = await b.box.incoming[0].accept(false)
    expect(b.state.connectCode).toMatchObject({ code: 'A'.repeat(22), owner: 'other', fromDid: b.api.pairings()[0].did })
    expect(res.codes).toEqual({ reread: true })
    expect(merges).toHaveLength(1)
    expect(h.wires.map((w) => w.payload).join('')).not.toContain('A'.repeat(43))

    const h2 = hub()
    const c = await device(h2, 'C', { ...mk('J', []), connectCode: link('C') }, 'c')
    const d = await device(h2, 'D', mk('J', []), 'd')
    await paired(c, d, { shareCode: false })
    expect(c.api.pairings()[0].shareCode).toBe(false)
    await c.api.syncNow(c.api.pairings()[0].did)
    await until(() => d.box.incoming.length === 1)
    await d.box.incoming[0].accept(false)
    expect(d.state.connectCode).toBeUndefined()
  })

  it('the receiving side honours its own tick: unticked there, no code and no display name are taken though the sender shares (F2, D3)', async () => {
    const h = hub()
    const merges = []
    const a = await device(h, 'A', { ...mk('J', []), connectCode: link('A', { name: 'ada' }), me: { name: 'J', displayName: 'From A' } }, 'a')
    const b = await device(h, 'B', { ...mk('J', []), me: { name: 'J', displayName: 'Mine B' } }, 'b', { settleCodes: async (m) => { merges.push(m) } })
    const mine = await b.api.join(await a.api.offerCode())
    await until(() => a.box.requests.length === 1)
    mine.confirm({ shareCode: false })
    a.box.requests[0].confirm()
    expect(a.api.pairings()[0].shareCode).toBeUndefined()
    await a.api.syncNow(a.api.pairings()[0].did)
    await until(() => b.box.incoming.length === 1)
    const res = await b.box.incoming[0].accept(false)
    expect(b.state.connectCode).toBeUndefined()
    expect(b.state.otherCodes).toBeUndefined()
    expect(b.state.me.displayName).toBe('Mine B')
    expect(res.codes).toBeUndefined()
    expect(merges).toEqual([])
  })

  it('the tick can be changed later per pairing (D1); sending marks the code as shared (F3)', async () => {
    const h = hub()
    const a = await device(h, 'A', { ...mk('J', []), connectCode: link('A', { name: 'ada' }) }, 'a')
    const b = await device(h, 'B', mk('J', []), 'b')
    await paired(a, b)
    const did = a.api.pairings()[0].did
    a.api.setShare(did, false)
    expect(a.api.pairings()[0].shareCode).toBe(false)
    a.api.setShare(did, true)
    expect(a.api.pairings()[0].shareCode).toBeUndefined()
    await a.api.syncNow(did)
    await until(() => b.box.incoming.length === 1)
    expect(a.state.connectCode.shared).toBe(true)
  })
})
