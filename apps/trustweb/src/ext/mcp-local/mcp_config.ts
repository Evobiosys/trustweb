// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: Settings > Extensions > MCP & agents, the pure part. (1) What this device's own MCP server (apps/mcp) is told: the write
 * switch and the tools left off, turned into the environment its clients start it with, and one config snippet per client. (2) The list of
 * other services' MCP servers TrustWeb may call (address + token, Sumbios as the first preset). Pure: no DOM, no storage (the body keeps both on this device).
 */
export const MCP_TOOLS: readonly { name: string; write: boolean }[] = [
  { name: 'list_people', write: false }, { name: 'get_person', write: false }, { name: 'list_tags', write: false }, { name: 'list_notes', write: false },
  { name: 'search', write: false }, { name: 'notifications_inbox_list', write: false }, { name: 'add_note', write: true }, { name: 'add_tag', write: true }, { name: 'person_hide', write: true },
  { name: 'notifications_inbox_mark_seen', write: true }, { name: 'notifications_popup_set', write: true },
  { name: 'bar_list', write: false }, { name: 'bar_set', write: true }, { name: 'bar_hide', write: true }, { name: 'bar_show', write: true },
  { name: 'web_filter_get', write: false }, { name: 'web_filter_set', write: true },
  /* wave44b filters-communities */
  { name: 'filter_state_list', write: false }, { name: 'event_mode_get', write: false }, { name: 'filter_state_save', write: true }, { name: 'filter_state_apply', write: true }, { name: 'filter_state_pin', write: true }, { name: 'event_mode_set', write: true },
  { name: 'remove_person', write: true }, { name: 'restore_person', write: true },
  { name: 'introduce_people', write: true }, // wave 44 steer-bubble-connect
  { name: 'introduce_link_create', write: true }, // wave 44 steer-bubble-connect-3
  { name: 'assistant_providers', write: false }, { name: 'assistant_ask', write: false }, { name: 'assistant_set_model', write: true },
  // Wave 42 mcp-parity: every registry action reachable
  { name: 'set_ring', write: true }, { name: 'remove_tag', write: true }, { name: 'set_field', write: true }, { name: 'create_group_tag', write: true }, { name: 'app_action', write: true },
  // Wave 42 community-support
  { name: 'community_list', write: false }, { name: 'community_settings_get', write: false }, { name: 'support_inbox', write: false },
  { name: 'community_create', write: true }, { name: 'community_set_kind', write: true }, { name: 'community_add_member', write: true },
  { name: 'community_settings_set', write: true }, { name: 'support_ask', write: true }, { name: 'support_cancel', write: true },
  { name: 'event_create', write: true }, { name: 'event_signup', write: true }, { name: 'event_resource_ask', write: true }, { name: 'event_resource_cover', write: true }, { name: 'event_invitees_set', write: true }, { name: 'event_roles_set', write: true }, { name: 'event_person_identify', write: true },
  // Wave 43b event-qr-join
  { name: 'event_link_open', write: false },
  // Wave 43 event-press-share
  { name: 'event_settings_set', write: true }, { name: 'event_visibility_default', write: true }, { name: 'event_offers_set', write: true }, { name: 'event_times_set', write: true }, { name: 'me_nickname_set', write: true },
  // Wave 43c chat-notices
  { name: 'notices_list', write: false }, { name: 'web_default_view_get', write: false }, { name: 'web_default_view_set', write: true },
  // Wave 43b notify-center
  { name: 'notifications_list', write: false }, { name: 'notifications_mark_read', write: true },
  /* wave44 steer-notify-dismiss */ { name: 'notification_dismiss', write: true },
  // Wave 43b resources-views
  { name: 'resources_list', write: false }, { name: 'resource_set_kind', write: true }, { name: 'resource_set_suggester', write: true },
  // Wave 43 event-feed
  { name: 'feed_list', write: false }, { name: 'feed_post', write: true }, { name: 'feed_edit', write: true }, { name: 'feed_star', write: true },
  // Wave 44 feed-embed
  { name: 'feed_embed_link', write: true },
  // Wave 42 settings-llm-first
  { name: 'settings_list', write: false }, { name: 'settings_get', write: false }, { name: 'settings_search', write: false }, { name: 'settings_sync_capabilities', write: false }, { name: 'settings_set', write: true },
  // Wave 42 import-obsidian-ai
  { name: 'import_sources', write: false }, { name: 'import_suggestions_list', write: false }, { name: 'import_run', write: true }, { name: 'import_suggestions_accept', write: true }, { name: 'import_tana_pull', write: true },
  // Wave 42 in-person-e2e
  { name: 'connect_code', write: false }, { name: 'connect_redeem', write: false },
  // Wave 42 signup-stripe
  { name: 'billing_plans', write: false }, { name: 'billing_status', write: false }, { name: 'billing_checkout_link', write: true },
  // Wave 43b ask-page-filter
  { name: 'ask_audience_get', write: false }, { name: 'ask_audience_set', write: true },
  /* wave44 steer-ask-escalation */
  { name: 'ask_escalation_get', write: false }, { name: 'ask_escalation_set', write: true }, { name: 'resource_set_physical', write: true },
  /* wave43b community-shell */
  { name: 'community_menu_get', write: false }, { name: 'community_home_tiles_set', write: true }, { name: 'community_chat_scope_set', write: true }, { name: 'event_link_mode_set', write: true },
  /* wave43c sync-devices */
  { name: 'sync_status', write: false }, { name: 'sync_now', write: true },
  /* wave43c social-hosting */
  { name: 'directory_search', write: false }, { name: 'profile_discoverable_set', write: true }, { name: 'hosting_set', write: true }, { name: 'trusted_only_set', write: true }, { name: 'trust_override_set', write: true },
  /* wave43c connect-extras */
  { name: 'feed_sources_get', write: false }, { name: 'feed_sources_set', write: true }, { name: 'community_dashboard_share_set', write: true }, { name: 'event_envelope_send', write: true },
  /* wave44 home-dashboard */
  { name: 'home_layout_get', write: false }, { name: 'home_layout_set', write: true }, { name: 'dashboard_open', write: true },
  /* wave44 steer-ask-placement-2 */
  { name: 'ai_provider_get', write: false }, { name: 'ai_provider_set', write: true },
  /* wave44 steer-settings-sync */
  { name: 'settings_keep_copy', write: true },
  /* wave44 feed-sources */
  { name: 'feed_source_toggle', write: true }, { name: 'feed_algorithm_set', write: true }, { name: 'feed_no_public_read_set', write: true }, { name: 'feed_publish_target_set', write: true },
  /* wave44 event-editor */
  { name: 'event_drafts_list', write: false }, { name: 'event_draft_save', write: true }, { name: 'event_invite', write: true }, { name: 'event_details_set', write: true }, { name: 'calendar_add', write: true }, { name: 'calendar_tag_toggle', write: true },
  /* wave44 handshake-crypto */
  { name: 'handshake_status', write: false },
  /* wave44 steer-people-picker */
  { name: 'person_qr_target', write: false },
  /* wave44 steer-people-picker-2 */
  { name: 'connect_placement', write: false }, { name: 'connect_link_check', write: false }, { name: 'connect_placement_set', write: true },
  /* wave44 steer-invite-link */
  { name: 'invite_link_create', write: true }, { name: 'invite_link_revoke', write: true }, { name: 'invite_link_status', write: false },
  /* wave44 steer-open-space */
  { name: 'open_space_propose', write: true }, { name: 'open_space_join', write: true },

  /* wave44b profile-page */
  { name: 'profile_get', write: false }, { name: 'profile_set', write: true }, { name: 'profile_link_add', write: true }, { name: 'profile_link_remove', write: true },
  /* wave44b resources-outliner */
  { name: 'resource_share', write: false }, { name: 'resource_block_add', write: true }, { name: 'resource_block_edit', write: true }, { name: 'resource_block_move', write: true }, { name: 'resource_block_remove', write: true }, { name: 'resource_block_collapse', write: true }, { name: 'resource_blocks_import', write: true },
  /* wave44b hide-from-crypto */
  { name: 'ask_tamper_reports_list', write: false },
  /* answers-44a */
  { name: 'profile_link_check', write: true },
  /* wave44 steer-circles-view */
  { name: 'circles_layout', write: false },
  /* wave44c community-resources */
  { name: 'resource_mark_opened', write: true },
  /* wave44c home-default */
  { name: 'requests_list', write: false }, { name: 'home_open_request', write: true },
  /* wave44c event-autosave */
  { name: 'drafts_list', write: false }, { name: 'draft_discard', write: true },
  /* wave44c seen-through */
  { name: 'people_seen_through_list', write: false },
  /* wave44c feed-ext */
  { name: 'feed_refresh', write: false }, { name: 'feed_post_read', write: false }, { name: 'feed_source_add', write: true }, { name: 'feed_source_remove', write: true }, { name: 'feed_extension_set', write: true },
  /* wave44c sync-seamless */
  { name: 'sync_pair_link', write: true },
  /* wave44c answers-44c */
  { name: 'sync_pair_show_new', write: true }, { name: 'sync_pair_scan', write: true },
  { name: 'trash_list', write: false }, { name: 'trash_restore', write: true },
  /* wave44c review-44c */
  { name: 'event_introduce_person', write: true },
  /* wave44c answers-44d */
  { name: 'asks_incoming_list', write: false }, { name: 'events_list', write: false }, { name: 'event_get', write: false }, { name: 'chats_list', write: false }, { name: 'chat_read', write: false },
  { name: 'groups_list', write: false }, { name: 'relations_list', write: false }, { name: 'tasks_list', write: false }, { name: 'invitations_list', write: false }, { name: 'meetings_list', write: false },
  { name: 'ask_answer', write: true }, { name: 'chat_send', write: true },
  { name: 'resource_add', write: true },
  { name: 'event_share_audience_set', write: true }, { name: 'community_intimate_set', write: true }, { name: 'event_chat_open', write: true }, { name: 'event_message_all', write: true },
  /* wave45 events-refetch */
  { name: 'events_refetch', write: true },
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
