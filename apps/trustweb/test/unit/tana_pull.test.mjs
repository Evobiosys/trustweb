// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c shell-fix-2 (43-D2): "Pull from Tana" on the Import page: read persons through the local API, preview what would change, then apply. Invented data, mocked calls. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PERSON_FIELDS } from '../../../crm/src/person_fields.ts'
import { MAX_PEOPLE, applyPull, planPull, pullErrorKind, readPersons } from '../../src/tana_pull.ts'
import { importTools } from '../../../mcp/src/import_tools.ts'

const INDEX = [
  { id: 'a1', name: 'Anna Beispiel', breadcrumb: ['Library'], created: '2025-02-20T18:05:49.444Z' },
  { id: 'b2', name: 'Ben Muster', breadcrumb: ['Library'], created: '2025-03-01T10:00:00.000Z' },
  { id: 'c3', name: 'Cara Probe', breadcrumb: ['Library'], created: '2025-04-01T10:00:00.000Z' },
]
const NODES = {
  a1: '- Anna Beispiel #person <!-- node-id: a1 -->\n  - **Email**: anna@example.org <!-- node-id: x -->\n',
  b2: '- Ben Muster #person <!-- node-id: b2 -->\n  - Plays chess <!-- node-id: y -->\n',
  c3: '- Cara Probe #person <!-- node-id: c3 -->\n',
}
const fakeCall = (over = {}) => {
  const calls = []
  const call = async (name, args) => {
    calls.push([name, args])
    if (name === 'search_nodes') return JSON.stringify(over.index ?? INDEX)
    if (name === 'read_node') { if (over.fail?.includes(args.nodeId)) throw new Error('boom'); return NODES[args.nodeId] }
    throw new Error(`unexpected ${name}`)
  }
  return { call, calls }
}
const person = (id, over = {}) => ({ id, name: id, context: '', ring: 'unsorted', metAt: 1, lines: [], ...over })

describe('readPersons', () => {
  it('lists #person nodes (search_nodes by tag, read-only), reads each one and converts', async () => {
    const { call, calls } = fakeCall()
    const r = await readPersons(call, PERSON_FIELDS, { today: '2026-11-16', pause: 0 })
    expect(calls[0][0]).toBe('search_nodes')
    expect(calls[0][1].query).toEqual({ hasType: 'Kd2-lusfBo' })
    expect(calls[0][1].limit).toBe(MAX_PEOPLE)
    expect(calls.slice(1).map((c) => c[0])).toEqual(['read_node', 'read_node', 'read_node'])
    expect(r.entities.map((e) => e.id)).toEqual(['tana-a1', 'tana-b2', 'tana-c3'])
    expect(r.entities[0].fields).toEqual({ Bxw7k4FWptqp: 'anna@example.org' })
    expect(r.unreadable).toEqual([])
  })
  it('counts nodes it could not read and leaves them out', async () => {
    const { call } = fakeCall({ fail: ['b2'] })
    const r = await readPersons(call, PERSON_FIELDS, { today: '2026-11-16', pause: 0 })
    expect(r.unreadable).toEqual(['b2'])
    expect(r.entities.map((e) => e.id)).toEqual(['tana-a1', 'tana-c3'])
  })
  it('reports progress', async () => {
    const seen = []
    await readPersons(fakeCall().call, PERSON_FIELDS, { today: '2026-11-16', pause: 0, onProgress: (d, t) => seen.push([d, t]) })
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]])
  })
  it('rejects a reply that is not a node list', async () => {
    await expect(readPersons(async () => 'no json here', PERSON_FIELDS, { today: '2026-11-16', pause: 0 })).rejects.toThrow(/unexpected/i)
    await expect(readPersons(async () => '{"a":1}', PERSON_FIELDS, { today: '2026-11-16', pause: 0 })).rejects.toThrow(/unexpected/i)
  })
  it('keeps at most MAX_PEOPLE nodes', async () => {
    const many = Array.from({ length: MAX_PEOPLE + 5 }, (_, i) => ({ id: `n${i}`, name: `P ${i}`, created: '2025-01-01' }))
    const { call, calls } = fakeCall({ index: many })
    await readPersons(call, PERSON_FIELDS, { today: '2026-11-16', pause: 0 })
    expect(calls.filter((c) => c[0] === 'read_node')).toHaveLength(MAX_PEOPLE)
  })
})

describe('planPull / applyPull (the dry run, then the change)', () => {
  const entities = async () => (await readPersons(fakeCall().call, PERSON_FIELDS, { today: '2026-11-16', pause: 0 })).entities
  it('new people are added, nothing else changes in a dry run', async () => {
    const people = [person('mine')]
    const plan = planPull(people, await entities())
    expect(plan.add.map((p) => p.id)).toEqual(['tana-a1', 'tana-b2', 'tana-c3'])
    expect(plan.update).toEqual([])
    expect(plan.same).toBe(0)
    expect(people).toHaveLength(1)
  })
  it('a known person: Tana fields and missing lines flow in, local ring, name and own lines stay', async () => {
    const es = await entities()
    const local = person('tana-a1', { name: 'Anna (renamed)', ring: 'friend', lines: [{ id: 'mine-1', text: 'local note', tag: 'note', audience: 'me', status: 'current', notedAt: 1, checkedAt: 1 }], fields: {} })
    const people = [local, person('tana-b2', es[1]), person('tana-c3', es[2])]
    const plan = planPull(people, es)
    expect(plan.add).toEqual([])
    expect(plan.update.map((u) => u.id)).toEqual(['tana-a1'])
    expect(plan.same).toBe(2)
    applyPull(people, plan)
    expect(local.name).toBe('Anna (renamed)')
    expect(local.ring).toBe('friend')
    expect(local.fields).toEqual({ Bxw7k4FWptqp: 'anna@example.org' })
    expect(local.lines.map((l) => l.id)).toEqual(['mine-1'])
  })
  it('a Tana line the person lacks is added, one already there is not duplicated', async () => {
    const es = await entities()
    const local = person('tana-b2', { lines: [] })
    const people = [local]
    applyPull(people, planPull(people, [es[1]]))
    expect(local.lines.map((l) => l.text)).toEqual(['Plays chess'])
    applyPull(people, planPull(people, [es[1]]))
    expect(local.lines).toHaveLength(1)
  })
  it('apply adds the new people', async () => {
    const people = []
    applyPull(people, planPull(people, await entities()))
    expect(people.map((p) => p.id)).toEqual(['tana-a1', 'tana-b2', 'tana-c3'])
  })
})

describe('errors', () => {
  it('tells an unreachable Tana, a refused token and the rest apart', () => {
    expect(pullErrorKind(new TypeError('Failed to fetch'))).toBe('reach')
    expect(pullErrorKind(new Error('Tana API answered HTTP 401'))).toBe('auth')
    expect(pullErrorKind(new Error('Tana API answered HTTP 403'))).toBe('auth')
    expect(pullErrorKind(new Error('Tana API answered HTTP 500'))).toBe('other')
  })
})

describe('MCP parity: import_tana_pull', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tana-pull-'))
  const file = path.join(dir, 'record.json')
  const tool = () => importTools({ file, write: true }).find((t) => t.name === 'import_tana_pull')
  const realFetch = globalThis.fetch
  const rpc = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's' } })
  beforeEach(() => {
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me', displayName: 'T' }, people: [{ id: 'mine', name: 'Mine', context: '', ring: 'friend', metAt: 1, lines: [] }], peers: [], inventory: [], log: [], notificationsOn: false }))
    globalThis.fetch = async (_u, init) => {
      const b = JSON.parse(init.body)
      if (b.method !== 'tools/call') return rpc(b.id, {})
      const { name, arguments: a } = b.params
      return rpc(b.id, { content: [{ text: name === 'search_nodes' ? JSON.stringify(INDEX) : NODES[a.nodeId] }] })
    }
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('exists with a preview default (apply false)', () => {
    expect(tool().inputSchema.properties.apply).toBeTruthy()
  })
  it('previews without writing, applies only on apply:true', async () => {
    const before = readFileSync(file, 'utf8')
    expect(await tool().run({ token: 'tok', apply: false })).toMatchObject({ listed: 3, add: 3, update: 0, applied: false })
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(await tool().run({ token: 'tok', apply: true })).toMatchObject({ add: 3, applied: true })
    expect(JSON.parse(readFileSync(file, 'utf8')).people.map((p) => p.id)).toEqual(['mine', 'tana-a1', 'tana-b2', 'tana-c3'])
    expect(await tool().run({ token: 'tok', apply: true })).toMatchObject({ add: 0, same: 3, applied: false })
  })
  it('needs a token', async () => {
    delete process.env.TW_CRM_TANA_TOKEN
    await expect(tool().run({})).rejects.toThrow(/token/)
  })
})
