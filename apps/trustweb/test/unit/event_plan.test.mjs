// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 community-event: the event assembler, sign-up sheet, roles, resource asks and the celebration gate. */
import {
  EVENT_TEMPLATE, templatePrompt, buildEvent, signUp, leaveSignup, addRole, takeRole, askResource, coverResource, resourceSummary,
  setInvitees, celebrationVisible, eventAudience, queueResourceAsk, setDoc,
} from '../../src/event_plan.ts'

const P = (id, name, ring, fields = {}, peerId = `peer-${id}`, did) => ({ id, name, ring, fields, ...(peerId ? { peerId } : {}), ...(did ? { did } : {}) })
const ev0 = () => buildEvent({ name: 'Summer fest', from: '2027-06-01', where: 'Garden', community: 'iyg' }, 'e1', 5)

describe('template and prompt', () => {
  it('lists the six documents an event needs, in order', () => {
    expect(EVENT_TEMPLATE).toEqual(['description', 'dateplace', 'signup', 'roles', 'resources', 'followup'])
  })
  it('the prompt names the community and every document and asks for tw-actions cards', () => {
    const t = templatePrompt('IYG circle')
    expect(t).toContain('IYG circle')
    for (const d of ['description', 'sign-up', 'roles', 'resource', 'follow-up']) expect(t.toLowerCase()).toContain(d)
    expect(t).toContain('event-create')
  })
})

describe('buildEvent', () => {
  it('makes an empty sheet for a community, attended, with no sign-ups', () => {
    expect(ev0()).toMatchObject({ id: 'e1', name: 'Summer fest', from: '2027-06-01', where: 'Garden', community: 'iyg', attended: true, signup: [], roles: [], resources: [] })
  })
  it('refuses an empty name or a bad date', () => {
    expect(() => buildEvent({ name: ' ', from: '2027-06-01' }, 'x', 1)).toThrow(/name/)
    expect(() => buildEvent({ name: 'a', from: '1.6.' }, 'x', 1)).toThrow(/date/)
  })
  it('setDoc keeps a description and a follow-up note; other kinds are refused', () => {
    const e = ev0()
    setDoc(e, 'description', ' Come! ')
    setDoc(e, 'followup', 'Thanks')
    expect(e.docs).toEqual({ description: 'Come!', followup: 'Thanks' })
    expect(() => setDoc(e, 'signup', 'x')).toThrow(/document/)
  })
})

describe('sign-up sheet and roles', () => {
  it('one tap joins, a second tap changes nothing, leave removes', () => {
    const e = ev0()
    expect(signUp(e, 'me')).toBe(true)
    expect(signUp(e, 'me')).toBe(false)
    expect(e.signup).toEqual(['me'])
    expect(leaveSignup(e, 'me')).toBe(true)
    expect(e.signup).toEqual([])
  })
  it('roles are named slots; a slot is taken by one person, a name is not added twice', () => {
    const e = ev0()
    expect(addRole(e, 'Sound')).toBe(true)
    expect(addRole(e, 'sound')).toBe(false)
    expect(takeRole(e, 'Sound', 'p1')).toBe(true)
    expect(takeRole(e, 'Sound', 'p2')).toBe(false)
    expect(e.roles).toEqual([{ name: 'Sound', who: 'p1' }])
    expect(() => takeRole(e, 'Cook', 'p1')).toThrow(/role/)
  })
})

describe('resource asks', () => {
  it('a resource is open until a member says "I bring it"; the asker sees the aggregate and the volunteer', () => {
    const e = ev0()
    const r = askResource(e, 'Loudspeaker', 'r1')
    expect(r).toMatchObject({ id: 'r1', text: 'Loudspeaker' })
    expect(resourceSummary(e)).toEqual({ open: 1, covered: 0 })
    expect(coverResource(e, 'r1', 'p3')).toBe(true)
    expect(coverResource(e, 'r1', 'p4')).toBe(false)
    expect(resourceSummary(e)).toEqual({ open: 0, covered: 1 })
    expect(e.resources[0].by).toBe('p3')
    expect(() => coverResource(e, 'nope', 'p3')).toThrow(/resource/)
  })
  it('empty text is refused', () => { expect(() => askResource(ev0(), '  ', 'r')).toThrow(/text/) })
  it('audience = connected community members at Friends or closer, plus the Closest few', () => {
    const people = [P('a', 'Ada', 'closest'), P('b', 'Ben', 'close', { iyg: 'true' }), P('c', 'Cleo', 'acquaintance', { iyg: 'true' }), P('d', 'Dan', 'friend', {}), P('e', 'Eve', 'friend', { iyg: 'true' }, null)]
    expect(eventAudience(people, 'iyg').sort()).toEqual(['peer-a', 'peer-b'])
  })
  it('queueResourceAsk writes one queued support ask (the app sends it) and names the event and the thing', () => {
    const e = ev0()
    const r = askResource(e, 'Loudspeaker', 'r1')
    const rec = { people: [P('a', 'Ada', 'closest'), P('b', 'Ben', 'close', { iyg: 'true' })], supportAsks: [] }
    const ask = queueResourceAsk(rec, e, r, Date.parse('2026-11-12T10:00:00Z'), 'ask1')
    expect(ask).toMatchObject({ id: 'ask1', queued: true, to: ['peer-a', 'peer-b'], here: [], chips: [] })
    expect(ask.note).toContain('Summer fest')
    expect(ask.note).toContain('Loudspeaker')
    expect(ask.note.length).toBeLessThanOrEqual(200)
    expect(ask.until).toBeGreaterThan(Date.parse('2026-11-12T10:00:00Z'))
    expect(rec.supportAsks).toHaveLength(1)
  })
  it('nobody to ask: refused, nothing queued', () => {
    const e = ev0()
    const rec = { people: [], supportAsks: [] }
    expect(() => queueResourceAsk(rec, e, askResource(e, 'x', 'r'), 1, 'a')).toThrow(/nobody/)
    expect(rec.supportAsks).toHaveLength(0)
  })
})

describe('celebration gate (P04)', () => {
  const e = () => { const x = ev0(); setInvitees(x, ['did:a']); return x }
  it('an event without a celebration shows none to anybody', () => {
    expect(celebrationVisible(ev0(), 'did:a')).toBe(false)
    expect(celebrationVisible(undefined, 'did:a')).toBe(false)
  })
  it('an invited person sees it, a stranger or a person with no identity does not, no teaser', () => {
    const x = Object.assign(e(), { fromLink: true })
    expect(celebrationVisible(x, 'did:a')).toBe(true)
    expect(celebrationVisible(x, 'did:z')).toBe(false)
    expect(celebrationVisible(x, undefined)).toBe(false)
  })
  it('the owner of the event (not joined by link) sees it', () => { expect(celebrationVisible(e(), undefined)).toBe(true) })
  it('invitees are de-duplicated, blanks dropped', () => {
    const x = ev0()
    setInvitees(x, ['did:a', ' ', 'did:a', 'did:b'])
    expect(x.invitees).toEqual(['did:a', 'did:b'])
  })
})
