// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: TrustWeb as an MCP client over HTTP (JSON-RPC 2.0 POSTs, answer as JSON or as one event-stream message).
 * In: a tool of another service lists people -> ImportedContact[] for the Curate page (nothing enters the record before the owner accepts).
 * Out: chosen people go to a tool, only the fields that tool declares among name, note and tags; never contact channels or the zone.
 * Pure over an injected fetch.
 */
import type { ImportedContact } from '../../../../crm/src/import/types'
import { ContactSource } from '../../../../crm/src/import/types'
import type { Person } from '../../model'
import { stripUnsafe } from '../../safe_text'
import type { McpServerEntry } from './mcp_config'

export interface McpToolDef { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }
interface Res { ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
export type Fetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<Res>
export interface McpSession { tools: McpToolDef[]; call(name: string, args: Record<string, unknown>): Promise<unknown> }

const MAX_CONTACTS = 5000

export async function openSession(server: McpServerEntry, fetchFn: Fetch): Promise<McpSession> {
  if (!server.url) throw new Error('this server has no address yet')
  let sid: string | null = null
  let n = 0
  async function post(method: string, params: Record<string, unknown>, notify = false): Promise<unknown> {
    const msg = { jsonrpc: '2.0', ...(notify ? {} : { id: ++n }), method, params }
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (server.token) headers.authorization = `Bearer ${server.token}`
    if (sid) headers['mcp-session-id'] = sid
    const res = await fetchFn(server.url, { method: 'POST', headers, body: JSON.stringify(msg) })
    if (!res.ok) throw new Error(`${server.name} answered ${res.status}`)
    sid = res.headers.get('mcp-session-id') ?? sid
    if (notify) return undefined
    const body = await res.text()
    const json = (res.headers.get('content-type') ?? '').includes('text/event-stream')
      ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).find((d) => d)
      : body
    const out = JSON.parse(json ?? '') as { result?: unknown; error?: { message?: string } }
    if (out.error) throw new Error(out.error.message ?? 'MCP error')
    return out.result
  }
  await post('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'trustweb', version: '1' } })
  await post('notifications/initialized', {}, true)
  const listed = (await post('tools/list', {})) as { tools?: McpToolDef[] }
  return {
    tools: listed.tools ?? [],
    async call(name, args) {
      const r = (await post('tools/call', { name, arguments: args })) as { isError?: boolean; content?: { text?: string }[] }
      if (r?.isError) throw new Error(r.content?.[0]?.text ?? 'tool error')
      return r
    },
  }
}

const hasNoRequired = (t: McpToolDef): boolean => !(t.inputSchema?.required?.length)
const takes = (t: McpToolDef, arg: string): boolean => t.inputSchema?.properties !== undefined && arg in t.inputSchema.properties

/** Tools the owner may call for an import: nothing to fill in. */
export const callableForImport = (tools: readonly McpToolDef[]): McpToolDef[] => tools.filter(hasNoRequired)
/** Tools a person may be pushed to: they take a name. */
export const pushableTools = (tools: readonly McpToolDef[]): McpToolDef[] => tools.filter((t) => takes(t, 'name'))

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const clean = (v: unknown): string => (typeof v === 'string' ? stripUnsafe(v).trim() : '')
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(clean).filter(Boolean)
const once = (a: string[]): string[] => [...new Set(a)]

function payloadOf(result: unknown): unknown {
  if (!isObj(result)) return undefined
  if (result.structuredContent !== undefined) return result.structuredContent
  const t = Array.isArray(result.content) ? result.content.find((c) => isObj(c) && typeof c.text === 'string') : undefined
  try { return JSON.parse((t as { text: string } | undefined)?.text ?? '') } catch { return undefined }
}

/** People out of a tool result: a list, or an object holding one under people / contacts / items. Rows without a name are counted as skipped. */
export function contactsFromResult(result: unknown, serverName: string): { contacts: ImportedContact[]; skipped: number } {
  const p = payloadOf(result)
  const rows = Array.isArray(p) ? p : isObj(p) ? ['people', 'contacts', 'items'].map((k) => p[k]).find(Array.isArray) : undefined
  const contacts: ImportedContact[] = []
  let skipped = 0
  ;(rows ?? []).forEach((r: unknown, i: number) => {
    const name = isObj(r) ? clean(r.name) : ''
    if (!isObj(r) || !name) { skipped++; return }
    if (contacts.length >= MAX_CONTACTS) return
    const c: ImportedContact = {
      source: ContactSource.Mcp, file: serverName, sourceRef: clean(r.id) || `#${i}`, name,
      phones: once([...list(r.phones), ...list(r.phone)]), emails: once([...list(r.emails), ...list(r.email)].map((e) => e.toLowerCase())),
      labels: once([...list(r.labels), ...list(r.tags)]),
    }
    if (clean(r.org)) c.org = clean(r.org)
    if (clean(r.title)) c.title = clean(r.title)
    if (clean(r.note)) c.note = clean(r.note)
    contacts.push(c)
  })
  return { contacts, skipped }
}

/** The arguments for pushing one person to a tool, or null when the tool takes no name. */
export function pushArgs(tool: McpToolDef, p: Pick<Person, 'name' | 'generalNote' | 'fields'>): Record<string, unknown> | null {
  if (!takes(tool, 'name')) return null
  const tags = Object.entries(p.fields ?? {}).filter(([, v]) => String(v) === 'true').map(([k]) => k)
  return { name: p.name, ...(takes(tool, 'note') && p.generalNote ? { note: p.generalNote } : {}), ...(takes(tool, 'tags') && tags.length ? { tags } : {}) }
}
