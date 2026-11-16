// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker: the "+" on Members offers the people I know (no assistant gate), tag applied; a person's QR is bound to exactly that person. */
import { readFileSync } from 'node:fs'
import { Ring } from '../../src/model.ts'
import { identifyRows } from '../../src/event_person_picker.ts'
import { memberExclude, addKnownMembers } from '../../src/member_picker.ts'
import { personQrLink, personQrTarget } from '../../src/person_qr_link.ts'
import { mode, decodeModeLink } from '../../src/qr_modes.ts'
import { S } from '../../src/strings.ts'

const person = (id, name, extra = {}) => ({ id, name, context: '', ring: Ring.Friend, metAt: 1, lines: [], ...extra })
const people = () => [person('a', 'Anna Gruber', { fields: { iyg: 'true' } }), person('b', 'Ben Huber'), person('c', 'Clara Moser'), person('d', 'Dora Gone', { deleted_at: '2026-01-01' })]

describe('member picker', () => {
  it('lists the people I know that do not carry the tag yet (not the members, not the deleted)', () => {
    const ex = memberExclude(people(), 'iyg')
    expect(ex).toEqual(['a'])
    expect(identifyRows(people(), 'moser', ex).filter((r) => 'id' in r).map((r) => r.id)).toEqual(['c'])
    expect(identifyRows(people(), 'gone', ex).some((r) => 'id' in r)).toBe(false)
    expect(identifyRows(people(), 'anna', ex).some((r) => 'id' in r && r.id === 'a')).toBe(false)
  })
  it('picking applies the community tag; a second pick of the same person adds nothing', () => {
    const p = people()
    expect(addKnownMembers(p, ['b', 'c'], 'iyg')).toBe(2)
    expect(p[1].fields).toEqual({ iyg: 'true' })
    expect(addKnownMembers(p, ['b'], 'iyg')).toBe(0)
  })
  it('add-new row text exists; the + path has no assistant gate', () => {
    expect(typeof S.w44pp.addNew).toBe('string')
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    const at = main.indexOf("twBus.on('add-member'")
    expect(at).toBeGreaterThan(0)
    const block = main.slice(at, main.indexOf('\n})', at))
    expect(block).not.toMatch(/assistant|chainOf|sparkle/i)
    const view = readFileSync(new URL('../../src/member_picker_view.ts', import.meta.url), 'utf8')
    expect(view).not.toMatch(/assistant|chainOf|sparkleFallback/i)
  })
})

describe('person-bound QR', () => {
  const base = 'https://app.example/#c=abc'
  it('the link carries the person (did when known, else the id), and a scanner can read it back', () => {
    const l = personQrLink(base, { id: 'p1', did: 'did:key:z6Mk1' })
    expect(personQrTarget(l)).toBe('did:key:z6Mk1')
    expect(personQrTarget(personQrLink('https://app.example/c/xyz', { id: 'p9' }))).toBe('p9')
    expect(personQrTarget(base)).toBeNull()
  })
  it('two people give two different links; the own generic link is not the payload', () => {
    const a = personQrLink(base, { id: 'p1' }), b = personQrLink(base, { id: 'p2' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(base)
  })
  it('survives the person QR mode (m=person fragment) and still decodes', () => {
    const l = personQrLink(base, { id: 'p1' })
    const m = mode({ kind: 'person', link: l, name: 'Anna', username: 'anna' }, ['username'])
    expect(personQrTarget(m.payload)).toBe('p1')
    expect(decodeModeLink(m.payload)).toMatchObject({ kind: 'person', username: 'anna' })
  })
  it('title words', () => { expect(S.w44pp.connectWith('Anna')).toBe('Connect with Anna') })
})

describe('MCP parity', () => {
  it('person_qr_target is listed (read) and binds to the person; community_add_member exists for the tag', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const { recordTools } = await import('../../../mcp/src/record_tools.ts')
    const { MCP_TOOLS } = await import('../../src/ext/mcp-local/mcp_config.ts')
    for (const n of ['person_qr_target', 'community_add_member']) expect(MCP_TOOLS.map((t) => t.name)).toContain(n)
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-pp-')), 'r.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { displayName: 'J' }, peers: [{ id: 'pe1', did: 'did:key:zX' }], people: [{ ...person('a', 'Anna Gruber'), peerId: 'pe1' }, person('b', 'Ben Huber')], sameAs: {}, meetings: [] }))
    const by = Object.fromEntries(recordTools({ file, write: false, now: () => new Date() }).map((t) => [t.name, t]))
    expect(by.person_qr_target.run({ person: 'Anna Gruber' })).toMatchObject({ id: 'a', target: 'did:key:zX', title: 'Connect with Anna Gruber', fragment: 'to=did%3Akey%3AzX&for=Anna+Gruber' })
    expect(by.person_qr_target.run({ person: 'b' }).target).toBe('b')
  })
})
