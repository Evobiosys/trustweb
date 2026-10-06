/**
 * trustweb-peer, the parts that need no relay: inventory loading (malformed
 * lines skipped), the grant list, the per-asker rate limit, and a full peer
 * started against an in-memory RelayServer: it comes up, writes its card,
 * and a second instance in the same state dir keeps the same identity.
 *
 * Run from the repo root (tsx and vitest come with the workspace):
 *   apps/demo/node_modules/.bin/vitest run --config services/trustweb-peer/test/vitest.config.mjs --root services/trustweb-peer
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request } from 'node:http'
import { AskRateLimit, PeerPolicy, loadGrants, loadInventory, startPeer } from '../peer.ts'

const HOUR = 3_600_000

function tmp() { return mkdtempSync(path.join(tmpdir(), 'twpeer-')) }
/** fetch() silently drops a Host header, so the local-service checks go through node:http. */
function statusWith(port, headers) {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/health', headers }, (res) => { res.resume(); resolve(res.statusCode) }).on('error', reject).end()
  })
}

describe('loadInventory', () => {
  it('reads text + audience and skips malformed lines', () => {
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    writeFileSync(f, JSON.stringify({ items: [
      { text: 'Motorbike, can lend', audience: 'fof' },
      { text: '', audience: 'fof' },
      { text: 'Secret', audience: 'everyone' },
      { text: 'Guest bed', audience: 'friends' },
      'junk',
    ] }))
    const items = loadInventory(f, 1000)
    expect(items.map((i) => i.text)).toEqual(['Motorbike, can lend', 'Guest bed'])
    expect(items.every((i) => i.included && i.createdAt === 1000 && i.id.length === 8)).toBe(true)
    rmSync(dir, { recursive: true })
  })
  it('is empty when the file has no items array', () => {
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    writeFileSync(f, '{"nope":1}')
    expect(loadInventory(f, 1)).toEqual([])
    rmSync(dir, { recursive: true })
  })
})

describe('loadGrants', () => {
  it('is empty without a grants file, lower-cases names otherwise', () => {
    const dir = tmp()
    expect(loadGrants(dir).size).toBe(0)
    writeFileSync(path.join(dir, 'grants.json'), JSON.stringify({ names: ['Anna-test', 7, 'BEN-test'] }))
    expect([...loadGrants(dir)]).toEqual(['anna-test', 'ben-test'])
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

describe('startPeer against an in-memory relay', () => {
  it('comes up, writes its card, keeps its identity across restarts, serves health on loopback only', async () => {
    const { RelayServer } = await import('../../../packages/transport/src/relay_server.ts')
    const { InMemoryRelayQueueStore } = await import('../../../packages/transport/src/relay_queue_store.ts')
    const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    const { port } = await relay.listen(0, '127.0.0.1')
    const dir = tmp()
    const inv = path.join(dir, 'inv.json')
    writeFileSync(inv, JSON.stringify({ items: [{ text: 'Motorbike, can lend', audience: 'fof' }] }))
    const lines = []
    const opts = { stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin: `http://127.0.0.1:${port}`, name: 'Demo inventory', policy: PeerPolicy.Open, healthPort: 0, log: (l) => lines.push(l) }
    const p1 = await startPeer({ ...opts, healthPort: 18961 })
    expect(p1.card.did.startsWith('did:peer:2')).toBe(true)
    expect(p1.card.name).toBe('Demo inventory')
    const card = JSON.parse(readFileSync(path.join(dir, 'state', 'demo-peer.json'), 'utf8'))
    expect(card).toEqual(p1.card)
    expect(await (await fetch('http://127.0.0.1:18961/health')).text()).toBe('ok')
    expect((await fetch('http://127.0.0.1:18961/card')).status).toBe(200)
    expect(await statusWith(18961, { Host: 'evil.example.com' })).toBe(421)
    expect(await statusWith(18961, { Origin: 'https://evil.example.com' })).toBe(421)
    expect(await statusWith(18961, {})).toBe(200)
    for (let i = 0; i < 50 && p1.status() !== 'connected'; i++) await new Promise((r) => setTimeout(r, 100))
    expect(p1.status()).toBe('connected')
    await p1.stop()
    const p2 = await startPeer(opts)
    expect(p2.card.did).toBe(p1.card.did)
    expect(p2.card.id).toBe(p1.card.id)
    await p2.stop()
    expect(lines.some((l) => /up with 1 items, policy open/.test(l))).toBe(true)
    expect(lines.join('\n')).not.toMatch(/Motorbike/)
    await relay.close()
    rmSync(dir, { recursive: true })
  }, 30_000)
})
