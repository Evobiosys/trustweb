/**
 * "Without an app" (Jakob, 2026-10-06): someone he granted asks his PERSONAL
 * front door from the TrustWeb web app and gets the lines he allowed in
 * advance, even while his phone is off. End to end on this Mac: the exporter
 * turns a fixture inventory (marked and unmarked lines, as Tana, the review
 * page and the Mac folder would give them) into the server file; the peer
 * runs as the personal instance (PeerPolicy.Granted, grants.json, health on a
 * loopback port) against an in-memory relay; fake phones built from the same
 * apps/demo modules a real phone uses play Jakob (owner) and the askers.
 *
 * Checked: preset lines answered and visibly marked; unmarked lines never
 * (they are not even on the server); a name that was not granted gets no
 * connection; decline, no match, phone off and over the rate limit are the
 * same bytes (fixed-length sealed answer, all-zero plaintext); the log holds
 * no text and no name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request } from 'node:http'
import { PeerPolicy, startPeer } from '../peer.ts'
import { LineSource, MarkKind, assertServerFileSafe, buildExport, parseChoices, parseFolderLine, serverFile } from '../inventory_export.ts'
import { createIdentity, ecdhSharedSecret } from '../../../apps/demo/src/did.ts'
import { createRelayChannel } from '../../../apps/demo/src/relay.ts'
import { deriveEcdhPairKey, fromB64u, open, randomId } from '../../../apps/demo/src/crypto.ts'
import { encodeForQr } from '../../../apps/demo/src/wire.ts'
import { buildConnectAck } from '../../../apps/demo/src/connect_link.ts'
import { interpret } from '../../../apps/demo/src/gate.ts'
import { sealRelayAnswer } from '../../../apps/demo/src/answer_key.ts'

const WINDOW_MS = 150
const FORWARD_WAIT_MS = 1200
const HEALTH_PORT = 8985
const IV_LEN = 12
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 5000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(25)
  }
}
function getLocal(port, p, headers) {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject).end()
  })
}

/** A phone as the wire sees it; `ask` returns the decoded answer AND the raw envelope. */
async function phone(relayOrigin, name, decide) {
  const identity = createIdentity(relayOrigin + '/relay')
  const me = { id: randomId(12), displayName: name }
  const channel = createRelayChannel({ relayOrigin })
  const keys = new Map()
  const key = (did) => {
    let k = keys.get(did)
    if (!k) { k = deriveEcdhPairKey(ecdhSharedSecret(identity, did)); keys.set(did, k) }
    return k
  }
  const awaiting = new Map()
  const asks = []
  channel.onRawWire(() => true)
  channel.onEnvelope(async (fromDid) => key(fromDid), (env, fromDid) => {
    if (env.t === 'answer') { awaiting.get(env.qid)?.(env); return }
    if (env.t !== 'query') return
    asks.push(env)
    void (async () => {
      const items = decide ? await decide(env) : null
      const out = await sealRelayAnswer(env.qid, env.templateId, items ? { from: name, templateId: env.templateId, items } : null, { key: await key(fromDid), blocked: false })
      await channel.send(fromDid, out, await key(fromDid))
    })()
  })
  await channel.connect(identity)
  return {
    did: identity.did,
    asks,
    connectTo: (did) => channel.sendRaw(did, encodeForQr(buildConnectAck(me, identity))),
    ask: async (did, text, timeoutMs = 4000) => {
      const q = { v: 1, t: 'query', from: me, templateId: 'free', templateVersion: 1, qid: randomId(12), issuedAt: Date.now(), freeText: text }
      const answered = new Promise((resolve) => {
        const timer = setTimeout(() => { awaiting.delete(q.qid); resolve(null) }, timeoutMs)
        awaiting.set(q.qid, (env) => { clearTimeout(timer); awaiting.delete(q.qid); resolve(env) })
      })
      await channel.send(did, q, await key(did))
      const env = await answered
      if (!env) return null
      const combined = fromB64u(env.body)
      const plain = await open(await key(did), combined.slice(0, IV_LEN), combined.slice(IV_LEN))
      return { decoded: await interpret(env, await key(did)), bodyLength: combined.length, plain }
    },
    close: () => channel.close(),
  }
}

/** The fixture inventory, from all three sources, through the real exporter logic. */
function exportFixture() {
  const candidates = [
    { text: 'Spare desk in a coworking space, Fridays', source: LineSource.TanaReferenced, category: 'offers', tanaNodeId: 'TANA00000001', mark: { kind: MarkKind.TanaChild, note: 'for people I met' } },
    { text: 'Guest bed for a visiting friend, two nights', source: LineSource.TanaInbox, category: 'inbox', tanaNodeId: 'TANA00000002' },
    { text: 'My therapist and her phone number', source: LineSource.TanaReferenced, category: 'choices', tanaNodeId: 'TANA00000003' },
    ...parseChoices({ items: [
      { candidate: 'Walk', tanaNodeId: 'KIMI00000001', line: 'Introductions to people in regenerative farming', toTana: true, allowInAdvance: true },
      { candidate: 'Walk', tanaNodeId: 'KIMI00000001', line: 'Camping tent for four people', toTana: true, allowInAdvance: false },
    ] }),
    parseFolderLine('+ Projector and screen for a talk, Vienna', 'mac.txt'),
    parseFolderLine('- Spare room key under the doormat', 'mac.txt'),
  ]
  const knownIds = new Set(['TANA00000001', 'TANA00000002', 'TANA00000003', 'KIMI00000001'])
  const opts = { today: '2026-10-06', by: 'Jakob', knownIds }
  const lines = buildExport(candidates, opts)
  const file = serverFile(lines, opts)
  assertServerFileSafe(file, lines, knownIds)
  return file
}

describe('the personal front door, without an app, end to end on this Mac', () => {
  let relay, relayOrigin
  beforeAll(async () => {
    const { RelayServer } = await import('../../../packages/transport/src/relay_server.ts')
    const { InMemoryRelayQueueStore } = await import('../../../packages/transport/src/relay_queue_store.ts')
    relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    const { port } = await relay.listen(0, '127.0.0.1')
    relayOrigin = `http://127.0.0.1:${port}`
  })
  afterAll(async () => { await relay.close() })

  it('the exporter puts ONLY the three marked lines on the server; the unmarked ones are not there at all', () => {
    const f = exportFixture()
    expect(f.items.map((i) => i.text).sort()).toEqual([
      'Introductions to people in regenerative farming',
      'Projector and screen for a talk, Vienna',
      'Spare desk in a coworking space, Fridays',
    ])
    expect(JSON.stringify(f)).not.toMatch(/therapist|Guest bed|doormat|tent|TANA0|KIMI0|did:/)
  })

  it('a granted asker gets the allowed lines (owner deciding, declining, or off); unmarked never; same bytes for every nothing; rate limit', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'twpersonal-'))
    const stateDir = path.join(dir, 'state')
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    writeFileSync(path.join(stateDir, 'grants.json'), JSON.stringify({ names: ['Anna'] }))
    const inv = path.join(dir, 'inventory.json')
    writeFileSync(inv, JSON.stringify(exportFixture()))
    const lines = []
    const peer = await startPeer({
      stateDir, inventoryFile: inv, relayOrigin, name: 'Jakob', policy: PeerPolicy.Granted, healthPort: HEALTH_PORT,
      claim: true, forwardWaitMs: FORWARD_WAIT_MS, answerWindowMs: WINDOW_MS, asksPerHour: 6, log: (l) => lines.push(l),
    })
    try {
      // health and status over loopback, Host checked, Origin refused (the deploy script's checks)
      expect((await getLocal(HEALTH_PORT, '/health', { Host: '127.0.0.1:8985' })).body).toBe('ok')
      expect((await getLocal(HEALTH_PORT, '/status', { Host: 'evil.example.com' })).status).toBe(421)
      expect((await getLocal(HEALTH_PORT, '/status', { Host: '127.0.0.1', Origin: 'https://evil.example.com' })).status).toBe(421)
      const st0 = JSON.parse((await getLocal(HEALTH_PORT, '/status', { Host: '127.0.0.1:8985' })).body)
      expect(st0).toMatchObject({ owner: false, claimOpen: true, presetLines: 3, heldLines: 0, peers: 0 })

      // Jakob claims with his normal persona; his phone declines everything forwarded
      const jakob = await phone(relayOrigin, 'Jakob', () => null)
      await jakob.connectTo(peer.card.did)
      await until(() => peer.status().owner)
      // someone not granted: no connection, and an ask from them is never answered
      const mallory = await phone(relayOrigin, 'Mallory', null)
      await mallory.connectTo(peer.card.did)
      await until(() => lines.some((l) => /refused \(not granted\)/.test(l)))
      expect(peer.peerCount()).toBe(0)
      expect(await mallory.ask(peer.card.did, 'spare desk on fridays', 1500)).toBeNull()
      // Anna, granted (names compare case-insensitively)
      const anna = await phone(relayOrigin, 'anna', null)
      await anna.connectTo(peer.card.did)
      await until(() => peer.peerCount() === 1)

      // 1. an allowed line, owner on and declining: the preset still answers, visibly marked
      const a1 = await anna.ask(peer.card.did, 'is there a spare desk in a coworking space on fridays')
      expect(a1.decoded.outcome).toBe('shared')
      expect(a1.decoded.shared.from).toBe('Jakob')
      expect(a1.decoded.shared.items).toEqual([expect.objectContaining({ text: 'Spare desk in a coworking space, Fridays', context: 'Allowed in advance by Jakob (2026-10-06): for people I met' })])
      expect(jakob.asks).toHaveLength(1)
      expect(jakob.asks[0]).toMatchObject({ relayed: true, freeText: 'anna: is there a spare desk in a coworking space on fridays' })
      // 2. an unmarked line, owner declines: nothing
      const a2 = await anna.ask(peer.card.did, 'guest bed for a visiting friend two nights')
      expect(a2.decoded.outcome).toBe('nothing')
      // 3. no match at all: nothing
      const a3 = await anna.ask(peer.card.did, 'helicopter rides over the alps')
      expect(a3.decoded.outcome).toBe('nothing')
      // 4. Jakob's phone off: the allowed line still answers; an unmarked line yields nothing
      jakob.close()
      const t0 = Date.now()
      const a4 = await anna.ask(peer.card.did, 'introductions to people in regenerative farming')
      expect(Date.now() - t0).toBeGreaterThanOrEqual(FORWARD_WAIT_MS)
      expect(a4.decoded.outcome).toBe('shared')
      expect(a4.decoded.shared.items.map((i) => i.text)).toEqual(['Introductions to people in regenerative farming'])
      expect(a4.decoded.shared.items[0].context).toBe('Allowed in advance by Jakob (2026-10-06)')
      const a5 = await anna.ask(peer.card.did, 'my therapist phone number')
      expect(a5.decoded.outcome).toBe('nothing')
      // 5. the sixth ask in the hour still answers, the seventh is over the limit: nothing
      const a6 = await anna.ask(peer.card.did, 'projector and screen for a talk in vienna')
      expect(a6.decoded.outcome).toBe('shared')
      const a7 = await anna.ask(peer.card.did, 'projector and screen for a talk in vienna')
      expect(a7.decoded.outcome).toBe('nothing')
      expect(lines.some((l) => /ask rate-limited/.test(l))).toBe(true)

      // every answer has the same length; every "nothing" is the same plaintext (all zero)
      const all = [a1, a2, a3, a4, a5, a6, a7]
      expect(new Set(all.map((a) => a.bodyLength)).size).toBe(1)
      const nothings = [a2, a3, a5, a7].map((a) => Buffer.from(a.plain).toString('hex'))
      expect(new Set(nothings).size).toBe(1)
      expect(a2.plain.every((b) => b === 0)).toBe(true)

      // the log: counts and outcomes only
      const log = lines.join('\n')
      expect(log).not.toMatch(/desk|guest|therapist|farming|projector|helicopter|anna|mallory/i)
      expect(log).not.toContain(jakob.did)
      expect(log).not.toContain(anna.did)
      anna.close(); mallory.close()
    } finally {
      await peer.stop()
      rmSync(dir, { recursive: true })
    }
  }, 60_000)

  /** A Granted peer on a fresh state dir; Jakob claims it with a phone that declines everything. */
  async function grantedPeer(names, extra = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'twpersonal-'))
    const stateDir = path.join(dir, 'state')
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    const writeGrants = (n) => writeFileSync(path.join(stateDir, 'grants.json'), JSON.stringify({ names: n }))
    writeGrants(names)
    const inv = path.join(dir, 'inventory.json')
    writeFileSync(inv, JSON.stringify(exportFixture()))
    const lines = []
    const peer = await startPeer({
      stateDir, inventoryFile: inv, relayOrigin, name: 'Jakob', policy: PeerPolicy.Granted, healthPort: 0,
      claim: true, forwardWaitMs: FORWARD_WAIT_MS, answerWindowMs: WINDOW_MS, log: (l) => lines.push(l), ...extra,
    })
    const jakob = await phone(relayOrigin, 'Jakob', () => null)
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    return { dir, stateDir, inv, peer, jakob, lines, writeGrants, cleanup: async () => { await peer.stop(); rmSync(dir, { recursive: true }) } }
  }
  /** Time from sending an ask to its answer arriving. */
  async function timedAsk(p, did, text) {
    const t0 = Date.now()
    const a = await p.ask(did, text, FORWARD_WAIT_MS * 3)
    return { a, ms: Date.now() - t0 }
  }

  it('timing: decline, no match, over the rate limit and phone off all answer at the same instant (the forward deadline)', async () => {
    const g = await grantedPeer(['Anna', 'Ben'], { asksPerHour: 2 })
    try {
      const anna = await phone(relayOrigin, 'Anna', null)
      await anna.connectTo(g.peer.card.did)
      await until(() => g.peer.peerCount() === 1)
      // owner online: he declines at once / nothing matches / over the limit (never forwarded)
      const decline = await timedAsk(anna, g.peer.card.did, 'guest bed for a visiting friend two nights')
      const nomatch = await timedAsk(anna, g.peer.card.did, 'helicopter rides over the alps')
      const limited = await timedAsk(anna, g.peer.card.did, 'helicopter rides over the alps again')
      expect(g.jakob.asks).toHaveLength(2)
      // a preset line that answers while the owner declines the live part
      const ben = await phone(relayOrigin, 'Ben', null)
      await ben.connectTo(g.peer.card.did)
      await until(() => g.peer.peerCount() === 2)
      const preset = await timedAsk(ben, g.peer.card.did, 'is there a spare desk in a coworking space on fridays')
      expect(preset.a.decoded.outcome).toBe('shared')
      // owner off
      g.jakob.close()
      const off = await timedAsk(ben, g.peer.card.did, 'helicopter rides over the alps')
      const all = [decline, nomatch, limited, preset, off]
      for (const x of [decline, nomatch, limited, off]) expect(x.a.decoded.outcome).toBe('nothing')
      const times = all.map((x) => x.ms)
      expect(Math.min(...times)).toBeGreaterThanOrEqual(FORWARD_WAIT_MS)
      expect(Math.max(...times) - Math.min(...times)).toBeLessThan(400)
      anna.close(); ben.close()
    } finally {
      await g.cleanup()
    }
  }, 60_000)

  it('the owner live-sharing answers at once (the content already says so); a self-ask is never forwarded and answers at the window', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'twpersonal-'))
    const stateDir = path.join(dir, 'state')
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    writeFileSync(path.join(stateDir, 'grants.json'), JSON.stringify({ names: ['Anna'] }))
    const inv = path.join(dir, 'inventory.json')
    writeFileSync(inv, JSON.stringify({ items: [] }))
    const peer = await startPeer({
      stateDir, inventoryFile: inv, relayOrigin, name: 'Jakob', policy: PeerPolicy.Granted, healthPort: 0,
      claim: true, forwardWaitMs: FORWARD_WAIT_MS, answerWindowMs: WINDOW_MS, log: () => {},
    })
    try {
      const jakob = await phone(relayOrigin, 'Jakob', () => [{ text: 'I can lend you my drill', when: 'this week' }])
      await jakob.connectTo(peer.card.did)
      await until(() => peer.status().owner)
      const anna = await phone(relayOrigin, 'Anna', null)
      await anna.connectTo(peer.card.did)
      await until(() => peer.peerCount() === 1)
      const shared = await timedAsk(anna, peer.card.did, 'does anyone have a drill')
      expect(shared.a.decoded.outcome).toBe('shared')
      expect(shared.ms).toBeLessThan(FORWARD_WAIT_MS)
      const self = await timedAsk(jakob, peer.card.did, 'does anyone have a drill')
      expect(self.a.decoded.outcome).toBe('nothing')
      expect(self.ms).toBeLessThan(FORWARD_WAIT_MS)
      expect(jakob.asks).toHaveLength(1)
      anna.close(); jakob.close()
    } finally {
      await peer.stop()
      rmSync(dir, { recursive: true })
    }
  }, 60_000)

  it('grants: --remove revokes a connected person at the next reload; a granted name binds one phone; names normalise like the grant script', async () => {
    const g = await grantedPeer(['Anna', 'Ben  Bauer'])
    try {
      const anna = await phone(relayOrigin, 'Anna', null)
      await anna.connectTo(g.peer.card.did)
      await until(() => g.peer.peerCount() === 1)
      // a second phone sending the same granted name is refused while Anna's phone holds it
      const impostor = await phone(relayOrigin, 'anna', null)
      await impostor.connectTo(g.peer.card.did)
      await until(() => g.lines.some((l) => /refused \(name already bound\)/.test(l)))
      expect(g.peer.peerCount()).toBe(1)
      expect(await impostor.ask(g.peer.card.did, 'spare desk on fridays', 1500)).toBeNull()
      // whitespace and Unicode normalisation: "Ben Bauer" (script form) matches "ben  bauer"
      const ben = await phone(relayOrigin, ' ben  bauer ', null)
      await ben.connectTo(g.peer.card.did)
      await until(() => g.peer.peerCount() === 2)
      // Jakob removes Anna: after the reload she gets no answer at all and is forgotten
      g.writeGrants(['Ben Bauer'])
      process.emit('SIGHUP')
      await until(() => g.peer.peerCount() === 1)
      expect(await anna.ask(g.peer.card.did, 'is there a spare desk in a coworking space on fridays', 1500)).toBeNull()
      const b = await ben.ask(g.peer.card.did, 'is there a spare desk in a coworking space on fridays', FORWARD_WAIT_MS * 3)
      expect(b.decoded.outcome).toBe('shared')
      expect(g.lines.join('\n')).not.toMatch(/anna|ben|bauer/i)
      anna.close(); impostor.close(); ben.close()
    } finally {
      await g.cleanup()
    }
  }, 60_000)

  it('a malformed inventory or grants file never puts its content into the log', async () => {
    const g = await grantedPeer(['Anna'])
    try {
      writeFileSync(g.inv, 'my therapist Dr Secret, phone 0664')
      process.emit('SIGHUP')
      await until(() => g.lines.some((l) => /reload failed/.test(l)))
      writeFileSync(g.inv, JSON.stringify(exportFixture()))
      g.writeGrants(['Anna'])
      writeFileSync(path.join(g.stateDir, 'grants.json'), 'Anna Secretname, Ben')
      process.emit('SIGHUP')
      await until(() => g.lines.filter((l) => /reload failed/.test(l)).length === 2)
      expect(g.lines.join('\n')).not.toMatch(/therapist|Secret|Anna|0664/)
      expect(g.peer.status().presetLines).toBe(3)
    } finally {
      await g.cleanup()
    }
  }, 60_000)
})
