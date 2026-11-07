// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Event desires and memories (src/ext/co_notes/co_desires.ts): per-person blocks, own-lines-only editing, share cycle, Combine prompt and write-back.
import { canEdit, combine, combinePrompt, cycleShare, desiresDoc, ensureMine, applyCombined, mineId, SHARE_LABELS } from '../../src/ext/co_notes/co_desires.ts'
import { insertAfter, indent, merge, setShare, tree, remove } from '../../src/ext/co_notes/co_doc.ts'
import { forSend } from '../../src/ext/co_notes/co_links.ts'

const A = { did: 'did:key:zAnna0000001', name: 'Anna' }
const B = { did: 'did:key:zBen000000002', name: 'Ben' }
const T = 1_800_000_000_000
const EV = { id: 'ev1', name: 'Retreat' }
const doc = () => desiresDoc({ kind: 'desires', ev: EV, me: A, others: [B], at: T })

/** A writes a wish under their header with the given share. */
function wish(d, me, text, share) {
  const hdr = ensureMine(d, me, T)
  const kids = tree(hdr.doc).filter((r) => r.depth === 1)
  const after = kids.length ? kids[kids.length - 1].id : hdr.id
  const ins = insertAfter(hdr.doc, after, text, me, T, { share })
  return kids.length ? ins.doc : indent(ins.doc, ins.id, me)
}

describe('desires doc', () => {
  it('is deterministic per event and kind, with me and the others as people', () => {
    const d = doc()
    expect(d.id).toBe('desires-ev1')
    expect(d).toMatchObject({ kind: 'desires', eventId: 'ev1', title: 'Desires: Retreat' })
    expect(d.people.map((p) => p.did)).toEqual([A.did, B.did])
    expect(desiresDoc({ kind: 'memories', ev: EV, me: A, others: [], at: T })).toMatchObject({ id: 'memories-ev1', title: 'Memories: Retreat' })
  })

  it('ensureMine creates my chip block once and shares it with the event', () => {
    const first = ensureMine(doc(), A, T)
    const again = ensureMine(first.doc, A, T)
    expect(again.id).toBe(first.id)
    expect(again.doc).toBe(first.doc)
    const row = tree(first.doc)[0]
    expect(row).toMatchObject({ depth: 0, text: `@[Anna](${A.did})`, share: 'event' })
    expect(first.id.length).toBeLessThanOrEqual(40)
  })

  it('two phones creating their header independently merge without duplicates', () => {
    const merged = merge(ensureMine(doc(), A, T).doc, ensureMine(doc(), B, T).doc)
    expect(tree(merged).map((r) => r.text).sort()).toEqual([`@[Anna](${A.did})`, `@[Ben](${B.did})`].sort())
    expect(merge(merged, ensureMine(merged, A, T).doc).blocks.length).toBe(merged.blocks.length)
  })
})

describe('canEdit', () => {
  it('only my own blocks in a desires or memories doc; any block in a plain note', () => {
    const d = wish(doc(), A, 'sauna', 'me')
    const mine = d.blocks.find((b) => b.text === 'sauna')
    expect(canEdit(d, mine, A)).toBe(true)
    expect(canEdit(d, mine, B)).toBe(false)
    expect(canEdit(d, mine.id, B)).toBe(false)
    expect(canEdit({ ...d, kind: undefined }, mine, B)).toBe(true)
    expect(canEdit({ ...d, kind: 'memories' }, mine, B)).toBe(false)
    expect(canEdit(d, 'nope', A)).toBe(false)
  })
})

describe('share chip', () => {
  it('cycles me -> event -> zones -> me, labelled in plain words', () => {
    expect(cycleShare('me')).toBe('event')
    expect(cycleShare('event')).toBe('zones')
    expect(cycleShare('zones')).toBe('me')
    expect(cycleShare(undefined)).toBe('event')
    expect(SHARE_LABELS).toEqual({ me: 'Only me', event: 'People at this event', zones: 'My trust zones' })
  })

  it('lines at "me" never leave the device, lines at event and zones do', () => {
    let d = wish(doc(), A, 'secret', 'me')
    d = wish(d, A, 'sauna', 'event')
    d = wish(d, A, 'hike', 'zones')
    const sent = forSend(d).blocks.map((b) => b.text)
    expect(sent).toContain('sauna')
    expect(sent).toContain('hike')
    expect(sent).not.toContain('secret')
    d = setShare(d, d.blocks.find((b) => b.text === 'secret').id, 'event', A)
    expect(forSend(d).blocks.map((b) => b.text)).toContain('secret')
  })
})

const setup = () => {
  let d = doc()
  d = wish(d, A, 'a secret wish', 'me')
  d = wish(d, A, 'sauna every day', 'event')
  d = wish(d, A, 'quiet mornings', 'zones')
  // Ben's lines arrive as sent: his 'me' line never reaches this phone.
  let theirs = wish(doc(), B, 'long hikes', 'event')
  theirs = wish(theirs, B, 'no phones at dinner', 'zones')
  theirs = wish(theirs, B, 'ben private', 'me')
  return merge(d, forSend(theirs))
}

describe('combinePrompt', () => {
  it('holds only event and zones lines, grouped per person name', () => {
    const p = combinePrompt(setup())
    expect(p.user).toContain('Anna')
    expect(p.user).toContain('Ben')
    expect(p.user).toContain('sauna every day')
    expect(p.user).toContain('quiet mornings')
    expect(p.user).toContain('long hikes')
    expect(p.user.indexOf('long hikes')).toBeGreaterThan(p.user.indexOf('Ben:'))
    const anna = p.user.split('\n\n').find((g) => g.startsWith('Anna:'))
    expect(anna).toContain('quiet mornings')
    expect(anna).not.toContain('long hikes')
  })

  it('never holds my "me" lines, other people\'s "me" lines, tombstones or earlier AI answers', () => {
    let d = setup()
    const gone = wish(d, A, 'tombstoned wish', 'event')
    d = remove(gone, gone.blocks.find((b) => b.text === 'tombstoned wish').id, A)
    d = applyCombined(d, A, '- earlier ai point', 'm', T)
    const { user, system } = combinePrompt(d)
    for (const bad of ['a secret wish', 'ben private', 'tombstoned wish', 'earlier ai point']) {
      expect(user).not.toContain(bad)
      expect(system).not.toContain(bad)
    }
  })

  it('a line under a "me" parent stays out', () => {
    let d = wish(doc(), A, 'parent', 'me')
    const parent = d.blocks.find((b) => b.text === 'parent')
    const kid = insertAfter(d, parent.id, 'child of private', A, T, { share: 'event' })
    d = indent(kid.doc, kid.id, A)
    expect(combinePrompt(d)).toBeNull()
  })

  it('is null when nothing is shared; system prompt asks for one plan, honoured wishes, plain tensions, no invented wishes', () => {
    expect(combinePrompt(wish(doc(), A, 'only me', 'me'))).toBeNull()
    const { system } = combinePrompt(setup())
    expect(system).toMatch(/one plan/i)
    expect(system).toMatch(/whose wishes/i)
    expect(system).toMatch(/tension/i)
    expect(system).toMatch(/do not invent|no new wishes/i)
  })

  it('degrades chips in lines to the plain name', () => {
    const d = wish(doc(), A, 'dinner with @[Ben](did:key:zBen000000002)', 'event')
    expect(combinePrompt(d).user).toContain('dinner with @Ben')
  })
})

describe('applyCombined', () => {
  it('adds one AI block, shared with the event, with the answer as children without list markers', () => {
    const d = applyCombined(setup(), A, '- Sauna daily (Anna)\n* Hikes (Ben)\n1. Tension: noise\n\n  • quiet', 'qwen', T)
    const rows = tree(d)
    const head = rows.find((r) => r.text.startsWith('Combined by my AI'))
    expect(head).toMatchObject({ depth: 0, ai: true, share: 'event' })
    expect(head.text).toBe('Combined by my AI (qwen, 15 Jan 2027)')
    const kids = rows.slice(rows.indexOf(head) + 1)
    expect(kids.map((r) => r.text)).toEqual(['Sauna daily (Anna)', 'Hikes (Ben)', 'Tension: noise', 'quiet'])
    expect(kids.every((r) => r.depth === 1 && r.ai && r.share === 'event')).toBe(true)
    expect(forSend(d).blocks.some((b) => b.text.startsWith('Combined'))).toBe(true)
  })
})

describe('combine (injected fetch)', () => {
  const AI = { preset: 'custom', baseUrl: 'http://x.invalid/v1', apiKey: '', model: 'qwen' }
  const reply = (text) => async (_url, init) => { reply.body = init.body; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) } }

  it('sends only shared lines to the configured endpoint and writes the answer back', async () => {
    const out = await combine(setup(), A, AI, reply('- one plan'), T)
    expect(reply.body).toContain('sauna every day')
    expect(reply.body).not.toContain('a secret wish')
    expect(reply.body).not.toContain('ben private')
    expect(tree(out).some((r) => r.text === 'one plan' && r.ai)).toBe(true)
  })

  it('does not call the endpoint when nothing is shared', async () => {
    let called = false
    const out = await combine(wish(doc(), A, 'x', 'me'), A, AI, async () => { called = true; return { ok: true, status: 200, json: async () => ({}) } }, T)
    expect(out).toBeNull()
    expect(called).toBe(false)
  })

  it('lets an endpoint error through', async () => {
    await expect(combine(setup(), A, AI, async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }), T)).rejects.toThrow('boom')
  })
})

describe('review fixes (wave36b event-desires): name blocks of real identities', () => {
  it('two people on the same relay get different name blocks (a did:peer:2 ends with the shared relay address)', async () => {
    const { createIdentity } = await import('../../../demo/src/did.ts')
    const a = { did: createIdentity('https://x.invalid/relay').did, name: 'Anna' }
    const b = { did: createIdentity('https://x.invalid/relay').did, name: 'Ben' }
    expect(mineId(a)).not.toBe(mineId(b))
    expect(mineId(a)).toBe(mineId({ ...a, name: 'Anna on her laptop' }))
    expect(mineId(a).length).toBeLessThanOrEqual(40)
    let d = desiresDoc({ kind: 'desires', ev: EV, me: a, others: [b], at: T })
    d = ensureMine(d, a, T).doc
    const theirs = ensureMine(d, b, T).doc
    expect(tree(merge(d, theirs)).filter((r) => r.depth === 0).map((r) => r.by.name).sort()).toEqual(['Anna', 'Ben'])
  })
})
