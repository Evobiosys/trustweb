// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: Settings > Extensions > MCP & agents, the pure part. (1) What this device's own MCP server (apps/mcp) is told: the write
 * switch and the tools left off, turned into the environment its clients start it with, and one config snippet per client. (2) The list of
 * other services' MCP servers TrustWeb may call (address + token, Sumbios as the first preset). Pure: no DOM, no storage (the body keeps both on this device).
 */
export const MCP_TOOLS: readonly { name: string; write: boolean }[] = [
  { name: 'list_people', write: false }, { name: 'get_person', write: false }, { name: 'list_tags', write: false }, { name: 'list_notes', write: false },
  { name: 'search', write: false }, { name: 'notifications_inbox_list', write: false }, { name: 'add_note', write: true }, { name: 'add_tag', write: true },
  { name: 'notifications_inbox_mark_seen', write: true }, { name: 'notifications_popup_set', write: true },
  { name: 'bar_list', write: false }, { name: 'bar_set', write: true }, { name: 'bar_hide', write: true }, { name: 'bar_show', write: true },
  { name: 'remove_person', write: true }, { name: 'restore_person', write: true },
  { name: 'assistant_providers', write: false }, { name: 'assistant_ask', write: false }, { name: 'assistant_set_model', write: true },
  // Wave 42 mcp-parity: every registry action reachable
  { name: 'set_ring', write: true }, { name: 'remove_tag', write: true }, { name: 'set_field', write: true }, { name: 'create_group_tag', write: true }, { name: 'app_action', write: true },
  // Wave 42 community-support
  { name: 'community_list', write: false }, { name: 'community_settings_get', write: false }, { name: 'support_inbox', write: false },
  { name: 'community_create', write: true }, { name: 'community_set_kind', write: true }, { name: 'community_add_member', write: true },
  { name: 'community_settings_set', write: true }, { name: 'support_ask', write: true }, { name: 'support_cancel', write: true },
  { name: 'event_create', write: true }, { name: 'event_signup', write: true }, { name: 'event_resource_ask', write: true }, { name: 'event_resource_cover', write: true }, { name: 'event_invitees_set', write: true },
  // Wave 42 settings-llm-first
  { name: 'settings_list', write: false }, { name: 'settings_get', write: false }, { name: 'settings_search', write: false }, { name: 'settings_set', write: true },
  // Wave 42 import-obsidian-ai
  { name: 'import_sources', write: false }, { name: 'import_suggestions_list', write: false }, { name: 'import_run', write: true }, { name: 'import_suggestions_accept', write: true },
  // Wave 42 in-person-e2e
  { name: 'connect_code', write: false }, { name: 'connect_redeem', write: false },
  // Wave 42 signup-stripe
  { name: 'billing_plans', write: false }, { name: 'billing_status', write: false }, { name: 'billing_checkout_link', write: true },
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

/** What this checkout's dev server says about the MCP program (GET /__tw/mcp-info): its absolute path, and the record file when it is not the default one. */
export interface McpInfo { server: string; record?: string }

/** What the server reads (apps/mcp/src/server.ts): TW_MCP_WRITE=1, TW_RECORD when the preview's record is not the default file, and TW_MCP_TOOLS only when a tool is off. A write tool is never listed while writes are off. */
export function serverEnv(s: McpSettings, record?: string): Record<string, string> {
  const env: Record<string, string> = s.write ? { TW_MCP_WRITE: '1' } : {}
  if (record) env.TW_RECORD = record
  const on = MCP_TOOLS.filter((t) => (s.write || !t.write) && !s.off.includes(t.name)).map((t) => t.name)
  if (s.off.length) env.TW_MCP_TOOLS = on.join(',')
  return env
}

export type ClientId = 'pi' | 'claude-code' | 'mistral' | 'openai' | 'gemini' | 'grok'
export const CLIENTS: readonly { id: ClientId; others: boolean }[] = [
  { id: 'pi', others: false }, { id: 'claude-code', others: false }, { id: 'mistral', others: false },
  { id: 'openai', others: true }, { id: 'gemini', others: true }, { id: 'grok', others: true },
]

/** Wave 42: the server file is .ts and its folder has no package.json "type", which makes node print a notice on stderr and parse twice; this silences the notice. */
export const NODE_FLAG = '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'
/** The record file the MCP program reads when TW_RECORD is not set (apps/mcp/src/server.ts). */
export const DEFAULT_RECORD = '~/.cache/trustweb-dev/dev-record.live.json'

const tomlEnv = (env: Record<string, string>): string => `{ ${Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`
const jsonBlock = (path: string, env: Record<string, string>): string =>
  JSON.stringify({ mcpServers: { trustweb: { command: 'node', args: [NODE_FLAG, path], ...(Object.keys(env).length ? { env } : {}) } } }, null, 2)
const quote = (v: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`)

/** One line per client; `path` is the absolute path of apps/mcp/src/server.ts (McpInfo.server), never a placeholder. */
export function snippet(id: ClientId, s: McpSettings, path: string, record?: string): string {
  const env = serverEnv(s, record)
  const has = Object.keys(env).length > 0
  const q = quote(path)
  switch (id) {
    case 'claude-code': return `claude mcp add trustweb${Object.entries(env).map(([k, v]) => ` -e ${k}=${quote(v)}`).join('')} -- node ${NODE_FLAG} ${q}`
    case 'pi': return `pi mcp add trustweb${Object.entries(env).map(([k, v]) => ` --env ${k}=${quote(v)}`).join('')} --exposure direct -- node ${NODE_FLAG} ${q}`
    case 'mistral': return ['[[mcp_servers]]', 'name = "trustweb"', 'transport = "stdio"', 'command = "node"', `args = [${JSON.stringify(NODE_FLAG)}, ${JSON.stringify(path)}]`, ...(has ? [`env = ${tomlEnv(env)}`] : [])].join('\n')
    case 'openai': return ['[mcp_servers.trustweb]', 'command = "node"', `args = [${JSON.stringify(NODE_FLAG)}, ${JSON.stringify(path)}]`, ...(has ? [`env = ${tomlEnv(env)}`] : [])].join('\n')
    default: return jsonBlock(path, env)   // gemini, grok: the common mcpServers block
  }
}

/** pi's fallback when `pi mcp add` is not at hand: the same entry as the block pi keeps in ~/.pi/agent/mcp.json (exposure "direct" lists the tools by name). */
export function piFallback(s: McpSettings, path: string, record?: string): string {
  const env = serverEnv(s, record)
  const entry = { command: 'node', args: [NODE_FLAG, path], ...(Object.keys(env).length ? { env } : {}), exposure: 'direct' }
  return `Tell pi: add this to ~/.pi/agent/mcp.json (under "mcpServers", next to the others)\n${JSON.stringify({ trustweb: entry }, null, 2)}`
}

// --- other services' MCP servers (TrustWeb as the client) ---

export interface McpServerEntry { id: string; name: string; /** https, or http on this machine. */ url: string; token: string }
export const SUMBIOS_ID = 'sumbios'
const sumbios = (): McpServerEntry => ({ id: SUMBIOS_ID, name: 'Sumbios', url: '', token: '' })

export function validUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.username || u.password) return false
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'))
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
