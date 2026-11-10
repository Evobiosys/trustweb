// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local: Settings > Extensions > MCP & agents, the pure part (S/ext/mcp-local/mcp_config.ts). */
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { CLIENTS, MCP_TOOLS, SUMBIOS_ID, defaultSettings, parseServers, parseSettings, removeServer, serverEnv, snippet, upsertServer, validUrl } from '../../src/ext/mcp-local/mcp_config.ts'

const PATH = '/opt/tw/apps/mcp/src/server.ts'

describe('tool list', () => {
  it('names exactly the tools the server offers, with writes marked', () => {
    const server = recordTools({ file: '/tmp/x.json', write: true })
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(server.map((t) => t.name).sort())
    expect(MCP_TOOLS.filter((t) => t.write).map((t) => t.name).sort()).toEqual(['add_note', 'add_tag'])
  })
})

describe('settings', () => {
  it('default: read-only, every tool on', () => expect(defaultSettings()).toEqual({ write: false, off: [] }))
  it('parse keeps only what it knows and survives rubbish', () => {
    expect(parseSettings('{"write":true,"off":["search","bogus",7]}')).toEqual({ write: true, off: ['search'] })
    for (const raw of [null, '', 'x', '[]', '{"write":"yes"}']) expect(parseSettings(raw)).toEqual({ write: false, off: [] })
  })
  it('env: nothing for the default; write switch; tool list only when a tool is off', () => {
    expect(serverEnv({ write: false, off: [] })).toEqual({})
    expect(serverEnv({ write: true, off: [] })).toEqual({ TW_MCP_WRITE: '1' })
    expect(serverEnv({ write: true, off: ['search', 'list_tags'] })).toEqual({ TW_MCP_WRITE: '1', TW_MCP_TOOLS: 'list_people,get_person,list_notes,add_note,add_tag' })
  })
  it('a tool list never names a write tool while writes are off', () => {
    expect(serverEnv({ write: false, off: ['search'] }).TW_MCP_TOOLS).toBe('list_people,get_person,list_tags,list_notes')
  })
})

describe('snippets', () => {
  const on = { write: true, off: ['search'] }
  it('one snippet per client, main clients first then the Others', () => {
    expect(CLIENTS.map((c) => c.id)).toEqual(['pi', 'claude-code', 'mistral', 'openai', 'gemini', 'grok'])
    expect(CLIENTS.filter((c) => c.others).map((c) => c.id)).toEqual(['openai', 'gemini', 'grok'])
  })
  it('every snippet carries the command, the server path and the switches', () => {
    for (const c of CLIENTS) {
      const t = snippet(c.id, on, PATH)
      expect(t, c.id).toContain(PATH)
      expect(t, c.id).toContain('TW_MCP_WRITE')
      expect(t, c.id).toContain('node')
    }
  })
  it('the JSON snippets parse', () => {
    for (const id of ['pi', 'gemini']) {
      const j = JSON.parse(snippet(id, on, PATH))
      expect(j.mcpServers.trustweb).toEqual({ command: 'node', args: [PATH], env: { TW_MCP_WRITE: '1', TW_MCP_TOOLS: 'list_people,get_person,list_tags,list_notes,add_note,add_tag' } })
    }
  })
  it('Claude Code: a claude mcp add command', () => {
    expect(snippet('claude-code', { write: false, off: [] }, PATH)).toBe(`claude mcp add trustweb -- node ${PATH}`)
    expect(snippet('claude-code', on, PATH)).toContain('--env TW_MCP_WRITE=1')
  })
  it('Mistral and OpenAI: TOML tables', () => {
    expect(snippet('mistral', on, PATH)).toContain('[[mcp_servers]]')
    expect(snippet('openai', on, PATH)).toContain('[mcp_servers.trustweb]')
  })
  it('read-only default leaves the env out', () => {
    expect(snippet('gemini', defaultSettings(), PATH)).not.toContain('env')
  })
  it('never names a vendor as better or recommended', () => {
    for (const c of CLIENTS) expect(snippet(c.id, on, PATH).toLowerCase()).not.toMatch(/recommend|best|endorse/)
  })
})

describe('external servers', () => {
  it('url rule: https, or http on this machine; no password in the address', () => {
    expect(validUrl('https://mcp.example.org/mcp')).toBe(true)
    expect(validUrl('http://127.0.0.1:7777/')).toBe(true)
    expect(validUrl('http://localhost:7777/')).toBe(true)
    for (const u of ['http://mcp.example.org/', 'ftp://x.org', 'javascript:alert(1)', 'https://user:pw@x.org/', '', 'not a url']) expect(validUrl(u), u).toBe(false)
  })
  it('the Sumbios preset is always first, with no address until the owner enters one', () => {
    const l = parseServers(null)
    expect(l).toEqual([{ id: SUMBIOS_ID, name: 'Sumbios', url: '', token: '' }])
  })
  it('parse drops entries with a bad address and keeps the rest', () => {
    const raw = JSON.stringify([{ id: 'a', name: 'A', url: 'https://a.example.org/mcp', token: 't' }, { id: 'b', name: 'B', url: 'http://evil.example.org/', token: '' }, { id: 'c' }, 7])
    expect(parseServers(raw).map((s) => s.id)).toEqual([SUMBIOS_ID, 'a'])
  })
  it('upsert adds or replaces by id; remove refuses the preset (it is only cleared)', () => {
    let l = upsertServer(parseServers(null), { id: 'a', name: 'A', url: 'https://a.example.org/mcp', token: 't' })
    expect(l.map((s) => s.id)).toEqual([SUMBIOS_ID, 'a'])
    l = upsertServer(l, { id: 'a', name: 'A2', url: 'https://a.example.org/mcp', token: '' })
    expect(l.find((s) => s.id === 'a').name).toBe('A2')
    expect(removeServer(l, 'a').map((s) => s.id)).toEqual([SUMBIOS_ID])
    expect(removeServer(upsertServer(l, { id: SUMBIOS_ID, name: 'Sumbios', url: 'https://s.example.org/mcp', token: 'x' }), SUMBIOS_ID)[0]).toEqual({ id: SUMBIOS_ID, name: 'Sumbios', url: '', token: '' })
  })
  it('upsert throws on a bad address', () => {
    expect(() => upsertServer(parseServers(null), { id: 'a', name: 'A', url: 'http://x.org/', token: '' })).toThrow()
  })
})
