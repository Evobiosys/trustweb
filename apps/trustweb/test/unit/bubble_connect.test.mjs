// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-bubble-connect: a short hold of one bubble on another introduces them, a long hold merges (bubble_connect.ts). */
import { HOLD_MS, holdStart, holdStep } from '../../src/dot_merge.ts'
import { INTRODUCE_MIN_MS, MERGE_HOLD_MS, holdProgress, introduceBlock, queueIntro, takeIntroQueue, releaseOutcome } from '../../src/bubble_connect.ts'
import { INTRODUCED_RING, introduceTexts, introducedRing } from '../../src/bubble_links.ts'

const over = (at) => holdStep(holdStart(), { type: 'move', over: 'b', at })

describe('bubble connect timing', () => {
  it('thresholds: a merge needs the long hold, an introduction a short one', () => {
    expect(MERGE_HOLD_MS).toBe(1500)
    expect(HOLD_MS).toBe(MERGE_HOLD_MS)
    expect(INTRODUCE_MIN_MS).toBeLessThan(MERGE_HOLD_MS)
  })
  it('releasing between the minimum and the merge hold introduces', () => {
    const h = over(1000)
    expect(releaseOutcome(h, 1000 + INTRODUCE_MIN_MS - 1)).toBe('none')
    expect(releaseOutcome(h, 1000 + INTRODUCE_MIN_MS)).toBe('introduce')
    expect(releaseOutcome(h, 1000 + MERGE_HOLD_MS - 1)).toBe('introduce')
  })
  it('the merge offer (long hold) and no hold at all never introduce', () => {
    const offer = holdStep(over(0), { type: 'elapsed', at: MERGE_HOLD_MS })
    expect(offer.phase).toBe('offer')
    expect(releaseOutcome(offer, MERGE_HOLD_MS + 5)).toBe('none')
    expect(releaseOutcome(holdStart(), 5000)).toBe('none')
  })
  it('the progress ring fills from 0 to 1 over the merge hold', () => {
    const h = over(200)
    expect(holdProgress(h, 200)).toBe(0)
    expect(holdProgress(h, 200 + MERGE_HOLD_MS / 2)).toBeCloseTo(0.5)
    expect(holdProgress(h, 200 + MERGE_HOLD_MS * 3)).toBe(1)
    expect(holdProgress(holdStart(), 99)).toBe(0)
  })
})

const P = (id, over = {}) => ({ id, name: id.toUpperCase(), ring: 'friend', peerId: `peer-${id}`, ...over })
const peers = [{ id: 'peer-a', did: 'did:peer:2.a', displayName: 'Ada' }, { id: 'peer-b', did: 'did:peer:2.b', displayName: 'Ben' }]

describe('who can be introduced', () => {
  it('two different connected people can', () => expect(introduceBlock(P('a'), P('b'), peers)).toBeNull())
  it('refuses the same person, an unconnected one, a blocked one and one who wants to be asked first', () => {
    expect(introduceBlock(P('a'), P('a'), peers)).toBe('same')
    expect(introduceBlock(P('a'), P('b', { peerId: undefined }), peers)).toBe('not-connected')
    expect(introduceBlock(P('a'), P('c'), peers)).toBe('not-connected')
    expect(introduceBlock(P('a', { blocked: 5 }), P('b'), peers)).toBe('blocked')
    expect(introduceBlock(P('a'), P('b', { introducePermission: 'ask-first' }), peers)).toBe('ask-first')
  })
})

describe('the texts each side gets', () => {
  const t = introduceTexts('https://app.test/', P('a'), P('b'), peers, 'Jakob')
  it('says so when a text would not fit a chat message', () => expect(introduceTexts('https://app.test/', P('a'), P('b'), peers, 'J'.repeat(600))).toBeNull())
  it('A gets the code of B and B the code of A, marked as an introduction', () => {
    expect(t.toA.peerId).toBe('peer-a')
    expect(t.toB.peerId).toBe('peer-b')
    expect(t.toA.text).toContain(encodeURIComponent('did:peer:2.b'))
    expect(t.toB.text).toContain(encodeURIComponent('did:peer:2.a'))
    expect(t.toA.text).toContain('acq=1')
    expect(t.toA.text).toContain('Jakob')
  })
  it('each text fits a chat message', () => {
    expect(t.toA.text.length).toBeLessThanOrEqual(500)
  })
  it('an introduced link is read as acquainted community member (Friends zone), a plain one is not', () => {
    expect(INTRODUCED_RING).toBe('friend')
    expect(introducedRing('?connect=x&id=1&name=B&acq=1')).toBe('friend')
    expect(introducedRing('?connect=x&id=1&name=B')).toBeNull()
  })
})

describe('MCP queue', () => {
  it('queues one introduction (order-free) and the app takes it once', () => {
    const rec = { people: [P('a'), P('b')], peers }
    expect(queueIntro(rec, 'a', 'b', 10)).toEqual({ ok: true })
    expect(queueIntro(rec, 'b', 'a', 11)).toEqual({ ok: true, already: true })
    expect(rec.introQueue).toHaveLength(1)
    expect(takeIntroQueue(rec)).toEqual([{ a: 'a', b: 'b', at: 10 }])
    expect(rec.introQueue).toBeUndefined()
  })
  it('refuses what introduceBlock refuses', () => {
    const rec = { people: [P('a'), P('b', { blocked: 1 })], peers }
    expect(queueIntro(rec, 'a', 'b', 1)).toEqual({ ok: false, reason: 'blocked' })
    expect(queueIntro(rec, 'a', 'zz', 1)).toEqual({ ok: false, reason: 'unknown' })
  })
})

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bubbleTools } from '../../../mcp/src/bubble_tools.ts'

describe('MCP introduce_people', () => {
  const setup = () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-bub-')), 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, people: [P('a'), P('b'), P('c', { peerId: undefined })], peers }))
    return file
  }
  it('is offered only with writes on', () => expect(bubbleTools({ file: 'x', write: false })).toEqual([]))
  it('queues the introduction in the record and refuses what the sheet refuses', () => {
    const file = setup()
    const [tool] = bubbleTools({ file, write: true, now: () => new Date(5) })
    expect(tool.name).toBe('introduce_people')
    expect(tool.run({ a: 'a', b: 'b' })).toEqual({ queued: true })
    expect(JSON.parse(readFileSync(file, 'utf8')).introQueue).toEqual([{ a: 'a', b: 'b', at: 5 }])
    expect(() => tool.run({ a: 'a', b: 'c' })).toThrow('not-connected')
    expect(() => tool.run({ a: 'a' })).toThrow('required')
  })
})

import { connectLinkOf } from '../../src/add_by_code.ts'

describe('an introduced connect link', () => {
  it('is flagged when read from the address, a plain one is not', () => {
    expect(connectLinkOf('?connect=did%3Apeer%3A2.b&id=peer-b&name=Ben&acq=1')).toMatchObject({ did: 'did:peer:2.b', introduced: true })
    expect(connectLinkOf('?connect=did%3Apeer%3A2.b&id=peer-b&name=Ben')?.introduced).toBeUndefined()
  })
})
