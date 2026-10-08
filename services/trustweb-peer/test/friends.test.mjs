/**
 * trustweb-peer, wave 6d: the owner's friends who allowed their lines in advance, answered THROUGH the front door (peer.ts
 * parseFriends / friendAnswers / mergeAnswerItems). Unit tests of the section, the admission matrix (cascade.ts at hop + 1, the
 * friend's ring for the owner) and the forgiving matcher; then the whole peer against an in-memory relay with real phones built
 * from the same apps/demo modules: a friends-of-friends ask gets the friend's line "through Jakob", My contacts and a direct ask
 * get nothing, the moment is the travelling moment whatever matches, nothing private reaches the log.
 *
 * Run from the repo root:
 *   apps/demo/node_modules/.bin/vitest run --config services/trustweb-peer/test/vitest.config.mjs --root services/trustweb-peer
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { friendAnswers, friendContext, loadInventory, mergeAnswerItems, parseFriends, startPeer } from '../peer.ts'
import { seenHash } from '../../../apps/trustweb/src/hops.ts'
import { createIdentity, ecdhSharedSecret } from '../../../apps/demo/src/did.ts'
import { createRelayChannel } from '../../../apps/demo/src/relay.ts'
import { deriveEcdhPairKey, randomId } from '../../../apps/demo/src/crypto.ts'
import { encodeForQr } from '../../../apps/demo/src/wire.ts'
import { buildConnectAck } from '../../../apps/demo/src/connect_link.ts'
import { interpret, truncateSharedJson } from '../../../apps/demo/src/gate.ts'
import { sealRelayAnswer } from '../../../apps/demo/src/answer_key.ts'

const WINDOW_MS = 400
const TANDEM = 'Tandem bicycle to lend, weekends (two seats, Vienna)'
const PRESET = { by: 'Jakob', at: '2026-10-07', note: 'demo content' }

function tmp() { return mkdtempSync(path.join(tmpdir(), 'twpeer-')) }
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


function friend(over = {}) {
  return { name: 'Mira', ring: 'friend', allowedInAdvance: true, at: '2026-10-08', note: 'demo content', items: [{ text: TANDEM, audience: 'fof', degrees: 1 }], ...over }
}
function parse(friends, now = 1) { return parseFriends({ friends }, 'Jakob', now) }
function textsOf(items) { return items.map((i) => i.text) }

describe('parseFriends: the optional friends section of the inventory file', () => {
  it('absent, not an array or junk = no friends and nothing counted (today\'s behaviour)', () => {
    for (const raw of [{}, { friends: null }, { friends: 'Mira' }, { friends: {} }, null, 'x', 7]) {
      expect(parseFriends(raw, 'Jakob', 1)).toEqual({ friends: [], lines: 0, held: 0 })
    }
  })
  it('a friend who allowed her lines in advance is loaded with her ring, a visible mark and her lines', () => {
    const r = parse([friend()])
    expect(r.lines).toBe(1)
    expect(r.held).toBe(0)
    expect(r.friends).toHaveLength(1)
    expect(r.friends[0]).toMatchObject({ name: 'Mira', ring: 'friend', context: 'Mira, a friend of Jakob. Allowed in advance by Mira (2026-10-08): demo content' })
    expect(r.friends[0].items[0]).toMatchObject({ text: TANDEM, audience: 'fof', degrees: 1, included: true, createdAt: 1 })
    expect(friendContext('Mira', 'Jakob')).toBe('Mira, a friend of Jakob. Allowed in advance by Mira')
  })
  it('allowedInAdvance must be exactly true: anything else holds her lines (counted, never shared)', () => {
    for (const flag of [undefined, false, 'true', 1, null]) {
      const r = parse([friend({ allowedInAdvance: flag })])
      expect(r.friends).toEqual([])
      expect(r.lines).toBe(0)
      expect(r.held).toBe(1)
    }
  })
  it('an entry without a usable name or ring is skipped whole; "intending" admits nothing and is no friend', () => {
    const r = parse([friend({ name: '' }), friend({ name: 7 }), friend({ ring: 'intending' }), friend({ ring: 'family' }), friend({ ring: undefined }), 'Mira', null, [], friend()])
    expect(r.friends.map((f) => f.name)).toEqual(['Mira'])
    expect(r.held).toBe(0)
  })
  it('lines: malformed ones are skipped, an over-long one is held, degrees default by audience, a bad degrees value is dropped', () => {
    const r = parse([friend({ items: [
      { text: 'x'.repeat(301), audience: 'fof' },
      { text: '', audience: 'fof' },
      { text: 'Hammock', audience: 'everyone' },
      'junk',
      { text: 'Hammock, two', audience: 'friends', degrees: 'far' },
      { text: 'Ladder', audience: 'fof', degrees: -1 },
    ] })])
    expect(r.held).toBe(1)
    expect(r.friends[0].items.map((i) => [i.text, i.degrees])).toEqual([['Hammock, two', undefined], ['Ladder', -1]])
    expect(parse([friend({ items: 'nope' })])).toEqual({ friends: [], lines: 0, held: 0 })
  })
  it('a line too long for the one answer block with her mark and "through <door>" is held, not cut; the name is clipped and cleaned', () => {
    const r = parse([friend({ note: 'n'.repeat(500), items: [{ text: 'a'.repeat(300), audience: 'fof' }, { text: 'short', audience: 'fof' }] })])
    expect(textsOf(r.friends[0].items)).toEqual(['short'])
    expect(r.held).toBe(1)
    const named = parse([friend({ name: '‮Mira' + 'z'.repeat(60) })])
    expect(named.friends[0].name).toBe('Mira' + 'z'.repeat(36))
  })
  it('the door\'s own lines load exactly as before, with or without the section', () => {
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    const items = [{ text: 'Loudspeakers', audience: 'fof', preset: PRESET }, { text: 'Projector', audience: 'fof' }]
    writeFileSync(f, JSON.stringify({ items }))
    const without = loadInventory(f, 5)
    writeFileSync(f, JSON.stringify({ items, friends: [friend()] }))
    const withFriends = loadInventory(f, 5)
    const strip = (inv) => ({ held: inv.held, lines: inv.preset.map((l) => [l.item.text, l.preset]) })
    expect(strip(withFriends)).toEqual(strip(without))
    expect(withFriends.held).toBe(1)
    rmSync(dir, { recursive: true })
  })
  it('the shipped demo inventory carries exactly one dummy friend with one tandem line and holds nothing', () => {
    const inv = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'demo_inventory.json')))
    const r = parseFriends(inv, 'Jakob', 1)
    expect(r.friends.map((f) => f.name)).toEqual(['Mira'])
    expect(r).toMatchObject({ lines: 1, held: 0 })
    expect(r.friends[0].items[0]).toMatchObject({ text: TANDEM, audience: 'fof', degrees: 1 })
    expect(r.friends[0].context).toBe('Mira, a friend of Jakob. Allowed in advance by Mira (2026-10-08): demo content')
    expect(inv.items).toHaveLength(10)
    expect(inv.friends).toHaveLength(1)
    expect(inv.friends[0]).toMatchObject({ name: 'Mira', ring: 'friend', allowedInAdvance: true })
    expect(inv.friends[0].items).toHaveLength(1)
  })
})

describe('friendAnswers: the admission matrix at hop + 1 (cascade.ts, the friend\'s ring for the owner)', () => {
  const ask = (friends, text, hop = 0) => friendAnswers(friends, text, hop, 'Jakob')
  const one = (item, over = {}) => parse([friend({ items: [item], ...over })]).friends

  it('the tandem line, friends of friends: answered at the step after the door, marked "through Jakob" with Mira in its context', () => {
    const out = ask(one({ text: TANDEM, audience: 'fof', degrees: 1 }), 'tandem')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ text: TANDEM, via: ['Jakob'], context: 'Mira, a friend of Jakob. Allowed in advance by Mira (2026-10-08): demo content' })
    expect(out[0].when).toMatch(/^(early|mid|late) [A-Z][a-z]+$/)
  })
  it('degrees: 0 is not shared past the owner\'s contacts; 1 reaches exactly one step; -1 reaches on', () => {
    expect(ask(one({ text: TANDEM, audience: 'fof', degrees: 0 }), 'tandem')).toEqual([])
    expect(ask(one({ text: TANDEM, audience: 'fof', degrees: 1 }), 'tandem', 0)).toHaveLength(1)
    expect(ask(one({ text: TANDEM, audience: 'fof', degrees: 1 }), 'tandem', 1)).toEqual([])
    expect(ask(one({ text: TANDEM, audience: 'fof', degrees: -1 }), 'tandem', 3)).toHaveLength(1)
  })
  it('a line without degrees follows the default of its audience: acquaintances one step, narrower none', () => {
    expect(ask(one({ text: TANDEM, audience: 'fof' }), 'tandem')).toHaveLength(1)
    expect(ask(one({ text: TANDEM, audience: 'friends' }), 'tandem')).toEqual([])
    expect(ask(one({ text: TANDEM, audience: 'friends', degrees: 1 }), 'tandem')).toHaveLength(1)
  })
  it('audience against her ring for the owner: friends/close lines need a friend/close ring, "me" never', () => {
    const line = (audience) => ({ text: TANDEM, audience, degrees: 1 })
    expect(ask(one(line('friends')), 'tandem')).toHaveLength(1)
    expect(ask(one(line('close')), 'tandem')).toEqual([])
    expect(ask(one(line('close'), { ring: 'close' }), 'tandem')).toHaveLength(1)
    expect(ask(one(line('friends'), { ring: 'acquaintance' }), 'tandem')).toEqual([])
    expect(ask(one(line('fof'), { ring: 'acquaintance' }), 'tandem')).toHaveLength(1)
    expect(ask(one(line('me')), 'tandem')).toEqual([])
  })
  it('the forgiving matcher: Tandem, tandem bike, tandem bicycle, tandems and a plain description find the line as it is', () => {
    const friends = one({ text: TANDEM, audience: 'fof', degrees: 1 })
    const hits = {}
    for (const q of ['Tandem', 'tandem bike', 'tandem bicycle', 'tandems', 'a bicycle for two to lend', 'who has a tandem for the weekend', 'Tandemfahrrad', 'tandm']) hits[q] = ask(friends, q).length
    console.log('forgiving matcher on the tandem line, no aliases:', JSON.stringify(hits))
    for (const q of ['Tandem', 'tandem bike', 'tandem bicycle', 'tandems', 'who has a tandem for the weekend']) expect(hits[q]).toBe(1)
  })
  it('aliases (other words for a line, matched on only): the German compound finds it, and no alias is ever shown or sent', () => {
    const friends = one({ text: TANDEM, audience: 'fof', degrees: 1, aliases: ['Tandemfahrrad', 'Tandemrad', 'Fahrrad', 'Tandemfahrrad', 7, '  '] })
    expect(friends[0].matchable[0].text).toBe(TANDEM + ' Tandemfahrrad Tandemrad Fahrrad')
    expect(friends[0].items[0].text).toBe(TANDEM)
    for (const q of ['Tandemfahrrad', 'tandemfahrrad', 'Tandemrad', 'Fahrrad']) {
      const out = ask(friends, q)
      expect(out).toHaveLength(1)
      expect(out[0].text).toBe(TANDEM)
      expect(JSON.stringify(out)).not.toMatch(/fahrrad|tandemrad/i)
    }
    expect(ask(friends, 'projector')).toEqual([])
    expect(parse([friend({ items: [{ text: TANDEM, audience: 'fof', aliases: 'Tandemfahrrad' }] })]).friends[0].matchable[0].text).toBe(TANDEM)
    const many = one({ text: TANDEM, audience: 'fof', aliases: Array.from({ length: 20 }, (_, i) => 'w' + i + 'z'.repeat(60)) })
    const kept = many[0].matchable[0].text.slice(TANDEM.length + 1).split(' ')
    expect(kept).toHaveLength(6)
    expect(kept.every((w) => w.length === 40)).toBe(true)
  })
  it('an unrelated ask finds nothing; several friends answer in order and a friend is never merged with another\'s lines', () => {
    const friends = parse([friend(), friend({ name: 'Paul', items: [{ text: 'Tandem trailer for kids', audience: 'fof', degrees: 1 }, { text: 'Garden shears', audience: 'fof', degrees: 1 }] })]).friends
    expect(ask(friends, 'projector for a talk')).toEqual([])
    const out = ask(friends, 'tandem')
    expect(out.map((i) => i.context.split(',')[0])).toEqual(['Mira', 'Paul'])
    expect(textsOf(out)).toEqual([TANDEM, 'Tandem trailer for kids'])
  })
  it('no friends = no items', () => {
    expect(friendAnswers([], 'tandem', 0, 'Jakob')).toEqual([])
  })
})

describe('mergeAnswerItems: owner first, then the friends, then the door\'s lines (the tail is what the full answer block cuts)', () => {
  const line = (t) => ({ text: t, when: 'w', context: 'c' })
  it('without friends it is the old merge (first three of owner then preset)', () => {
    expect(textsOf(mergeAnswerItems([line('o1')], [line('p1'), line('p2'), line('p3')], []))).toEqual(['o1', 'p1', 'p2'])
    expect(textsOf(mergeAnswerItems([], [], []))).toEqual([])
  })
  it('a friend\'s line stands before the door\'s lines; the same line twice is shown once', () => {
    expect(textsOf(mergeAnswerItems([line('o1')], [line('p1'), line('p2')], [line('f1'), line('f2')]))).toEqual(['o1', 'f1', 'f2'])
    expect(textsOf(mergeAnswerItems([], [], [line('f1'), line('f2'), line('f3'), line('f4')]))).toEqual(['f1', 'f2', 'f3'])
    expect(textsOf(mergeAnswerItems([], [line('p1')], [line('f1')]))).toEqual(['f1', 'p1'])
    expect(textsOf(mergeAnswerItems([line('Same')], [], [line('same')]))).toEqual(['Same'])
  })
  it('review fix: Mira survives the one 512-byte answer block next to the longest of Jakob\'s own lines', () => {
    const longest = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'demo_inventory.json'), 'utf8')).items.reduce((a, b) => (b.text.length > a.text.length ? b : a))
    const mira = friendAnswers(parseFriends(JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'demo_inventory.json'), 'utf8')), 'Jakob', 1).friends, 'tandem', 0, 'Jakob')
    const own = { text: longest.text, when: 'early October', context: 'Allowed in advance by Jakob (2026-10-07): demo content' }
    const body = new TextDecoder().decode(truncateSharedJson({ from: 'Jakob', templateId: 'free', items: mergeAnswerItems([], [own], mira) }))
    expect(longest.text.length).toBeGreaterThan(170)
    expect(body).toContain('Tandem bicycle')
  })
})

describe('review fixes: caps, hostile content, exact size check', () => {
  it('a multibyte door name is measured exactly: a line that fits for "Jakob" can be held for a long non-ASCII name', () => {
    const fits = (door) => parseFriends({ friends: [friend({ items: [{ text: 'a'.repeat(250), audience: 'fof' }] })] }, door, 1).lines
    expect(fits('Jakob')).toBe(1)
    expect(fits('\u00dc'.repeat(200))).toBe(0)
  })
  it('at most 20 friends and 20 lines each; the rest is held, counted', () => {
    const many = Array.from({ length: 25 }, (_, i) => friend({ name: 'F' + i, items: [{ text: 'Line ' + i, audience: 'fof' }] }))
    const r = parseFriends({ friends: many }, 'Jakob', 1)
    expect(r.friends).toHaveLength(20)
    expect(r.held).toBe(5)
    const lines = parseFriends({ friends: [friend({ items: Array.from({ length: 30 }, (_, i) => ({ text: 'L' + i, audience: 'fof' })) })] }, 'Jakob', 1)
    expect(lines.lines).toBe(20)
    expect(lines.held).toBe(10)
  })
  it('hostile shapes never throw: null or array entries, items that are null, prototype keys; control characters are stripped from a line', () => {
    expect(() => parseFriends({ friends: [null, [], { __proto__: { name: 'x' } }, { name: 'M', ring: 'friend', allowedInAdvance: true, items: [null, [], 'x', { text: 7 }] }] }, 'Jakob', 1)).not.toThrow()
    const r = parse([friend({ items: [{ text: '\u202eTandem\u0007', audience: 'fof' }] })])
    expect(r.friends[0].items[0].text).toBe('Tandem')
    const dir = tmp()
    const f = path.join(dir, 'inv.json')
    writeFileSync(f, JSON.stringify({ items: [null, 'x', [], { text: 'Loudspeakers', audience: 'fof', preset: PRESET }] }))
    expect(loadInventory(f, 1).preset.map((l) => l.item.text)).toEqual(['Loudspeakers'])
    rmSync(dir, { recursive: true })
  })
  it('the day must be a YYYY-MM-DD date and the name is clipped by characters, not through a surrogate pair', () => {
    expect(parse([friend({ at: '1' })]).friends[0].context).toBe('Mira, a friend of Jakob. Allowed in advance by Mira: demo content')
    expect(parse([friend({ at: 'Tue, 01 Oct 2026' })]).friends[0].context).not.toMatch(/\(/)
    const name = parse([friend({ name: '\u{1F6B2}'.repeat(10) + 'a'.repeat(60) })]).friends[0].name
    expect([...name]).toHaveLength(40)
    expect(name.endsWith('a'.repeat(30))).toBe(true)
    expect(name).not.toMatch(/\uFFFD/)
  })
})

describe('the peer against an in-memory relay: a friend of the owner answered through the front door', () => {
  const SHIPPED = path.join(import.meta.dirname, '..', 'demo_inventory.json')
  const MIRA_CONTEXT = 'Mira, a friend of Jakob. Allowed in advance by Mira (2026-10-08): demo content'
  let relay, relayOrigin
  beforeAll(async () => {
    const { RelayServer } = await import('../../../packages/transport/src/relay_server.ts')
    const { InMemoryRelayQueueStore } = await import('../../../packages/transport/src/relay_queue_store.ts')
    relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    const { port } = await relay.listen(0, '127.0.0.1')
    relayOrigin = `http://127.0.0.1:${port}`
  })
  afterAll(async () => { await relay.close() })

  /**
   * A door on the shipped demo inventory (or `inventoryFile`) with one connected asker, as the demo guest is. `owner` = what the
   * owner's phone does with a forwarded ask: given, the owner's phone claims the door first (the claim binds the first phone).
   */
  async function door({ owner, ...extra } = {}) {
    const dir = tmp()
    const lines = []
    const peer = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: SHIPPED, relayOrigin, healthPort: 0, answerWindowMs: WINDOW_MS, log: (l) => lines.push(l), ...(owner ? { claim: true } : {}), ...extra })
    const jakob = owner ? await phone(relayOrigin, 'Jakob', owner) : null
    if (jakob) { await jakob.connectTo(peer.card.did); await until(() => peer.status().owner) }
    const anna = await phone(relayOrigin, 'Anna-demo', null)
    await anna.connectTo(peer.card.did)
    await until(() => peer.peerCount() === 1)
    const done = async () => { jakob?.close(); anna.close(); await peer.stop(); rmSync(dir, { recursive: true }) }
    return { dir, lines, peer, anna, jakob, done }
  }
  /** The hop fields a phone sends for "How far? Friends of friends". */
  const fof = async (root, over = {}) => ({ maxHops: 2, hop: 0, root, seen: [await seenHash(root, 'anna')], ...over })

  it('Friends of friends: "tandem" comes back as Mira\'s line, from Jakob, marked "through Jakob", one window later than a hop-0 answer', async () => {
    const d = await door()
    const t0 = Date.now()
    const a = await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootTandem01'))
    const took = Date.now() - t0
    expect(a.outcome).toBe('shared')
    expect(a.shared.from).toBe('Jakob')
    expect(a.shared.items).toHaveLength(1)
    expect(a.shared.items[0]).toMatchObject({ text: TANDEM, context: MIRA_CONTEXT, via: ['Jakob'] })
    // the travelling moment: two windows (the door's own and one more step), never the one window of a hop-0 answer
    expect(took).toBeGreaterThanOrEqual(2 * WINDOW_MS - 30)
    // My contacts (an ask with no hop fields, as the default sends it): nothing, at the one-window moment
    const t1 = Date.now()
    const b = await d.anna.ask(d.peer.card.did, 'tandem')
    expect(b.outcome).toBe('nothing')
    expect(Date.now() - t1).toBeGreaterThanOrEqual(WINDOW_MS - 30)
    expect(Date.now() - t1).toBeLessThan(2 * WINDOW_MS - 30)
    await d.done()
  }, 30_000)

  it('nothing for My contacts spelled out (maxHops 1), for a direct ask at any reach, and for an ask that already arrived at its last step', async () => {
    const d = await door()
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 4000, { maxHops: 1 })).outcome).toBe('nothing')
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 4000, await fof('rootDirect01', { direct: true }))).outcome).toBe('nothing')
    // hop 1 of a two-step ask: this door is the last to answer, so no friend of the owner is asked beyond it
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 4000, await fof('rootLast0001', { hop: 1, relayed: true }))).outcome).toBe('nothing')
    // three steps, hop 0: Mira is at step 1 of 3, within reach
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootThree001', { maxHops: 3 }))).outcome).toBe('shared')
    // three steps, arrived at hop 1: Mira would be at hop 2, beyond the line's one degree
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootThree002', { maxHops: 3, hop: 1, relayed: true }))).outcome).toBe('nothing')
    await d.done()
  }, 60_000)

  it('the forgiving matcher through the whole peer: Tandem, tandem bike, Tandemfahrrad, Tandemrad all find Mira\'s line', async () => {
    const d = await door()
    const got = {}
    for (const [i, q] of ['Tandem', 'tandem bike', 'Tandemfahrrad', 'Tandemrad', 'projecton'].entries()) {
      const a = await d.anna.ask(d.peer.card.did, q, 6000, await fof('rootMatch' + i))
      got[q] = a.outcome === 'shared' ? a.shared.items.map((x) => x.text) : []
    }
    for (const q of ['Tandem', 'tandem bike', 'Tandemfahrrad', 'Tandemrad']) expect(got[q]).toEqual([TANDEM])
    // an ask for one of Jakob's own lines still returns his line, not Mira's
    expect(got.projecton).not.toContain(TANDEM)
    console.log('through the peer:', JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.length]))))
    await d.done()
  }, 60_000)

  it('the moment does not depend on a match: a matching and a non-matching travelling ask both arrive at the travelling moment', async () => {
    const d = await door()
    const time = async (q, root) => { const t = Date.now(); const a = await d.anna.ask(d.peer.card.did, q, 6000, await fof(root)); return { ms: Date.now() - t, outcome: a.outcome } }
    const hit = await time('tandem', 'rootTimeHit1')
    const miss = await time('a pottery wheel', 'rootTimeMis1')
    const repeat = await time('tandem', 'rootTimeHit1')
    expect([hit.outcome, miss.outcome, repeat.outcome]).toEqual(['shared', 'nothing', 'nothing'])
    for (const t of [hit, miss, repeat]) expect(t.ms).toBeGreaterThanOrEqual(2 * WINDOW_MS - 30)
    expect(Math.abs(hit.ms - miss.ms)).toBeLessThan(WINDOW_MS / 2)
    expect(Math.abs(hit.ms - repeat.ms)).toBeLessThan(WINDOW_MS / 2)
    await d.done()
  }, 30_000)

  it('with a bound owner who declines or stays silent: Mira\'s line comes back at the door\'s forward deadline plus one step, never earlier', async () => {
    const d = await door({ owner: () => null, forwardWaitMs: 600 })
    const t0 = Date.now()
    const a = await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootOwner001'))
    expect(a.outcome).toBe('shared')
    expect(a.shared.items.map((i) => i.text)).toEqual([TANDEM])
    expect(Date.now() - t0).toBeGreaterThanOrEqual(600 + WINDOW_MS - 30)
    const t1 = Date.now()
    const b = await d.anna.ask(d.peer.card.did, 'a pottery wheel', 6000, await fof('rootOwner002'))
    expect(b.outcome).toBe('nothing')
    expect(Date.now() - t1).toBeGreaterThanOrEqual(600 + WINDOW_MS - 30)
    // the owner's phone was asked as before (door, the asker in via); the friend's line never went to him
    expect(d.jakob.asks.at(-1)).toMatchObject({ door: true, relayed: true, via: ['Anna-demo'] })
    await d.done()
  }, 30_000)

  it('the owner\'s live share and Mira\'s line travel in the same sealed answer; the owner\'s share alone goes early', async () => {
    const d = await door({ owner: () => [{ text: 'A tandem helmet, spare', when: 'early October', context: 'What I have', via: ['Jakob'] }], forwardWaitMs: 1500 })
    const t0 = Date.now()
    const a = await d.anna.ask(d.peer.card.did, 'tandem', 8000, await fof('rootBoth0001'))
    expect(a.outcome).toBe('shared')
    expect(a.shared.items.map((i) => i.text)).toEqual(['A tandem helmet, spare', TANDEM])
    expect(a.shared.items[1]).toMatchObject({ via: ['Jakob'], context: MIRA_CONTEXT })
    expect(Date.now() - t0).toBeLessThan(1500)
    await d.done()
  }, 30_000)

  it('the owner asking his own door gets his lines only, never Mira\'s (she is asked through him, not for him)', async () => {
    const d = await door({ owner: () => null, forwardWaitMs: 300 })
    const a = await d.jakob.ask(d.peer.card.did, 'tandem', 6000, await fof('rootSelf0001'))
    expect(a.outcome).toBe('nothing')
    await d.done()
  }, 30_000)

  it('an inventory file without a friends section behaves exactly as before: no friend line, no friend count, same log shape', async () => {
    const dir0 = tmp()
    const f = path.join(dir0, 'inv.json')
    writeFileSync(f, JSON.stringify({ items: [{ text: 'Loudspeakers', audience: 'fof', preset: PRESET }] }))
    const d = await door({ inventoryFile: f })
    expect(d.peer.status()).toMatchObject({ presetLines: 1, heldLines: 0, friends: 0, friendLines: 0 })
    const a = await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootNone0001'))
    expect(a.outcome).toBe('nothing')
    const b = await d.anna.ask(d.peer.card.did, 'loudspeakers', 6000, await fof('rootNone0002'))
    expect(b.shared.items.map((i) => i.text)).toEqual(['Loudspeakers'])
    expect(b.shared.items[0].via).toBeUndefined()
    expect(d.lines.some((l) => /up with 1 preset lines \(0 held, never shared\), policy open, 0 peers, owner not bound, forward on, 0 friends' lines \(0 friends\)/.test(l))).toBe(true)
    expect(d.lines.some((l) => /ask shared \(1\): preset=1 owner=not-asked friend=0/.test(l))).toBe(true)
    await d.done()
    rmSync(dir0, { recursive: true })
  }, 30_000)

  it('counts only in status and log: no ask, no friend line, no name reaches the log', async () => {
    const d = await door()
    expect(d.peer.status()).toMatchObject({ presetLines: 10, heldLines: 0, friends: 1, friendLines: 1 })
    await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootLog00001'))
    await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootLog00002', { direct: true }))
    expect(d.lines.some((l) => /up with 10 preset lines \(0 held, never shared\), policy open, 0 peers, owner not bound, forward on, 1 friends' lines \(1 friends\)/.test(l))).toBe(true)
    expect(d.lines.some((l) => /ask shared \(1\): preset=0 owner=not-asked friend=1/.test(l))).toBe(true)
    expect(d.lines.some((l) => /ask no-match \(0\): preset=0 owner=not-asked friend=0/.test(l))).toBe(true)
    expect(d.lines.join('\n')).not.toMatch(/tandem|mira|anna|bicycle|vienna|weekend/i)
    await d.done()
  }, 30_000)

  it('SIGHUP re-reads the file: a bad file keeps the friends, removing the section stops the answers, putting it back resumes them', async () => {
    const dir0 = tmp()
    const f = path.join(dir0, 'inv.json')
    const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8'))
    writeFileSync(f, JSON.stringify(shipped))
    const d = await door({ inventoryFile: f })
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootHup00001'))).outcome).toBe('shared')
    writeFileSync(f, '{ not json')
    process.emit('SIGHUP')
    await until(() => d.lines.some((l) => /reload failed \(kept the previous inventory/.test(l)))
    expect(d.peer.status()).toMatchObject({ presetLines: 10, friends: 1, friendLines: 1 })
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootHup00002'))).outcome).toBe('shared')
    writeFileSync(f, JSON.stringify({ items: shipped.items }))
    process.emit('SIGHUP')
    await until(() => d.lines.some((l) => /reloaded: 10 preset lines, 0 held, 0 grants, 0 friends' lines \(0 friends\)/.test(l)))
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootHup00003'))).outcome).toBe('nothing')
    writeFileSync(f, JSON.stringify(shipped))
    process.emit('SIGHUP')
    await until(() => d.lines.some((l) => /reloaded: 10 preset lines, 0 held, 0 grants, 1 friends' lines \(1 friends\)/.test(l)))
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootHup00004'))).outcome).toBe('shared')
    await d.done()
    rmSync(dir0, { recursive: true })
  }, 60_000)

  it('the moment is the same with and without the friends section, for the same travelling ask', async () => {
    const dir0 = tmp()
    const f = path.join(dir0, 'inv.json')
    writeFileSync(f, JSON.stringify({ items: JSON.parse(readFileSync(SHIPPED, 'utf8')).items }))
    const withF = await door()
    const without = await door({ inventoryFile: f })
    const time = async (d, root) => { const t = Date.now(); await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof(root)); return Date.now() - t }
    const a = await time(withF, 'rootSame00001')
    const b = await time(without, 'rootSame00002')
    expect(Math.abs(a - b)).toBeLessThan(WINDOW_MS / 2)
    await withF.done(); await without.done()
    rmSync(dir0, { recursive: true })
  }, 30_000)

  it('a cycle back to this door and the per-asker rate limit answer nothing, with the friends present, at the travelling moment', async () => {
    const d = await door({ asksPerHour: 2 })
    const root = 'rootCycle0001'
    const cycle = { ...(await fof(root)), seen: [await seenHash(root, 'anna'), await seenHash(root, d.peer.card.id)] }
    const t0 = Date.now()
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, cycle)).outcome).toBe('nothing')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * WINDOW_MS - 30)
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootLimit0001'))).outcome).toBe('shared')
    // the third ask in the hour: rate limited, nothing, whatever it asks
    expect((await d.anna.ask(d.peer.card.did, 'tandem', 6000, await fof('rootLimit0002'))).outcome).toBe('nothing')
    await d.done()
  }, 30_000)
})
