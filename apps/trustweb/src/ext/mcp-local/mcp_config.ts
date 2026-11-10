// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: Settings > Extensions > MCP & agents, the pure part. (1) What this device's own MCP server (apps/mcp) is told: the write
 * switch and the tools left off, turned into the environment its clients start it with, and one config snippet per client. (2) The list of
 * other services' MCP servers TrustWeb may call (address + token, Sumbios as the first preset). Pure: no DOM, no storage (the body keeps both on this device).
 */
export const MCP_TOOLS: readonly { name: string; write: boolean }[] = [
  { name: 'list_people', write: false }, { name: 'get_person', write: false }, { name: 'list_tags', write: false }, { name: 'list_notes', write: false },
  { name: 'search', write: false }, { name: 'add_note', write: true }, { name: 'add_tag', write: true },
]

export interface McpSettings { write: boolean; /** Tools switched off. */ off: string[] }
export const SETTINGS_KEY = 'trustweb.v1.mcp.settings'
export const SERVERS_KEY = 'trustweb.v1.mcp.servers'
export const defaultSettings = (): McpSettings => ({ write: false, off: [] })

export function parseSettings(raw: string | null): McpSettings {
  try {
    const o = JSON.parse(raw ?? '') as { write?: unknown; off?: unknown }
    const known = MCP_TOOLS.map((t) => t.name)
    return { write: o.write === true, off: Array.isArray(o.off) ? o.off.filter((n): n is string => typeof n === 'string' && known.includes(n)) : [] }
  } catch { return defaultSettings() }
}

/** What the server reads (apps/mcp/src/server.ts): TW_MCP_WRITE=1, and TW_MCP_TOOLS only when a tool is off. A write tool is never listed while writes are off. */
export function serverEnv(s: McpSettings): Record<string, string> {
  const env: Record<string, string> = s.write ? { TW_MCP_WRITE: '1' } : {}
  const on = MCP_TOOLS.filter((t) => (s.write || !t.write) && !s.off.includes(t.name)).map((t) => t.name)
  if (s.off.length) env.TW_MCP_TOOLS = on.join(',')
  return env
}

export type ClientId = 'pi' | 'claude-code' | 'mistral' | 'openai' | 'gemini' | 'grok'
export const CLIENTS: readonly { id: ClientId; others: boolean }[] = [
  { id: 'pi', others: false }, { id: 'claude-code', others: false }, { id: 'mistral', others: false },
  { id: 'openai', others: true }, { id: 'gemini', others: true }, { id: 'grok', others: true },
]

/** The owner replaces this with the folder TrustWeb's code lives in; a web page cannot know it. */
export const SERVER_PATH_HINT = '/path/to/web-of-trust/apps/mcp/src/server.ts'

const tomlEnv = (env: Record<string, string>): string => `{ ${Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`
const jsonBlock = (path: string, env: Record<string, string>): string =>
  JSON.stringify({ mcpServers: { trustweb: { command: 'node', args: [path], ...(Object.keys(env).length ? { env } : {}) } } }, null, 2)

export function snippet(id: ClientId, s: McpSettings, path: string = SERVER_PATH_HINT): string {
  const env = serverEnv(s)
  const has = Object.keys(env).length > 0
  switch (id) {
    case 'claude-code': return `claude mcp add trustweb${Object.entries(env).map(([k, v]) => ` --env ${k}=${v}`).join('')} -- node ${path}`
    case 'mistral': return ['[[mcp_servers]]', 'name = "trustweb"', 'transport = "stdio"', 'command = "node"', `args = [${JSON.stringify(path)}]`, ...(has ? [`env = ${tomlEnv(env)}`] : [])].join('\n')
    case 'openai': return ['[mcp_servers.trustweb]', 'command = "node"', `args = [${JSON.stringify(path)}]`, ...(has ? [`env = ${tomlEnv(env)}`] : [])].join('\n')
    default: return jsonBlock(path, env)   // pi, gemini, grok: the common mcpServers block
  }
}

// --- other services' MCP servers (TrustWeb as the client) ---

export interface McpServerEntry { id: string; name: string; /** https, or http on this machine. */ url: string; token: string }
export const SUMBIOS_ID = 'sumbios'
const sumbios = (): McpServerEntry => ({ id: SUMBIOS_ID, name: 'Sumbios', url: '', token: '' })

export function validUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.username || u.password) return false
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))
  } catch { return false }
}

const isStr = (v: unknown): v is string => typeof v === 'string'

/** The stored list: bad entries dropped; the Sumbios preset is always first (an empty address until the owner enters the one Sumbios gives). */
export function parseServers(raw: string | null): McpServerEntry[] {
  let list: unknown
  try { list = JSON.parse(raw ?? '') } catch { list = [] }
  const ok = (Array.isArray(list) ? list : []).filter((e): e is McpServerEntry =>
    !!e && typeof e === 'object' && isStr(e.id) && isStr(e.name) && isStr(e.url) && isStr(e.token) && (e.url === '' || validUrl(e.url)))
  return [ok.find((e) => e.id === SUMBIOS_ID) ?? sumbios(), ...ok.filter((e) => e.id !== SUMBIOS_ID)]
}

export function upsertServer(list: readonly McpServerEntry[], e: McpServerEntry): McpServerEntry[] {
  if (e.url !== '' && !validUrl(e.url)) throw new Error('address must be https (or http on this machine), without a password in it')
  return list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e]
}

/** The preset cannot go; removing it clears its address and token. */
export const removeServer = (list: readonly McpServerEntry[], id: string): McpServerEntry[] =>
  id === SUMBIOS_ID ? list.map((x) => (x.id === id ? sumbios() : x)) : list.filter((x) => x.id !== id)
