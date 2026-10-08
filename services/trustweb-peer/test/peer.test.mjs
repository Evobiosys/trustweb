/**
 * trustweb-peer tests. The parts that need no relay: inventory loading (a
 * line without a preset is held, never matchable), the grant list, the
 * per-asker rate limit. Then the whole peer against an in-memory RelayServer
 * with two fake phones built from the same apps/demo modules a real phone
 * uses: the OWNER's phone (claims the peer, receives forwarded asks, decides)
 * and an ASKER's phone (opens the link, asks, reads the sealed answer).
 *
 * The rule under test, the owner's (2026-10-06): "not the server answers
 * asks, I do". A line goes out only when the owner said yes live (forwarded
 * ask) or in advance (preset, visibly marked). Nothing else answers.
 *
 * Run from the repo root (tsx and vitest come with the workspace):
 *   apps/demo/node_modules/.bin/vitest run --config services/trustweb-peer/test/vitest.config.mjs --root services/trustweb-peer
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request } from 'node:http'
import { AskRateLimit, INVENTORY_LINE_MAX, PeerPolicy, fitsAnswer, forwardedText, loadGrants, loadInventory, parsePreset, presetContext, startPeer } from '../peer.ts'
import { seenHash } from '../../../apps/trustweb/src/hops.ts'
import { createIdentity, ecdhSharedSecret } from '../../../apps/demo/src/did.ts'
import { createRelayChannel } from '../../../apps/demo/src/relay.ts'
import { deriveEcdhPairKey, randomId } from '../../../apps/demo/src/crypto.ts'
import { decodeFromQr, encodeForQr } from '../../../apps/demo/src/wire.ts'
import { buildConnectAck } from '../../../apps/demo/src/connect_link.ts'
import { interpret } from '../../../apps/demo/src/gate.ts'
import { sealRelayAnswer } from '../../../apps/demo/src/answer_key.ts'

const HOUR = 3_600_000
const WINDOW_MS = 150

function tmp() { return mkdtempSync(path.join(tmpdir(), 'twpeer-')) }
/** fetch() silently drops a Host header, so the local-service checks go through node:http. */
function statusWith(port, headers) {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/health', headers }, (res) => { res.resume(); resolve(res.statusCode) }).on('error', reject).end()
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 5000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(25)
  }
}

/**
 * A phone, as far as the wire can tell: identity, relay channel, pair keys.
 * `decide(ask)` is what the person at it does with an incoming ask; it
 * returns the SharedPayload items to share, or null for decline / no match.
 */
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
    /** The scanning side of the one-scan ceremony: tell the peer who we are. */
    connectTo: (did) => channel.sendRaw(did, encodeForQr(buildConnectAck(me, identity))),
    /** Ask one peer; resolves with the decoded answer or null on timeout. */
    ask: async (did, text, timeoutMs = 4000, extra = {}) => {
      const q = { v: 1, t: 'query', from: me, templateId: 'free', templateVersion: 1, qid: randomId(12), issuedAt: Date.now(), freeText: text, ...extra }
      const answered = new Promise((resolve) => {
        const timer = setTimeout(() => { awaiting.delete(q.qid); resolve(null) }, timeoutMs)
        awaiting.set(q.qid, (env) => { clearTimeout(timer); awaiting.delete(q.qid); resolve(env) })
      })
      await channel.send(did, q, await key(did))
      const env = await answered
      return env ? interpret(env, await key(did)) : null
    },
    close: () => channel.close(),
  }
}

describe('loadInventory', () => {
  it('keeps only lines with a well-formed preset; holds the rest; skips malformed lines', () => {
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    writeFileSync(f, JSON.stringify({ items: [
      { text: 'Motorbike, can lend', audience: 'fof', preset: { by: 'Jakob', at: '2026-10-06', note: 'demo' } },
      { text: 'Projector', audience: 'fof' },
      { text: 'Tent', audience: 'fof', preset: { by: '', at: '2026-10-06' } },
      { text: 'Desk', audience: 'fof', preset: { by: 'Jakob', at: 'yesterday-ish' } },
      { text: '', audience: 'fof', preset: { by: 'Jakob', at: '2026-10-06' } },
      { text: 'Secret', audience: 'everyone', preset: { by: 'Jakob', at: '2026-10-06' } },
      { text: 'Guest bed', audience: 'friends', preset: { by: 'Jakob', at: '2026-10-06T10:00:00Z' } },
      'junk',
    ] }))
    const inv = loadInventory(f, 1000)
    expect(inv.preset.map((l) => l.item.text)).toEqual(['Motorbike, can lend', 'Guest bed'])
    expect(inv.held).toBe(3)
    expect(inv.preset.every((l) => l.item.included && l.item.createdAt === 1000 && l.item.id.length === 8)).toBe(true)
    expect(inv.preset[0].preset).toEqual({ by: 'Jakob', at: '2026-10-06', note: 'demo' })
    rmSync(dir, { recursive: true })
  })
  it('is empty when the file has no items array', () => {
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    writeFileSync(f, '{"nope":1}')
    expect(loadInventory(f, 1)).toEqual({ preset: [], held: 0 })
    rmSync(dir, { recursive: true })
  })
  it('the shipped demo inventory is exactly the owner\'s ten public lines, every one with its preset and none held (wave 5)', () => {
    const inv = loadInventory(path.join(import.meta.dirname, '..', 'demo_inventory.json'), 1)
    expect(inv.preset.length).toBe(10)
    expect(inv.held).toBe(0)
    expect(inv.preset.every((l) => l.preset.at === '2026-10-07' && l.preset.by === 'Jakob' && l.preset.note === 'demo content')).toBe(true)
    // the two lines the old 160-character bound kept out (171 and 194 characters) are served in full
    expect(inv.preset.filter((l) => l.item.text.length > 160).map((l) => l.item.text.length)).toEqual([194, 171])
  })
  it('the line bound is 300 characters: a line AT the bound loads intact, one character more is held, never cut', () => {
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    const preset = { by: 'Jakob', at: '2026-10-07', note: 'demo content' }
    expect(INVENTORY_LINE_MAX).toBe(300)
    const atBound = 'a'.repeat(INVENTORY_LINE_MAX)
    writeFileSync(f, JSON.stringify({ items: [
      { text: atBound, audience: 'fof', preset },
      { text: atBound + 'b', audience: 'fof', preset },
      { text: ' ' + atBound + ' ', audience: 'fof', preset },
    ] }))
    const inv = loadInventory(f, 1)
    expect(inv.preset.map((l) => l.item.text.length)).toEqual([300, 300])
    expect(inv.preset[0].item.text).toBe(atBound)
    expect(inv.held).toBe(1)
    rmSync(dir, { recursive: true })
  })
  it('a line at the bound still fits the one 512-byte answer block, and a line whose own preset context is too long for it is held', () => {
    const standard = { by: 'Jakob', at: '2026-10-07', note: 'demo content' }
    expect(fitsAnswer('a'.repeat(INVENTORY_LINE_MAX), standard)).toBe(true)
    // the same text with a 120-character note in its preset no longer fits: held rather than sent as an empty answer
    const heavy = { by: 'Jakob', at: '2026-10-07', note: 'n'.repeat(120) }
    expect(fitsAnswer('a'.repeat(INVENTORY_LINE_MAX), heavy)).toBe(false)
    expect(fitsAnswer('a'.repeat(150), heavy)).toBe(true)
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    writeFileSync(f, JSON.stringify({ items: [{ text: 'a'.repeat(INVENTORY_LINE_MAX), audience: 'fof', preset: heavy }, { text: 'short line', audience: 'fof', preset: heavy }] }))
    const inv = loadInventory(f, 1)
    expect(inv.preset.map((l) => l.item.text)).toEqual(['short line'])
    expect(inv.held).toBe(1)
    rmSync(dir, { recursive: true })
  })
  it('a 400-character line would have been dropped from its answer whole (the reason the bound is 300, not 400)', () => {
    expect(fitsAnswer('a'.repeat(400), { by: 'Jakob', at: '2026-10-07', note: 'demo content' })).toBe(false)
  })
})

describe('parsePreset / presetContext', () => {
  it('needs by and a parseable at; bounds the note; renders the visible mark', () => {
    expect(parsePreset(null)).toBeNull()
    expect(parsePreset({ by: 'Jakob' })).toBeNull()
    expect(parsePreset({ by: 'Jakob', at: '2026-10-06', note: 'x'.repeat(200) }).note.length).toBe(120)
    expect(presetContext({ by: 'Jakob', at: '2026-10-06T09:00:00Z' })).toBe('Allowed in advance by Jakob (2026-10-06)')
    expect(presetContext({ by: 'Jakob', at: '2026-10-06', note: 'demo content' })).toBe('Allowed in advance by Jakob (2026-10-06): demo content')
  })
})

describe('forwardedText', () => {
  it('names the asker first and stays within the free-text bound', () => {
    expect(forwardedText('Anna-demo', 'motorbike?')).toBe('Anna-demo: motorbike?')
    expect(forwardedText('Anna-demo', 'x'.repeat(300)).length).toBe(200)
  })
})

describe('loadGrants', () => {
  it('is empty without a grants file, lower-cases names otherwise', () => {
    const dir = tmp()
    expect(loadGrants(dir).size).toBe(0)
    writeFileSync(path.join(dir, 'grants.json'), JSON.stringify({ names: ['Anna-demo', 7, 'BEN-demo'] }))
    expect([...loadGrants(dir)]).toEqual(['anna-demo', 'ben-demo'])
    rmSync(dir, { recursive: true })
  })
})

describe('AskRateLimit', () => {
  it('allows N per hour per asker, then refuses until the window slides', () => {
    const l = new AskRateLimit(2)
    expect(l.allow('a', 0)).toBe(true)
    expect(l.allow('a', 10)).toBe(true)
    expect(l.allow('a', 20)).toBe(false)
    expect(l.allow('b', 20)).toBe(true)
    expect(l.allow('a', HOUR + 5)).toBe(true)
  })
})

describe('the peer against an in-memory relay', () => {
  let relay, relayOrigin
  beforeAll(async () => {
    const { RelayServer } = await import('../../../packages/transport/src/relay_server.ts')
    const { InMemoryRelayQueueStore } = await import('../../../packages/transport/src/relay_queue_store.ts')
    relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    const { port } = await relay.listen(0, '127.0.0.1')
    relayOrigin = `http://127.0.0.1:${port}`
  })
  afterAll(async () => { await relay.close() })

  function inventoryFile(dir, items) {
    const f = path.join(dir, 'inv.json')
    writeFileSync(f, JSON.stringify({ items }))
    return f
  }
  const PRESET = { by: 'Jakob', at: '2026-10-06', note: 'demo content' }

  it('the live rename: a state dir that already has an identity and an owner takes the configured name (Jakob), keeps its DID, card id and owner', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Loudspeakers', audience: 'fof', preset: PRESET }])
    const stateDir = path.join(dir, 'state')
    const old = await startPeer({ stateDir, inventoryFile: inv, relayOrigin, name: 'Demo inventory', healthPort: 0, claim: true, answerWindowMs: WINDOW_MS, log: () => {} })
    const owner = await phone(relayOrigin, 'Jakob', () => [])
    await owner.connectTo(old.card.did)
    await until(() => old.status().owner)
    expect(old.card.name).toBe('Demo inventory')
    await old.stop()
    // the redeploy: same state dir, the unit now says TW_PEER_NAME=Jakob (or nothing: the default is Jakob)
    const renamed = await startPeer({ stateDir, inventoryFile: inv, relayOrigin, name: 'Jakob', healthPort: 0, answerWindowMs: WINDOW_MS, log: () => {} })
    expect(renamed.card.name).toBe('Jakob')
    expect(renamed.card.did).toBe(old.card.did)
    expect(renamed.card.id).toBe(old.card.id)
    expect(renamed.status().owner).toBe(true)
    expect(JSON.parse(readFileSync(path.join(stateDir, 'demo-peer.json'), 'utf8')).name).toBe('Jakob')
    await renamed.stop()
    const byDefault = await startPeer({ stateDir, inventoryFile: inv, relayOrigin, healthPort: 0, answerWindowMs: WINDOW_MS, log: () => {} })
    expect(byDefault.card.name).toBe('Jakob')
    expect(byDefault.card.did).toBe(old.card.did)
    await byDefault.stop()
    owner.close()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('comes up, writes its card, keeps its identity across restarts, serves health on loopback only', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Motorbike, can lend', audience: 'fof', preset: PRESET }, { text: 'Projector', audience: 'fof' }])
    const lines = []
    const opts = { stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, name: 'Demo inventory', policy: PeerPolicy.Open, healthPort: 0, log: (l) => lines.push(l) }
    const p1 = await startPeer({ ...opts, healthPort: 18961 })
    expect(p1.card.did.startsWith('did:peer:2')).toBe(true)
    expect(p1.card.name).toBe('Demo inventory')
    const card = JSON.parse(readFileSync(path.join(dir, 'state', 'demo-peer.json'), 'utf8'))
    expect(card).toEqual(p1.card)
    expect(await (await fetch('http://127.0.0.1:18961/health')).text()).toBe('ok')
    expect((await fetch('http://127.0.0.1:18961/card')).status).toBe(200)
    const st = await (await fetch('http://127.0.0.1:18961/status')).json()
    expect(st).toMatchObject({ peers: 0, owner: false, forward: false, claimOpen: false, presetLines: 1, heldLines: 1 })
    expect(await statusWith(18961, { Host: 'evil.example.com' })).toBe(421)
    expect(await statusWith(18961, { Origin: 'https://evil.example.com' })).toBe(421)
    expect(await statusWith(18961, {})).toBe(200)
    await until(() => p1.status().relay === 'connected')
    await p1.stop()
    const p2 = await startPeer(opts)
    expect(p2.card.did).toBe(p1.card.did)
    expect(p2.card.id).toBe(p1.card.id)
    await p2.stop()
    expect(lines.some((l) => /up with 1 preset lines \(1 held, never shared\), policy open/.test(l))).toBe(true)
    expect(lines.join('\n')).not.toMatch(/Motorbike|Projector/)
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('the shipped demo inventory serves a line beyond the old 160-character bound in full, verbatim, marked as allowed in advance', async () => {
    const dir = tmp()
    const shipped = path.join(import.meta.dirname, '..', 'demo_inventory.json')
    const long = JSON.parse(readFileSync(shipped, 'utf8')).items.find((i) => i.text.length === 194)
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: shipped, relayOrigin, healthPort: 0, answerWindowMs: WINDOW_MS, log: () => {} })
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const a1 = await anna.ask(peer.card.did, 'which open-source license do you find the perfect one')
    expect(a1.outcome).toBe('shared')
    expect(a1.shared.from).toBe('Jakob')
    expect(a1.shared.items.map((i) => i.text)).toContain(long.text)
    expect(a1.shared.items.find((i) => i.text === long.text).context).toBe('Allowed in advance by Jakob (2026-10-07): demo content')
    anna.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('without an owner: shares only preset lines, visibly marked; a held line never goes out', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [
      { text: 'Loudspeakers', audience: 'fof', preset: PRESET },
      { text: 'Projector and screen for a talk', audience: 'fof' },
    ])
    const lines = []
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, answerWindowMs: WINDOW_MS, log: (l) => lines.push(l) })
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const t0 = Date.now()
    const a1 = await anna.ask(peer.card.did, 'can someone lend me loudspeakers for the weekend')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(WINDOW_MS)
    expect(a1.outcome).toBe('shared')
    expect(a1.shared.from).toBe('Jakob')
    expect(a1.shared.items).toHaveLength(1)
    expect(a1.shared.items[0].text).toBe('Loudspeakers')
    expect(a1.shared.items[0].context).toBe('Allowed in advance by Jakob (2026-10-06): demo content')
    const a2 = await anna.ask(peer.card.did, 'does anyone have a projector and screen for a talk')
    expect(a2.outcome).toBe('nothing')
    expect(lines.some((l) => /ask shared \(1\): preset=1 owner=not-asked/.test(l))).toBe(true)
    expect(lines.some((l) => /ask no-match \(0\): preset=0 owner=not-asked/.test(l))).toBe(true)
    expect(lines.join('\n')).not.toMatch(/loudspeaker|projector|Anna/i)
    anna.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('claim: the first phone in the window becomes the owner, the window closes, later phones are askers', async () => {
    const dir = tmp()
    const stateDir = path.join(dir, 'state')
    const inv = inventoryFile(dir, [])
    const lines = []
    const peer = await startPeer({ stateDir, inventoryFile: inv, relayOrigin, healthPort: 18962, claim: true, answerWindowMs: WINDOW_MS, log: (l) => lines.push(l) })
    expect(peer.status().claimOpen).toBe(true)
    const jakob = await phone(relayOrigin, 'Jakob', null)
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    expect(peer.status()).toMatchObject({ owner: true, forward: true, claimOpen: false, peers: 0 })
    expect(existsSync(path.join(stateDir, 'claim-open'))).toBe(false)
    const ben = await phone(relayOrigin, 'Ben-demo', null)
    await ben.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    expect(peer.status().owner).toBe(true)
    // the owner's DID is in the state file (0600) and nowhere in the log
    expect(readFileSync(path.join(stateDir, 'state.json'), 'utf8')).toContain(jakob.did)
    expect(lines.join('\n')).not.toContain(jakob.did)
    expect(lines.some((l) => /owner bound; claim window closed/.test(l))).toBe(true)
    await peer.stop()
    // the claim-open FILE opens the window too, and only while no owner is bound
    writeFileSync(path.join(stateDir, 'claim-open'), '')
    const again = await startPeer({ stateDir, inventoryFile: inv, relayOrigin, healthPort: 0, answerWindowMs: WINDOW_MS, log: (l) => lines.push(l) })
    expect(again.status().owner).toBe(true)
    expect(again.status().claimOpen).toBe(false)
    await again.stop()
    jakob.close(); ben.close()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('with an owner: the ask is forwarded to the owner\'s phone; the owner\'s yes is relayed, a no is nothing, offline is nothing', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Camping tent for four', audience: 'fof', preset: PRESET }])
    const lines = []
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, claim: true, answerWindowMs: WINDOW_MS, forwardWaitMs: 1500, log: (l) => lines.push(l) })
    let decision = (q) => [{ text: 'Projector and screen, Vienna', when: 'early October', context: 'What I have' }]
    const jakob = await phone(relayOrigin, 'Jakob', (q) => decision(q))
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)

    // 1. the owner says yes: the asker gets what the OWNER's phone shared, from the peer
    const a1 = await anna.ask(peer.card.did, 'anyone with a projector for a talk')
    expect(jakob.asks).toHaveLength(1)
    expect(jakob.asks[0]).toMatchObject({ t: 'query', relayed: true, freeText: 'Anna-demo: anyone with a projector for a talk' })
    expect(jakob.asks[0].from.displayName).toBe('Jakob')
    expect(a1.outcome).toBe('shared')
    expect(a1.shared.items).toEqual([{ text: 'Projector and screen, Vienna', when: 'early October', context: 'What I have' }])
    expect(lines.some((l) => /ask shared \(1\): preset=0 owner=shared\(1\)/.test(l))).toBe(true)

    // 2. the owner says no (or has nothing): nothing, the same bytes as a no-match
    decision = () => null
    const a2 = await anna.ask(peer.card.did, 'anyone with a projector for a talk, second try')
    expect(jakob.asks).toHaveLength(2)
    expect(a2.outcome).toBe('nothing')
    expect(lines.some((l) => /ask no-match \(0\): preset=0 owner=nothing/.test(l))).toBe(true)

    // 3. a preset line AND the owner's yes: both, owner first, at most three
    decision = () => [{ text: 'A second tent', when: 'early October', context: 'What I have' }]
    const a3 = await anna.ask(peer.card.did, 'camping tent for four people')
    expect(a3.outcome).toBe('shared')
    expect(a3.shared.items.map((i) => i.text)).toEqual(['A second tent', 'Camping tent for four'])
    expect(a3.shared.items[1].context).toBe('Allowed in advance by Jakob (2026-10-06): demo content')

    // 4. the owner's phone is off: after forwardWaitMs the asker gets the preset hits only
    jakob.close()
    const t0 = Date.now()
    const a4 = await anna.ask(peer.card.did, 'camping tent for four people again')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500)
    expect(a4.outcome).toBe('shared')
    expect(a4.shared.items.map((i) => i.text)).toEqual(['Camping tent for four'])
    expect(lines.some((l) => /ask shared \(1\): preset=1 owner=timeout/.test(l))).toBe(true)
    const a5 = await anna.ask(peer.card.did, 'anyone with a projector, phone off')
    expect(a5.outcome).toBe('nothing')
    expect(lines.some((l) => /ask no-match \(0\): preset=0 owner=timeout/.test(l))).toBe(true)

    expect(lines.join('\n')).not.toMatch(/projector|tent|Anna/i)
    anna.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 40_000)

  it('the owner asking his own front door gets preset lines only and is never forwarded to himself', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Camping tent for four', audience: 'fof', preset: PRESET }])
    const lines = []
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, claim: true, answerWindowMs: WINDOW_MS, forwardWaitMs: 500, log: (l) => lines.push(l) })
    const jakob = await phone(relayOrigin, 'Jakob', () => { throw new Error('must not be asked') })
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    const a = await jakob.ask(peer.card.did, 'camping tent for four')
    expect(a.outcome).toBe('shared')
    expect(jakob.asks).toHaveLength(0)
    expect(lines.some((l) => /ask shared \(1\): preset=1 owner=not-asked/.test(l))).toBe(true)
    jakob.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('an ask for direct contacts only (direct: true) is never forwarded to the owner: preset lines only (wave 3)', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Camping tent for four', audience: 'fof', preset: PRESET }])
    const lines = []
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, claim: true, answerWindowMs: WINDOW_MS, forwardWaitMs: 1500, log: (l) => lines.push(l) })
    const jakob = await phone(relayOrigin, 'Jakob', () => { throw new Error('must not be asked') })
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const a = await anna.ask(peer.card.did, 'camping tent for four', 4000, { direct: true })
    expect(a.outcome).toBe('shared')
    expect(a.shared.items.map((i) => i.text)).toEqual(['Camping tent for four'])
    const b = await anna.ask(peer.card.did, 'anyone with a projector for a talk', 4000, { direct: true })
    expect(b.outcome).toBe('nothing')
    expect(jakob.asks).toHaveLength(0)
    expect(lines.some((l) => /ask shared \(1\): preset=1 owner=not-asked/.test(l))).toBe(true)
    expect(lines.some((l) => /ask no-match \(0\): preset=0 owner=not-asked/.test(l))).toBe(true)
    jakob.close(); anna.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('forward off: a bound owner is left alone, preset lines still answer', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Camping tent for four', audience: 'fof', preset: PRESET }])
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, claim: true, forward: false, answerWindowMs: WINDOW_MS })
    const jakob = await phone(relayOrigin, 'Jakob', () => { throw new Error('must not be asked') })
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    expect(peer.status().forward).toBe(false)
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const a = await anna.ask(peer.card.did, 'camping tent for four')
    expect(a.outcome).toBe('shared')
    expect(jakob.asks).toHaveLength(0)
    jakob.close(); anna.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('granted policy: only a granted name connects; the claim still binds the owner first', async () => {
    const dir = tmp()
    const stateDir = path.join(dir, 'state')
    const inv = inventoryFile(dir, [])
    const lines = []
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(path.join(stateDir, 'grants.json'), JSON.stringify({ names: ['anna-demo'] }))
    const peer = await startPeer({ stateDir, inventoryFile: inv, relayOrigin, healthPort: 0, policy: PeerPolicy.Granted, claim: true, answerWindowMs: WINDOW_MS, log: (l) => lines.push(l) })
    const jakob = await phone(relayOrigin, 'Jakob', null)
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    const ben = await phone(relayOrigin, 'Ben-demo', null)
    await ben.connectTo(peer.card.did)
    await until(() => lines.some((l) => /refused \(not granted\)/.test(l)))
    expect(peer.peerCount()).toBe(0)
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    jakob.close(); ben.close(); anna.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  // ----- wave 6 (U1): hops at the front door (apps/trustweb/src/hops.ts) -----
  it('wave 6: a travelling ask goes to the owner at the same step (door), the asker named in via; what came back through the owner keeps its "through"', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Camping tent for four', audience: 'fof', preset: PRESET }])
    const lines = []
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, claim: true, answerWindowMs: WINDOW_MS, forwardWaitMs: 600, log: (l) => lines.push(l) })
    let decision = () => [{ text: 'Ladder, 3 m', when: 'early October', context: 'What I have', via: ['Jakob'] }]
    const jakob = await phone(relayOrigin, 'Jakob', (q) => decision(q))
    await jakob.connectTo(peer.card.did)
    await until(() => peer.status().owner)
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const root = 'rootABC123'
    const t0 = Date.now()
    const a = await anna.ask(peer.card.did, 'who has a ladder', 6000, { maxHops: 2, hop: 0, root, seen: [await seenHash(root, 'anna')] })
    // the owner shared live, so the door answers early (as before: the content says so anyway), never before one window
    expect(Date.now() - t0).toBeGreaterThanOrEqual(WINDOW_MS - 30)
    const fwd = jakob.asks.at(-1)
    expect(fwd).toMatchObject({ door: true, relayed: true, hop: 0, maxHops: 2, root, via: ['Anna-demo'], freeText: 'who has a ladder' })
    expect(fwd.seen.length).toBe(3)
    expect(a.outcome).toBe('shared')
    expect(a.shared.items).toEqual([{ text: 'Ladder, 3 m', when: 'early October', context: 'What I have', via: ['Jakob'] }])
    // the owner has nothing: the door answers at its fixed moment, its wait for the owner plus one window for the further step
    decision = () => null
    const t1 = Date.now()
    const b = await anna.ask(peer.card.did, 'who has a ladder, again', 6000, { maxHops: 2, hop: 0, root: 'rootDEF456', seen: [] })
    expect(b.outcome).toBe('nothing')
    expect(Date.now() - t1).toBeGreaterThanOrEqual(600 + WINDOW_MS - 30)
    // U7: the same ask by a second path (a repeat) answers nothing at the moment a forwarded one would, never earlier
    const t2 = Date.now()
    const c = await anna.ask(peer.card.did, 'who has a ladder', 6000, { maxHops: 2, hop: 0, root, seen: [] })
    expect(c.outcome).toBe('nothing')
    expect(Date.now() - t2).toBeGreaterThanOrEqual(600 + WINDOW_MS - 30)
    expect(lines.join('\n')).not.toMatch(/ladder|Anna/i)
    jakob.close(); anna.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('wave 6 (U7): an ask that arrived further than its asker allowed gets nothing, even from a line with no degrees limit', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [{ text: 'Cargo bike, any distance', audience: 'fof', degrees: -1, preset: PRESET }])
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, answerWindowMs: WINDOW_MS })
    const ben = await phone(relayOrigin, 'Ben', null)
    await ben.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const far = { relayed: true, maxHops: 2, hop: 2, root: 'rootBeyond1', seen: [], via: ['Ann', 'Cleo'] }
    expect((await ben.ask(peer.card.did, 'cargo bike', 4000, far)).outcome).toBe('nothing')
    expect((await ben.ask(peer.card.did, 'cargo bike', 4000, { ...far, root: 'rootWithin1', hop: 1 })).outcome).toBe('shared')
    ben.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)

  it('wave 6: further out (hop 1) a preset line answers only within its degrees; the same ask by a second path is nothing; a direct ask still never forwards', async () => {
    const dir = tmp()
    const inv = inventoryFile(dir, [
      { text: 'Loudspeakers, one degree (default)', audience: 'fof', preset: PRESET },
      { text: 'Loudspeakers, contacts only', audience: 'fof', degrees: 0, preset: PRESET },
    ])
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, answerWindowMs: WINDOW_MS })
    const ben = await phone(relayOrigin, 'Ben', null)
    await ben.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const root = 'rootXYZ789'
    const hop1 = { relayed: true, maxHops: 2, hop: 1, root, seen: [await seenHash(root, 'ann'), await seenHash(root, 'ben')], via: ['Ann'] }
    const t0 = Date.now()
    const a1 = await ben.ask(peer.card.did, 'loudspeakers', 4000, hop1)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(WINDOW_MS - 30)
    expect(a1.outcome).toBe('shared')
    expect(a1.shared.items.map((i) => i.text)).toEqual(['Loudspeakers, one degree (default)'])
    const again = await ben.ask(peer.card.did, 'loudspeakers', 4000, hop1)
    expect(again.outcome).toBe('nothing')
    const atHop0 = await ben.ask(peer.card.did, 'loudspeakers')
    expect(atHop0.shared.items.map((i) => i.text).sort()).toEqual(['Loudspeakers, contacts only', 'Loudspeakers, one degree (default)'])
    const tooFar = await ben.ask(peer.card.did, 'loudspeakers', 4000, { ...hop1, root: 'rootTooFar1', hop: 2 })
    expect(tooFar.outcome).toBe('nothing')
    ben.close()
    await peer.stop()
    rmSync(dir, { recursive: true })
  }, 30_000)
})
