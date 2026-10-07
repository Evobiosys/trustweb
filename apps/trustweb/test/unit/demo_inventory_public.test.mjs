/**
 * The owner's ten public demo lines (src/demo_inventory_public.ts, wave 4,
 * 2026-10-07): the person "Jakob" in every demo seed carries exactly these,
 * marked dummy like all seeded content; the demo peer's inventory serves the
 * ones that fit its 160-character bound; six other ticked lines are PRIVATE
 * and must appear nowhere (allowlist = the real guard, digest denylist =
 * the backup, see test/helpers/private_line_guard.mjs).
 *
 * Data safety: the seeded owner person never reaches a live phone. "Show demo
 * content" (addDemoContent in main.ts -> demoContentForLivePhone) adds the
 * fictional web only, marked dummy, and removes exactly that again; a
 * carry-over from the demo leaves him behind (review-wave4, 2026-10-07).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Audience, Provenance, Ring, isDemoItem, isDemoPerson } from '../../src/model.ts'
import { DEMO_CONTEXTS, DemoContext, Persona, seedState } from '../../src/seed.ts'
import { JAKOB_DEMO_CONTEXT, JAKOB_DEMO_NAME, JAKOB_PUBLIC_LINES, PUBLIC_LINE_DEFAULT_AUDIENCE, isPublicDemoPerson } from '../../src/demo_inventory_public.ts'
import { demoContentForLivePhone, dummyIds } from '../../src/demo_to_live.ts'
import { markDemo } from '../../src/provenance.ts'
import { PRIVATE_LINE_DIGESTS, isPrivateLine, lineDigest, normaliseLine, scanText } from '../helpers/private_line_guard.mjs'

/** The ten lines the owner allowed in advance, verbatim as ticked (typos stay). The allowlist. */
const ALLOWED = [
  'I keep a tech stack doc covering LLM/AI, infrastructure, dev tools, knowledge, and communication channels.',
  'I have a tech stack file at /root/resources/tech-stack.md.',
  "I'm publishing my code on GitHub and if it's big and successful we move to our self-hosted GitLab instance (also because of the multi-nested repos)",
  "I have found the 'perfect' open-source license - an also-for-SaaS adapatation of the Mozilla license, which I dual-license with AGPL for F-Droid and OSI. And could triple license if someone asks",
  'If i try to get revenue with code I make my code AGPL by default, and teams can approach us for only the AMPL/ an also-for-SaaS adapatation of the Mozilla license license.',
  'I only use Matrix if verify that its reliabile of their services and have dedicated resources for that',
  'I could hold a workshop on the conceptual building blocks of trustweb.',
  "I work as a founder, and what I'm founding is the TrustWeb.one",
  'I use the Equal Earth over the Mercator projection for global maps',
  'I can help you clean up your online presence, making sure everywhere you show up on the web links to your current website.',
]
/** The peer keeps 160 characters per line (loadInventory): longer lines stay in the app demo only. */
const PEER_MAX = 160
const NOW = 1_760_000_000_000
const peerItems = () => JSON.parse(readFileSync(path.join(import.meta.dirname, '../../../../services/trustweb-peer/demo_inventory.json'), 'utf8')).items
/** The seven fictional lines the peer file held before the owner's lines were added (pinned: nothing else may creep in). */
const FICTIONAL_PEER = [
  'Motorbike (125cc), can lend it for a weekend', 'Spare desk in a coworking space, Fridays', 'Projector and screen for a talk, Vienna',
  'Camping tent for four, from June', 'Introductions to people hiring in climate tech', 'Guest bed for a visiting friend, two nights',
  'Spare room in Vienna, for visiting friends',
]

describe('the data module', () => {
  it('holds exactly the ten allowed lines, in order, with no em dash and no stray whitespace', () => {
    expect(JAKOB_PUBLIC_LINES.map((l) => l.text)).toEqual(ALLOWED)
    for (const t of ALLOWED) { expect(t).not.toContain(String.fromCharCode(0x2014)); expect(t).toBe(t.trim()) }
  })
  it('leaves the audience to the model default (no per-line audience is invented)', () => {
    expect(JAKOB_PUBLIC_LINES.every((l) => l.audience === undefined)).toBe(true)
    expect(PUBLIC_LINE_DEFAULT_AUDIENCE).toBe(Audience.Friends)
  })
})

describe('the seed: Jakob in every demo web (allowlist)', () => {
  const EXPECTED_PEOPLE = { [DemoContext.Generic]: 7, [DemoContext.Emergent]: 7, [DemoContext.Ea]: 8 }
  for (const ctx of DEMO_CONTEXTS) {
    it(`${ctx}: one person Jakob at Ring.Friend with exactly the ten lines, the new people count, inventory unchanged`, () => {
      const seed = seedState(Persona.Holder, NOW, ctx)
      expect(seed.people).toHaveLength(EXPECTED_PEOPLE[ctx])
      expect(seed.inventory).toHaveLength(2)
      const jakobs = seed.people.filter((p) => p.name === JAKOB_DEMO_NAME)
      expect(jakobs).toHaveLength(1)
      expect(jakobs[0].ring).toBe(Ring.Friend)
      expect(jakobs[0].context).toBe(JAKOB_DEMO_CONTEXT)
      expect(jakobs[0].lines.map((l) => l.text)).toEqual(ALLOWED)
      expect(jakobs[0].lines.every((l) => l.audience === PUBLIC_LINE_DEFAULT_AUDIENCE)).toBe(true)
    })
  }
  it('no other seeded person or item carries any of the ten lines', () => {
    for (const ctx of DEMO_CONTEXTS) {
      const seed = seedState(Persona.Holder, NOW, ctx)
      const others = [...seed.people.filter((p) => p.name !== JAKOB_DEMO_NAME).flatMap((p) => p.lines.map((l) => l.text)), ...seed.inventory.map((i) => i.text)]
      expect(others.filter((t) => ALLOWED.includes(t))).toEqual([])
    }
  })
  it('the other personas carry none of his lines', () => {
    for (const persona of [Persona.Seeker, Persona.Third, Persona.Fourth]) {
      const s = seedState(persona, NOW)
      expect(s.people.some((p) => p.name === JAKOB_DEMO_NAME)).toBe(false)
    }
  })
  it('is marked dummy like all seeded content: markDemo sets source demo on every one of the ten', () => {
    const seed = seedState(Persona.Holder, NOW)
    markDemo(seed.people, seed.inventory)
    const jakob = seed.people.find((p) => p.name === JAKOB_DEMO_NAME)
    expect(jakob.lines.every((l) => l.source?.kind === Provenance.Demo)).toBe(true)
  })
})

describe('the demo peer inventory (allowlist)', () => {
  it('holds only the seven fictional lines and the allowed lines that fit its bound; the longer two stay out', () => {
    const texts = peerItems().map((i) => i.text)
    const fitting = ALLOWED.filter((t) => t.length <= PEER_MAX)
    expect(fitting).toHaveLength(8)
    expect(ALLOWED.filter((t) => t.length > PEER_MAX)).toHaveLength(2)
    expect(texts).toEqual([...FICTIONAL_PEER, ...fitting])
  })
  it('serves the owner lines only with his preset (allowed in advance), as friends of friends, verbatim', () => {
    const owner = peerItems().filter((i) => ALLOWED.includes(i.text))
    expect(owner).toHaveLength(8)
    for (const i of owner) {
      expect(i.audience).toBe('fof')
      expect(i.preset).toEqual({ by: 'Jakob', at: '2026-10-07', note: 'demo content' })
    }
  })
})

describe('private-line digest denylist (backup)', () => {
  it('normalises as lowercase, collapsed whitespace, trimmed', () => {
    expect(normaliseLine('  Hello \n  WORLD\t')).toBe('hello world')
    expect(lineDigest('Hello   World')).toBe(lineDigest(' hello world '))
  })
  it('six distinct digests, none of them one of the ten public lines', () => {
    expect(new Set(PRIVATE_LINE_DIGESTS).size).toBe(6)
    expect(ALLOWED.filter((t) => isPrivateLine(t))).toEqual([])
  })
  it('no seeded string (names, contexts, lines, items) in any context and no peer line hashes to a private digest', () => {
    const strings = peerItems().map((i) => i.text)
    for (const ctx of DEMO_CONTEXTS) {
      const seed = seedState(Persona.Holder, NOW, ctx)
      strings.push(...seed.inventory.map((i) => i.text), ...seed.people.flatMap((p) => [p.name, p.context, ...p.lines.map((l) => l.text)]))
    }
    expect(strings.length).toBeGreaterThan(100)
    expect(strings.filter((t) => isPrivateLine(t))).toEqual([])
  })
  it('the scanner finds a digest-matching line as a line, a string literal and a JSON value (self-test with a stand-in digest)', () => {
    const probe = 'A stand-in line for the scanner self-test.'
    const deny = new Set([lineDigest(probe)])
    expect(scanText(`x\n  A STAND-IN   line for the scanner self-test.  \ny`, { deny })).toHaveLength(1)
    expect(scanText(`const a = "A stand-in line for the scanner\\u0020self-test."`, { deny })).toHaveLength(1) // the escaped literal (the raw line differs)
    expect(scanText(`{"k":["A stand-in line for the scanner self-test."]}`, { json: true, deny })).toHaveLength(1)
    expect(scanText(`Hello. A stand-in line for the scanner self-test. Bye.`, { deny })).toHaveLength(1) // a sentence of a longer string
    expect(scanText('nothing private here', { deny })).toEqual([])
  })
})

describe('data safety: the owner demo person never reaches a live phone', () => {
  /** What main.ts addDemoContent / removeDemoContent do to the record, on a live phone (add uses the same builder). */
  function live() {
    return {
      v: 1, me: { id: 'live-me', displayName: 'Real Person' }, peers: [], log: [], notificationsOn: true,
      people: [{ id: 'real-1', name: 'Jakob', context: 'a real friend with the same first name', ring: Ring.Friend, metAt: NOW, lines: [] }],
      inventory: [{ id: 'real-item', text: 'My own bike', audience: Audience.OnlyMe, included: true, createdAt: NOW }],
    }
  }
  function add(s, ctx = DemoContext.Generic) {
    const seed = demoContentForLivePhone(NOW, ctx)
    s.people.push(...seed.people)
    s.inventory.push(...seed.inventory)
    s.demo = { people: seed.people.map((p) => p.id), inventory: seed.inventory.map((i) => i.id) }
  }
  function remove(s) {
    const demo = s.demo
    s.people = s.people.filter((p) => !demo.people.includes(p.id))
    s.inventory = s.inventory.filter((i) => !demo.inventory.includes(i.id))
    delete s.demo
  }
  it('"Show demo content" adds the fictional web without the owner person, removes exactly that again; the live record stays v1', () => {
    for (const ctx of DEMO_CONTEXTS) {
      const s = live()
      add(s, ctx)
      expect(s.people.some((p) => isPublicDemoPerson(p))).toBe(false)
      const text = JSON.stringify(s)
      for (const line of ALLOWED) expect(text.includes(JSON.stringify(line).slice(1, -1))).toBe(false)
      expect(s.people.filter((p) => p.id !== 'real-1').every((p) => isDemoPerson(s, p.id))).toBe(true)
    }
    const s = live()
    const before = JSON.stringify(s)
    add(s)
    expect(isDemoPerson(s, 'real-1')).toBe(false)
    expect(s.inventory.filter((i) => isDemoItem(s, i.id))).toHaveLength(2)
    expect(s.v).toBe(1)
    remove(s)
    expect(JSON.stringify(s)).toBe(before)
  })
  it('"Start clean" recognises the seeded Jakob by name plus context, never a real friend named Jakob', () => {
    const s = live()
    const demoPhone = seedState(Persona.Holder, NOW)
    s.people.push(...demoPhone.people)
    const ids = dummyIds(s, DemoContext.Generic)
    expect(ids.people.has('real-1')).toBe(false)
    expect(ids.people.size).toBe(7)
    expect([...ids.people].some((id) => isPublicDemoPerson(s.people.find((p) => p.id === id)))).toBe(true)
  })
  it('the seed is only built where the demo is on: seedState in main.ts only under solo (createMe); the demo toggle goes through demoContentForLivePhone', () => {
    const main = readFileSync(path.join(import.meta.dirname, '../../src/main.ts'), 'utf8')
    const uses = main.split('\n').filter((l) => l.includes('seedState('))
    expect(uses).toHaveLength(1)
    expect(main).toMatch(/state = solo\s*\n\s*\? \{ \.\.\.seedState\(/)
    expect(main).toMatch(/function addDemoContent\(\)[\s\S]{0,200}demoContentForLivePhone\(/)
  })
})
