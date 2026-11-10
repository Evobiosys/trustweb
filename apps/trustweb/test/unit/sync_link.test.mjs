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
    const mac = await device(h, 'Mac', mk('J', [person('a', 'Ada Lovelace', [line('l1')])]), 'mac')
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

  it('a receive-only device (canSend false) applies what comes in, sends nothing back and refuses Sync now', async () => {
    const h = hub()
    let send = true
    const phone = await device(h, 'Phone', mk('J', [person('b', 'Ben Carter')]), 'phone')
    const mac = await device(h, 'Mac', mk('J', [person('a', 'Ada Lovelace')]), 'mac', { canSend: () => send })
    const mine = await mac.api.join(await phone.api.offerCode())
    await until(() => phone.box.requests.length === 1)
    mine.confirm(); phone.box.requests[0].confirm()
    send = false
    await phone.api.syncNow(phone.api.pairings()[0].did)
    await until(() => mac.box.incoming.length === 1)
    await mac.box.incoming[0].accept(false)
    expect(mac.state.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
    await new Promise((r) => setTimeout(r, 150))
    expect(phone.box.incoming).toHaveLength(0)
    await expect(mac.api.syncNow(mac.api.pairings()[0].did)).rejects.toThrow('receive only')
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

describe('relay acks (2026-10-19: the "Receive from Phone?" sheet came back on every reconnect)', () => {
  it('the raw sink answers true for a wire of a linked device (acked, never redelivered) and false for a stranger', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', mk('J', []), 'mac')
    const phone = await device(h, 'Phone', mk('J', [person('b', 'Ben Carter')]), 'phone')
    const mine = await phone.api.join(await mac.api.offerCode())
    await until(() => mac.box.requests.length === 1)
    mine.confirm(); mac.box.requests[0].confirm()
    const macDid = phone.api.pairings()[0].did
    const phoneDid = mac.api.pairings()[0].did
    const paired = h.wires.length // the one-use pair wire before this is refused on replay by design
    await phone.api.syncNow(macDid)
    await until(() => mac.box.incoming.length === 1)
    const toMac = h.wires.slice(paired).filter((w) => w.to === macDid && w.from === phoneDid) // hello + data pieces
    expect(toMac.length).toBeGreaterThan(0)
    const macSink = h.sinks.get(macDid)
    for (const w of toMac) expect(await macSink(w.from, w.payload)).toBe(true)
    expect(await macSink('did:peer:2.stranger', toMac[0].payload)).toBe(false)
  })
})

describe('take another device\'s state (wave 40)', () => {
  async function pair(macState, phoneState, extra = {}) {
    const h = hub()
    const archived = []
    const adopted = []
    const wants = []
    // Review wave 40: a want waits for the person on the asked device; by default these tests tap Send at once.
    const hooks = (who) => ({ archive: (reason, dev) => { archived.push({ who, reason, dev }); return true }, onAdopted: (dev, diff) => adopted.push({ who, dev, diff }), onWant: (name, send) => { wants.push({ who, name }); void send() }, ...extra })
    const mac = await device(h, 'Mac', macState, 'mac', hooks('mac'))
    const phone = await device(h, 'Phone', phoneState, 'phone', hooks('phone'))
    const mine = await phone.api.join(await mac.api.offerCode())
    await until(() => mac.box.requests.length === 1)
    mine.confirm(); mac.box.requests[0].confirm()
    return { h, mac, phone, archived, adopted, wants, macDid: phone.api.pairings()[0].did, phoneDid: mac.api.pairings()[0].did }
  }

  it('Take: the other device sends its record after its person agrees, this one asks its person, archives first, then holds exactly that state', async () => {
    const t = await pair(mk('J', [person('a', 'Ada Lovelace', [line('l1')])]), mk('J', [person('b', 'Ben Carter')]))
    await t.phone.api.takeFrom(t.macDid)
    await until(() => t.phone.box.incoming.length === 1)
    const i = t.phone.box.incoming[0]
    expect(i.adopt.kind).toBe('take')
    expect(i.adopt.diff).toEqual({ people: 2, notes: 0, settings: 0 })
    expect(t.phone.state.people.map((p) => p.id)).toEqual(['b'])
    expect(await i.adopt.run()).toBe(true)
    expect(t.phone.state.people.map((p) => p.id)).toEqual(['a'])
    expect(t.archived).toEqual([{ who: 'phone', reason: "before taking Mac's state", dev: 'Mac' }])
    expect(t.adopted[0]).toMatchObject({ who: 'phone', dev: 'Mac' })
    expect(t.mac.state.people.map((p) => p.id)).toEqual(['a'])
    expect(t.mac.box.incoming).toHaveLength(0)
  })

  it('after taking, the next sync lists no conflict and changes nothing', async () => {
    const t = await pair(mk('J', [person('a', 'Ada Lovelace', [line('l1')])]), mk('J', [person('a', 'Ada edited here')]))
    await t.phone.api.takeFrom(t.macDid)
    await until(() => t.phone.box.incoming.length === 1)
    await t.phone.box.incoming[0].adopt.run()
    await t.phone.api.syncNow(t.macDid)
    await until(() => t.mac.box.incoming.length === 1)
    const res = await t.mac.box.incoming[0].accept(false)
    expect(res).toMatchObject({ added: 0, updated: 0, conflicts: [] })
    await until(() => t.phone.box.incoming.length === 2)
    expect(await t.phone.box.incoming[1].accept(false)).toMatchObject({ added: 0, updated: 0, conflicts: [] })
    expect(t.phone.state.people[0].name).toBe('Ada Lovelace')
  })

  it('Send my state: the other device is asked (give), and only its confirmation replaces its record', async () => {
    const t = await pair(mk('J', [person('a', 'Ada Lovelace')]), mk('J', [person('b', 'Ben Carter')]))
    await t.phone.api.sendTo(t.macDid)
    await until(() => t.mac.box.incoming.length === 1)
    expect(t.mac.box.incoming[0].adopt.kind).toBe('give')
    expect(t.mac.state.people.map((p) => p.id)).toEqual(['a'])
    await t.mac.box.incoming[0].adopt.run()
    expect(t.mac.state.people.map((p) => p.id)).toEqual(['b'])
    expect(t.archived[0]).toMatchObject({ who: 'mac', dev: 'Phone' })
  })

  it('no copy kept: nothing is replaced', async () => {
    const t = await pair(mk('J', [person('a', 'Ada')]), mk('J', [person('b', 'Ben')]), { archive: () => false })
    await t.phone.api.takeFrom(t.macDid)
    await until(() => t.phone.box.incoming.length === 1)
    expect(await t.phone.box.incoming[0].adopt.run()).toBe(false)
    expect(t.phone.state.people.map((p) => p.id)).toEqual(['b'])
  })

  it('review: a want waits for a tap on the asked device; Not now sends nothing, and no hook means no answer', async () => {
    const pending = []
    const t = await pair(mk('J', [person('a', 'Ada')]), mk('J', [person('b', 'Ben')]), { onWant: (name, send) => pending.push({ name, send }) })
    await t.phone.api.takeFrom(t.macDid)
    await until(() => pending.length === 2 || pending.length === 1)
    await new Promise((r) => setTimeout(r, 120))
    expect(t.phone.box.incoming).toHaveLength(0)
    expect(pending.map((x) => x.name)).toEqual(['Phone'])
    await pending[0].send()
    await until(() => t.phone.box.incoming.length === 1)
    expect(t.phone.box.incoming[0].adopt.kind).toBe('take')
    const u = await pair(mk('J', [person('a', 'Ada')]), mk('J', []), { onWant: undefined })
    await u.phone.api.takeFrom(u.macDid)
    await new Promise((r) => setTimeout(r, 150))
    expect(u.phone.box.incoming).toHaveLength(0)
    expect(u.mac.log.some((l) => /asked for this record/.test(l))).toBe(true)
  })

  it('review: the same want delivered twice (relay replay) asks once', async () => {
    const t = await pair(mk('J', [person('a', 'Ada')]), mk('J', []))
    await t.phone.api.takeFrom(t.macDid)
    await until(() => t.phone.box.incoming.length === 1)
    const want = t.h.wires.filter((w) => w.to === t.phoneDid ? false : w.from === t.phoneDid).pop()
    await t.h.sinks.get(want.to)?.(want.from, want.payload)
    await new Promise((r) => setTimeout(r, 120))
    expect(t.wants.filter((w) => w.who === 'mac')).toHaveLength(1)
    expect(t.phone.box.incoming).toHaveLength(1)
  })

  it('a receive-only device does not answer a want; Send my state is refused on it', async () => {
    const t = await pair(mk('J', [person('a', 'Ada')]), mk('J', []), { canSend: () => false })
    await t.phone.api.takeFrom(t.macDid)
    await new Promise((r) => setTimeout(r, 150))
    expect(t.phone.box.incoming).toHaveLength(0)
    await expect(t.phone.api.sendTo(t.macDid)).rejects.toThrow('receive only')
  })

  it('an unflagged record still merges without an adopt offer', async () => {
    const t = await pair(mk('J', [person('a', 'Ada')]), mk('J', []))
    await t.phone.api.syncNow(t.macDid)
    await until(() => t.mac.box.incoming.length === 1)
    expect(t.mac.box.incoming[0].adopt).toBeUndefined()
  })
})
