// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local: Settings > Extensions > MCP & agents, the pure part (S/ext/mcp-local/mcp_config.ts). */
import { allTools } from '../../../mcp/src/tools.ts'
import { CLIENTS, MCP_TOOLS, NODE_FLAG, SUMBIOS_ID, piFallback, defaultSettings, parseServers, parseSettings, removeServer, serverEnv, snippet, upsertServer, validUrl } from '../../src/ext/mcp-local/mcp_config.ts'

const PATH = '/opt/tw/apps/mcp/src/server.ts'

describe('tool list', () => {
  it('names exactly the tools the server offers, with writes marked', () => {
    const server = allTools({ file: '/tmp/x.json', write: true })
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(server.map((t) => t.name).sort())
    // A write tool is one the server offers only with writes on.
    const readOnly = new Set(allTools({ file: '/tmp/x.json', write: false }).map((t) => t.name))
    expect(MCP_TOOLS.filter((t) => t.write).map((t) => t.name).sort()).toEqual(server.map((t) => t.name).filter((n) => !readOnly.has(n)).sort())
    expect(MCP_TOOLS.filter((t) => t.write).map((t) => t.name)).toEqual(expect.arrayContaining(['add_note', 'set_ring', 'app_action', 'bar_set', 'community_create', 'event_create', 'import_run', 'settings_set', 'billing_checkout_link']))
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
    const names = (keep) => MCP_TOOLS.filter(keep).map((t) => t.name).join(',')
    expect(serverEnv({ write: true, off: ['search', 'list_tags'] })).toEqual({ TW_MCP_WRITE: '1', TW_MCP_TOOLS: names((t) => t.name !== 'search' && t.name !== 'list_tags') })
    expect(serverEnv({ write: true, off: ['search', 'list_tags'] }).TW_MCP_TOOLS).toMatch(/^list_people,get_person,list_notes,/)
  })
  it('a tool list never names a write tool while writes are off', () => {
    const list = serverEnv({ write: false, off: ['search'] }).TW_MCP_TOOLS
    expect(list).toBe(MCP_TOOLS.filter((t) => !t.write && t.name !== 'search').map((t) => t.name).join(','))
    expect(list.split(',').some((n) => MCP_TOOLS.find((t) => t.name === n)?.write)).toBe(false)
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
    for (const id of ['gemini']) {
      const j = JSON.parse(snippet(id, on, PATH))
      expect(j.mcpServers.trustweb).toEqual({ command: 'node', args: [NODE_FLAG, PATH], env: { TW_MCP_WRITE: '1', TW_MCP_TOOLS: MCP_TOOLS.filter((t) => t.name !== 'search').map((t) => t.name).join(',') } })
    }
  })
  it('Claude Code: a claude mcp add command', () => {
    expect(snippet('claude-code', { write: false, off: [] }, PATH)).toBe(`claude mcp add trustweb -- node ${NODE_FLAG} ${PATH}`)
    expect(snippet('claude-code', on, PATH)).toContain('-e TW_MCP_WRITE=1')
    expect(snippet('claude-code', on, PATH)).toMatch(/^claude mcp add trustweb -e TW_MCP_WRITE=1 .*-- node /)
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

describe('one line per client with the absolute path (wave 42 mcp-parity)', () => {
  const on = { write: true, off: [] }
  const ABS = '/Users/x/web-of-trust/Code/worktrees/w/apps/mcp/src/server.ts'
  it('pi: pi mcp add, direct exposure, the switches as --env, then the node command', () => {
    expect(snippet('pi', on, ABS)).toBe(`pi mcp add trustweb --env TW_MCP_WRITE=1 --exposure direct -- node ${NODE_FLAG} ${ABS}`)
    expect(snippet('pi', defaultSettings(), ABS)).toBe(`pi mcp add trustweb --exposure direct -- node ${NODE_FLAG} ${ABS}`)
  })
  it('the record of a preview with its own file goes in as TW_RECORD, in every client', () => {
    const rec = '/tmp/tw live/dev-record.live.json'
    expect(serverEnv(on, rec)).toEqual({ TW_MCP_WRITE: '1', TW_RECORD: rec })
    expect(snippet('pi', on, ABS, rec)).toContain(`--env TW_RECORD='${rec}'`)
    expect(snippet('claude-code', on, ABS, rec)).toContain(`-e TW_RECORD='${rec}'`)
    expect(JSON.parse(snippet('gemini', on, ABS, rec)).mcpServers.trustweb.env.TW_RECORD).toBe(rec)
  })
  it('a path with a space is quoted, so the command pastes as it is', () => {
    expect(snippet('pi', on, '/My Docs/apps/mcp/src/server.ts')).toContain("-- node " + NODE_FLAG + " '/My Docs/apps/mcp/src/server.ts'")
  })
  it('the pi fallback text says what to tell pi and carries valid JSON with direct exposure', () => {
    const t = piFallback(on, ABS)
    expect(t).toMatch(/^Tell pi: add this to ~\/\.pi\/agent\/mcp\.json/)
    const j = JSON.parse(t.slice(t.indexOf('{')))
    expect(j.trustweb).toEqual({ command: 'node', args: [NODE_FLAG, ABS], env: { TW_MCP_WRITE: '1' }, exposure: 'direct' })
  })
  it('no snippet ever carries the placeholder path', () => {
    for (const c of CLIENTS) expect(snippet(c.id, on, ABS)).not.toContain('/path/to')
    expect(piFallback(on, ABS)).not.toContain('/path/to')
  })
})
