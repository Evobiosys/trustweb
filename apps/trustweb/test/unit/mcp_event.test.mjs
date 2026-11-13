// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 community-event: the MCP tools event_create, event_signup, event_resource_ask / cover, event_invitees_set. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const P = (id, name, ring, fields = {}, did) => ({ id, name, context: '', ring, metAt: 0, lines: [], fields, peerId: `peer-${id}`, ...(did ? { did } : {}) })
const base = () => ({ v: 1, people: [P('a', 'Ada', 'closest', {}, 'did:ada'), P('b', 'Ben', 'close', { iyg: 'true' }, 'did:ben'), P('c', 'Cleo', 'friend', { iyg: 'true' })], sameAs: {}, meetings: [],
  extData: { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], name: 'IYG circle' } } } } })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpe-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-12T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}
const TPL = { name: 'Summer fest', from: '2027-06-01', where: 'Garden', description: 'A party', roles: ['Sound', 'Cook'], resources: ['Tables'], followup: 'Thanks all' }

describe('event tools', () => {
  it('are changes: only offered with writes on', () => {
    const off = Object.keys(fixture(false).by)
    for (const n of ['event_create', 'event_signup', 'event_resource_ask', 'event_resource_cover', 'event_invitees_set']) { expect(off).not.toContain(n); expect(Object.keys(fixture().by)).toContain(n) }
  })
  it('event_create builds the whole sheet from a template inside a community', () => {
    const f = fixture()
    const out = f.by.event_create.run({ community: 'iyg', template: TPL })
    expect(out).toMatchObject({ name: 'Summer fest', roles: 2, resources: 1 })
    expect(f.rec().events[0]).toMatchObject({ community: 'iyg', from: '2027-06-01', where: 'Garden', docs: { description: 'A party', followup: 'Thanks all' }, signup: [], roles: [{ name: 'Sound' }, { name: 'Cook' }], resources: [{ text: 'Tables' }] })
  })
  it('event_create refuses an unknown community or a bad template', () => {
    const f = fixture()
    expect(() => f.by.event_create.run({ community: 'nope', template: TPL })).toThrow(/no community/)
    expect(() => f.by.event_create.run({ community: 'iyg', template: { name: '', from: '2027-06-01' } })).toThrow(/name/)
    expect(() => f.by.event_create.run({ community: 'iyg', template: { name: 'x', from: 'soon' } })).toThrow(/date/)
  })
  it('event_signup joins once (by id or exact name)', () => {
    const f = fixture()
    const { id } = f.by.event_create.run({ community: 'iyg', template: TPL })
    expect(f.by.event_signup.run({ event: id })).toMatchObject({ joined: true, signups: 1 })
    expect(f.by.event_signup.run({ event: 'summer fest' })).toMatchObject({ joined: false, signups: 1 })
    expect(f.rec().events[0].signup).toEqual(['me'])
  })
  it('event_resource_ask adds the resource and queues one support ask to the community; ask:false only adds', () => {
    const f = fixture()
    const { id } = f.by.event_create.run({ community: 'iyg', template: { name: 'Fest', from: '2027-06-01' } })
    const out = f.by.event_resource_ask.run({ event: id, text: 'Loudspeaker' })
    expect(out).toMatchObject({ asked: 3, queued: true })
    const r = f.rec()
    expect(r.events[0].resources).toEqual([{ id: out.resource, text: 'Loudspeaker' }])
    expect(r.supportAsks).toHaveLength(1)
    expect(r.supportAsks[0]).toMatchObject({ queued: true, agent: true, to: ['peer-a', 'peer-b', 'peer-c'] })
    expect(f.by.event_resource_ask.run({ event: id, text: 'Cables', ask: false })).toMatchObject({ asked: 0, queued: false })
    expect(f.rec().supportAsks).toHaveLength(1)
  })
  it('event_resource_cover: "I bring it" once; the second volunteer is told it is covered', () => {
    const f = fixture()
    const { id } = f.by.event_create.run({ community: 'iyg', template: { name: 'Fest', from: '2027-06-01', resources: ['Tables'] } })
    const rid = f.rec().events[0].resources[0].id
    expect(f.by.event_resource_cover.run({ event: id, resource: rid })).toMatchObject({ covered: true, open: 0 })
    expect(f.by.event_resource_cover.run({ event: id, resource: rid })).toMatchObject({ covered: false })
    expect(f.rec().events[0].resources[0].by).toBe('me')
    expect(() => f.by.event_resource_cover.run({ event: id, resource: 'zz' })).toThrow(/resource/)
  })
  it('event_invitees_set stores the identities of the people named; a person without identity is refused', () => {
    const f = fixture()
    const { id } = f.by.event_create.run({ community: 'iyg', template: { name: 'Fest', from: '2027-06-01' } })
    expect(f.by.event_invitees_set.run({ event: id, people: ['Ada', 'b'] })).toMatchObject({ invitees: 2 })
    expect(f.rec().events[0]).toMatchObject({ invitees: ['did:ada', 'did:ben'], celebration: true })
    expect(() => f.by.event_invitees_set.run({ event: id, people: ['Cleo'] })).toThrow(/identity/)
    expect(f.rec().events[0].invitees).toEqual(['did:ada', 'did:ben'])
  })
})
