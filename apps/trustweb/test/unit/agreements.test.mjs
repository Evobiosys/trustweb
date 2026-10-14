/** Agreements per person (src/agreements.ts, wave 7): local lines, the proposal/accept texts, and that nothing else carries them. */
import {
  AgreementStatus, acceptAgreement, acceptText, addAgreement, isExpired, parseAgreementText, proposalText, receiveAgreement, removeAgreement, repairAgreements,
} from '../../src/agreements.ts'
import { routeText, TextKind } from '../../src/chat.ts'
import { askSources } from '../../src/cascade.ts'
import { Ring } from '../../src/model.ts'

const APP = 'https://app.trustintheweb.org/'
const NOW = 1_800_000_000_000

describe('local agreements', () => {
  it('adds mine, or proposed, dated, bounded; refuses empty, duplicate id and a bad id', () => {
    const p = {}
    expect(addAgreement(p, 'a1', '  Call only for urgent things ', NOW)).toMatchObject({ status: 'mine', at: NOW, text: 'Call only for urgent things' })
    expect(addAgreement(p, 'a2', 'Weekly check-in', NOW, { proposed: true, expiresAt: NOW + 5 })).toMatchObject({ status: 'proposed', expiresAt: NOW + 5 })
    expect(addAgreement(p, 'a1', 'dup', NOW)).toBeNull()
    expect(addAgreement(p, 'a3', '   ', NOW)).toBeNull()
    expect(addAgreement(p, 'a b', 'x', NOW)).toBeNull()
    expect(addAgreement(p, 'a4', 'x'.repeat(500), NOW).text).toHaveLength(200)
    removeAgreement(p, 'a1')
    expect(p.agreements.map((a) => a.id)).toEqual(['a2', 'a4'])
  })
  it('expires on its date', () => {
    expect(isExpired({ expiresAt: NOW }, NOW)).toBe(true)
    expect(isExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false)
    expect(isExpired({}, NOW)).toBe(false)
  })
})

describe('the channel', () => {
  it('a proposal round-trips with its marker and expiry, and routes as Agreement, never chat', () => {
    const a = { id: 'x1', text: 'Ümlaut & "quotes" ?#', at: NOW, status: 'proposed', expiresAt: NOW + 9 }
    const t = proposalText(APP, a)
    expect(routeText(APP, t)).toBe(TextKind.Agreement)
    expect(parseAgreementText(APP, t)).toEqual({ kind: 'propose', id: 'x1', text: a.text, expiresAt: NOW + 9 })
    expect(parseAgreementText(APP, acceptText(APP, 'x1'))).toEqual({ kind: 'accept', id: 'x1' })
  })
  it.each([
    ['another prefix', 'https://evil.example/?agree=1#id=a&t=x'], ['no id', `${APP}?agree=1#t=x`], ['a bad id', `${APP}?agree=1#id=a%20b&t=x`],
    ['no text', `${APP}?agree=1#id=a`], ['hidden text only', `${APP}?agree=1#id=a&t=%E2%80%AE`], ['too long', `${APP}?agree=1#id=a&t=${'x'.repeat(600)}`], ['a number', 7],
  ])('reads nothing from %s, without throwing', (_n, text) => {
    expect(parseAgreementText(APP, text)).toBeNull()
    if (typeof text === 'string' && text.startsWith(APP)) expect(routeText(APP, text)).toBe(TextKind.Ignore)
  })
  it('proposal -> incoming (once) -> my Accept makes it mutual; their accept makes mine mutual', () => {
    const mine = {}
    const theirs = {}
    const a = addAgreement(mine, 'p1', 'No calls after 21:00', NOW, { proposed: true })
    expect(receiveAgreement(theirs, parseAgreementText(APP, proposalText(APP, a)), NOW + 1)).toBe(true)
    expect(receiveAgreement(theirs, parseAgreementText(APP, proposalText(APP, a)), NOW + 2)).toBe(false)
    expect(theirs.agreements[0]).toMatchObject({ id: 'p1', status: AgreementStatus.Incoming })
    expect(acceptAgreement(theirs, 'p1')).toBe(true)
    expect(acceptAgreement(theirs, 'p1')).toBe(false)
    expect(receiveAgreement(mine, parseAgreementText(APP, acceptText(APP, 'p1')), NOW + 3)).toBe(true)
    expect(mine.agreements[0].status).toBe('mutual')
  })
  it('an accept only touches a line I proposed: not a mine-only one, not an unknown id', () => {
    const p = {}
    addAgreement(p, 'm1', 'private', NOW)
    expect(receiveAgreement(p, { kind: 'accept', id: 'm1' }, NOW)).toBe(false)
    expect(receiveAgreement(p, { kind: 'accept', id: 'zz' }, NOW)).toBe(false)
    expect(p.agreements[0].status).toBe('mine')
  })
})

describe('record', () => {
  it('repairs malformed agreements', () => {
    const state = { people: [{ agreements: [{ id: 'a', text: 'ok', at: 1, status: 'mine' }, { id: 'a', text: 'dup', at: 1, status: 'mine' }, { id: 'b', text: 'x', at: 1, status: 'odd' }, null] }, { agreements: 'x' }, {}] }
    expect(repairAgreements(state)).toBe(true)
    expect(state.people[0].agreements.map((a) => a.id)).toEqual(['a'])
    expect('agreements' in state.people[1]).toBe(false)
    expect(repairAgreements(state)).toBe(false)
  })
  it('never reaches the matcher input (I1, I8)', () => {
    const state = {
      inventory: [],
      people: [{ id: 'p', name: 'Ben', context: '', ring: Ring.Close, metAt: 0, lines: [], agreements: [{ id: 'a', text: 'SECRET-AGREEMENT', at: 1, status: 'mine' }], theirProfile: { norms: [], intro: 'SECRET-INTRO', at: 1 } }],
      peers: [], log: [],
    }
    const { threads } = askSources(state, Ring.Close, 0)
    expect(JSON.stringify(threads)).not.toMatch(/SECRET/)
  })
})
