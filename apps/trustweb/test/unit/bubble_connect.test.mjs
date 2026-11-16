// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-bubble-connect: a short hold of one bubble on another introduces them, a long hold merges (bubble_connect.ts). */
import { HOLD_MS, holdStart, holdStep } from '../../src/dot_merge.ts'
import { INTRODUCE_MIN_MS, MERGE_HOLD_MS, addOnce, holdProgress, introduceBlock, queueIntro, releaseOutcome, takeById, takeIntroQueue } from '../../src/bubble_connect.ts'
import { INTRODUCED_RING, codeText, introducedRing, requestText } from '../../src/bubble_links.ts'
import { gateText, parseGateText } from '../../src/bubble_gate.ts'
import { TextKind, routeText } from '../../src/chat.ts'

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

describe('the acceptance gate texts (requester = dragged, acceptor = dropped onto)', () => {
  const app = 'https://app.test/'
  const req = requestText(app, 'i1', P('a'), peers)
  it('the request to the acceptor carries the REQUESTER\'s name and code, marked as an introduction', () => {
    expect(parseGateText(app, req)).toMatchObject({ k: 'req', id: 'i1', name: 'Ada' })
    expect(parseGateText(app, req).link).toContain(encodeURIComponent('did:peer:2.a'))
    expect(parseGateText(app, req).link).toContain('acq=1')
    expect(req).not.toContain(encodeURIComponent('did:peer:2.b'))
    expect(routeText(app, req)).toBe(TextKind.Intro)
  })
  it('ok / no round-trip; garbage is ignored', () => {
    for (const k of ['ok', 'no']) expect(parseGateText(app, gateText(app, { k, id: 'i1' }))).toEqual({ k, id: 'i1' })
    expect(parseGateText(app, `${app}?introduce=1#k=ok&i=${'x'.repeat(40)}`)).toBeNull()
    expect(parseGateText(app, `${app}?introduce=1#k=req&i=i1&n=Ada&c=https%3A%2F%2Fevil.test%2F%3Fconnect%3Dx`)).toBeNull()
    expect(routeText(app, `${app}?introduce=1#k=zz`)).toBe(TextKind.Ignore)
  })
  it('says so when a request would not fit a chat message', () => {
    expect(requestText(app, 'i1', P('a'), [{ id: 'peer-a', did: 'did:peer:2.' + 'a'.repeat(600), displayName: 'Ada' }])).toBeNull()
  })
  it('the requester gets the ACCEPTOR\'s code after the yes, naming the introducer', () => {
    const t = codeText(app, P('b'), peers, 'Jakob')
    expect(t).toContain(encodeURIComponent('did:peer:2.b'))
    expect(t).toContain('acq=1')
    expect(t).toContain('Jakob')
    expect(t.length).toBeLessThanOrEqual(500)
    expect(codeText(app, P('b'), peers, 'J'.repeat(600))).toBeNull()
  })
  it('an introduced link is read as acquainted community member (Friends zone), a plain one is not', () => {
    expect(INTRODUCED_RING).toBe('friend')
    expect(introducedRing('?connect=x&id=1&name=B&acq=1')).toBe('friend')
    expect(introducedRing('?connect=x&id=1&name=B')).toBeNull()
  })
})

describe('pending and inbox', () => {
  it('addOnce keeps the first of an id, takeById removes exactly it', () => {
    const rec = {}
    expect(addOnce(rec, 'introPending', { id: 'x', requester: 'a', acceptor: 'b', at: 1 })).toBe(true)
    expect(addOnce(rec, 'introPending', { id: 'x', requester: 'a', acceptor: 'c', at: 2 })).toBe(false)
    expect(takeById(rec, 'introPending', 'zz')).toBeUndefined()
    expect(takeById(rec, 'introPending', 'x')).toMatchObject({ acceptor: 'b' })
    expect(rec.introPending).toBeUndefined()
  })
})

describe('MCP queue (direction matters)', () => {
  it('queues requester -> acceptor once; the reverse direction is another introduction', () => {
    const rec = { people: [P('a'), P('b')], peers }
    expect(queueIntro(rec, 'a', 'b', 10)).toEqual({ ok: true })
    expect(queueIntro(rec, 'a', 'b', 11)).toEqual({ ok: true, already: true })
    expect(queueIntro(rec, 'b', 'a', 12)).toEqual({ ok: true })
    expect(takeIntroQueue(rec)).toEqual([{ requester: 'a', acceptor: 'b', at: 10 }, { requester: 'b', acceptor: 'a', at: 12 }])
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
    expect(tool.run({ requester: 'a', acceptor: 'b' })).toEqual({ queued: true })
    expect(JSON.parse(readFileSync(file, 'utf8')).introQueue).toEqual([{ requester: 'a', acceptor: 'b', at: 5 }])
    expect(() => tool.run({ requester: 'a', acceptor: 'c' })).toThrow('not-connected')
    expect(() => tool.run({ requester: 'a' })).toThrow('required')
  })
})

import { connectLinkOf } from '../../src/add_by_code.ts'

describe('an introduced connect link', () => {
  it('is flagged when read from the address, a plain one is not', () => {
    expect(connectLinkOf('?connect=did%3Apeer%3A2.b&id=peer-b&name=Ben&acq=1')).toMatchObject({ did: 'did:peer:2.b', introduced: true })
    expect(connectLinkOf('?connect=did%3Apeer%3A2.b&id=peer-b&name=Ben')?.introduced).toBeUndefined()
  })
})
