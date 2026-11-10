// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local: TrustWeb as an MCP client (in = import through a server's tools, out = push chosen people), S/ext/mcp-local/mcp_client.ts. */
import { ContactSource } from '../../../crm/src/import/types.ts'
import { SERVICE_LABEL } from '../../src/services_import.ts'
import { callableForImport, contactsFromResult, openSession, pushArgs, pushableTools } from '../../src/ext/mcp-local/mcp_client.ts'

const SERVER = { id: 's', name: 'Sumbios', url: 'https://s.example.org/mcp', token: 'tok' }
const text = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })

/** A fake MCP server behind fetch. */
function fakeFetch(tools, results = {}, { sse = false } = {}) {
  const seen = []
  const f = async (url, init) => {
    const msg = JSON.parse(init.body)
    seen.push({ url, headers: init.headers, msg })
    if (msg.id === undefined) return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' }
    const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's', version: '1' } }
      : msg.method === 'tools/list' ? { tools } : msg.method === 'tools/call' ? results[msg.params.name] : {}
    const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })
    return sse
      ? { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, text: async () => `event: message\ndata: ${body}\n\n` }
      : { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : h.toLowerCase() === 'mcp-session-id' ? 'sess1' : null) }, text: async () => body }
  }
  return { f, seen }
}
const LIST = { name: 'list_contacts', description: '', inputSchema: { type: 'object', properties: {} } }
const NEEDS = { name: 'find', description: '', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }
const ADD = { name: 'add_contact', description: '', inputSchema: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' }, tags: { type: 'array' } }, required: ['name'] } }

describe('openSession', () => {
  it('initializes, announces itself, sends the bearer token and keeps the session id', async () => {
    const { f, seen } = fakeFetch([LIST, ADD])
    const s = await openSession(SERVER, f)
    expect(seen.map((x) => x.msg.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(seen[0].headers.authorization).toBe('Bearer tok')
    expect(seen[1].headers['mcp-session-id']).toBe('sess1')
    expect(s.tools.map((t) => t.name)).toEqual(['list_contacts', 'add_contact'])
  })
  it('reads an event-stream answer too', async () => {
    const { f } = fakeFetch([LIST], {}, { sse: true })
    expect((await openSession(SERVER, f)).tools).toHaveLength(1)
  })
  it('call returns the tool result and throws on a tool error', async () => {
    const { f } = fakeFetch([LIST], { list_contacts: text([]), bad: { isError: true, content: [{ type: 'text', text: 'denied' }] } })
    const s = await openSession(SERVER, f)
    expect(await s.call('list_contacts', {})).toEqual(text([]))
    await expect(s.call('bad', {})).rejects.toThrow('denied')
  })
  it('refuses a server without an address and a failing answer', async () => {
    await expect(openSession({ ...SERVER, url: '' }, async () => { throw new Error('no') })).rejects.toThrow(/address/)
    await expect(openSession(SERVER, async () => ({ ok: false, status: 401, headers: { get: () => null }, text: async () => '' }))).rejects.toThrow(/401/)
  })
  it('sends no token header when the entry has none', async () => {
    const { f, seen } = fakeFetch([])
    await openSession({ ...SERVER, token: '' }, f)
    expect(seen[0].headers.authorization).toBeUndefined()
  })
})

describe('in: import through a tool', () => {
  it('only tools without required arguments can be called for an import', () => {
    expect(callableForImport([LIST, NEEDS, ADD]).map((t) => t.name)).toEqual(['list_contacts'])
  })
  it('turns a list of people into contacts, source mcp, file = server name', () => {
    const r = contactsFromResult(text([{ id: 'x1', name: 'Ada', email: 'ADA@Example.org', phone: '+43 1', org: 'Lab', notes: 'ignored', note: 'met', tags: ['mentor', ' mentor '] }, { name: '  ' }, { email: 'a@b.c' }, 'str']), 'Sumbios')
    expect(r.skipped).toBe(3)
    expect(r.contacts).toEqual([{ source: ContactSource.Mcp, file: 'Sumbios', sourceRef: 'x1', name: 'Ada', phones: ['+43 1'], emails: ['ada@example.org'], org: 'Lab', note: 'met', labels: ['mentor'] }])
  })
  it('finds the list inside people / contacts / items and in structuredContent', () => {
    for (const key of ['people', 'contacts', 'items']) expect(contactsFromResult(text({ [key]: [{ name: 'A' }] }), 'S').contacts).toHaveLength(1)
    expect(contactsFromResult({ structuredContent: { people: [{ name: 'B' }] }, content: [] }, 'S').contacts[0].name).toBe('B')
  })
  it('strips control and bidi characters, caps the count, and never throws on rubbish', () => {
    expect(contactsFromResult(text([{ name: 'A‮B\u0007' }]), 'S').contacts[0].name).toBe('AB')
    expect(contactsFromResult(text(Array.from({ length: 6000 }, (_, i) => ({ name: `n${i}` }))), 'S').contacts).toHaveLength(5000)
    for (const bad of [null, {}, { content: [{ type: 'text', text: 'not json' }] }, text(5)]) expect(contactsFromResult(bad, 'S')).toEqual({ contacts: [], skipped: 0 })
  })
  it('sourceRef falls back to the position', () => {
    expect(contactsFromResult(text([{ name: 'A' }, { name: 'B' }]), 'S').contacts.map((c) => c.sourceRef)).toEqual(['#0', '#1'])
  })
  it('the import label exists', () => expect(SERVICE_LABEL.mcp).toBeTruthy())
})

describe('out: push chosen people', () => {
  const person = { id: 'p', name: 'Bob', generalNote: 'plays chess', fields: { mentor: 'true', x: 'no' }, channels: { email: 'b@example.org' }, ring: 'friend' }
  it('tools that take a name can receive people', () => {
    expect(pushableTools([LIST, NEEDS, ADD]).map((t) => t.name)).toEqual(['add_contact'])
  })
  it('sends only the fields the tool declares, from name, note and tags; never contact channels or the zone', () => {
    expect(pushArgs(ADD, person)).toEqual({ name: 'Bob', note: 'plays chess', tags: ['mentor'] })
    const nameOnly = { ...ADD, inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
    expect(pushArgs(nameOnly, person)).toEqual({ name: 'Bob' })
  })
  it('a tool without a name argument gets nothing: null', () => {
    expect(pushArgs(LIST, person)).toBeNull()
  })
})
