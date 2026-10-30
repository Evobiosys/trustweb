/**
 * TrustWeb -> Tana, one way, through Tana's local API (JSON-RPC 2.0 over POST on loopback, MCP tools).
 * The only network call in the CRM, made only after the person turned Tana sync on (I1). Never deletes in Tana.
 * UNVERIFIED against a live workspace: tool argument names follow the handover, checkbox via text is a guess.
 */
import { ADHOC, fieldById, valueText } from './fields'
import type { FieldValue, FieldValues } from './fields'
import { RING_FIELD, RING_KEY, TANA_RING_OPTIONS, ringOf } from './rings'

export const TANA_URL = 'http://127.0.0.1:8262/mcp'
const EMAIL_KEY = 'Bxw7k4FWptqp'
export const PERSON_TAG_ID = 'Kd2-lusfBo'

export type SyncOp =
  | { tool: 'set_field_content'; args: { attributeId: string; content: string | null; mode: 'replace' } }
  | { tool: 'set_field_option'; args: { attributeId: string; optionId: string } }
  | { manual: string }

/** What a field edit becomes in Tana, or why a human has to do it there. */
export function planFieldSync(key: string, value: FieldValue | undefined): SyncOp {
  if (key === RING_KEY) {
    const optionId = TANA_RING_OPTIONS[ringOf(valueText(value))]
    return optionId ? { tool: 'set_field_option', args: { attributeId: RING_FIELD, optionId } } : { manual: 'no Tana ring option for this trust zone yet' }
  }
  const field = fieldById(key)
  if (key.startsWith(ADHOC) || !field) return { manual: 'ad hoc field, no Tana attribute known' }
  const attributeId = field.tanaAttributeId
  if (!attributeId) return { manual: 'TrustWeb-only field, no Tana field yet' }
  const text = valueText(value)
  if (field.type === 'checkbox') return { tool: 'set_field_content', args: { attributeId, content: value === true ? '[X]' : '[ ]', mode: 'replace' } }
  if (field.type === 'instance' && key !== EMAIL_KEY) return { manual: `reference to a #${field.instanceTag?.name ?? 'node'} whose node id is not known` }
  if (field.type === 'options' && text) {
    const option = field.options?.find((o) => o.label === text)
    return option ? { tool: 'set_field_option', args: { attributeId, optionId: option.id } } : { manual: 'option id not in the schema' }
  }
  return { tool: 'set_field_content', args: { attributeId, content: text || null, mode: 'replace' } }
}

export interface ManualItem {
  personId: string
  name: string
  key: string
  label: string
  reason: string
}

/** Every edit made in TrustWeb that Tana will not take by itself. */
export function manualItems(people: readonly { id: string; name: string }[], edits: Record<string, FieldValues> | undefined): ManualItem[] {
  const out: ManualItem[] = []
  for (const p of people) {
    for (const [key, value] of Object.entries(edits?.[p.id] ?? {})) {
      const op = planFieldSync(key, value)
      if ('manual' in op) out.push({ personId: p.id, name: p.name, key, label: fieldById(key)?.label ?? key.slice(ADHOC.length), reason: op.manual })
    }
  }
  return out
}

/** The reply body of a JSON-RPC call: plain JSON, or SSE `data:` lines (the last one with a result or error wins). */
export function parseRpc(body: string): { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } } {
  const text = body.trim()
  if (!text) return {}
  if (text.startsWith('{')) return JSON.parse(text)
  const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean)
  return datas.length ? JSON.parse(datas[datas.length - 1]) : {}
}

export type ToolCall = (name: string, args: object) => Promise<string>

/** Opens a session with the local API; the returned function calls one tool and returns its text. Throws when unreachable or refused. */
export async function connect(token: string, fetcher: typeof fetch = fetch): Promise<ToolCall> {
  let session = ''
  let n = 0
  async function rpc(method: string, params: object, notify = false): Promise<ReturnType<typeof parseRpc>> {
    const r = await fetcher(TANA_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id: ++n }), method, params }),
    })
    if (!r.ok) throw new Error(`Tana API answered HTTP ${r.status}`)
    session = r.headers.get('mcp-session-id') ?? session
    const reply = parseRpc(await r.text())
    if (reply.error) throw new Error(reply.error.message ?? 'Tana API error')
    return reply
  }
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'trustweb-crm', version: '0.1.0' } })
  await rpc('notifications/initialized', {}, true)
  return async (name, args) => {
    const { result } = await rpc('tools/call', { name, arguments: args })
    const text = (result?.content ?? []).map((c) => c.text ?? '').join('\n')
    if (result?.isError) throw new Error(text || `${name} failed`)
    return text
  }
}

/** First Tana node id in a tool reply (unverified format: looks for an id field or a tana: link). */
export function nodeIdIn(text: string): string | null {
  return /(?:node-?id|"id")["':\s=]+([\w-]{8,14})/i.exec(text)?.[1] ?? /tana:([\w-]{8,14})/.exec(text)?.[1] ?? null
}

/** The node's own name in a read_node reply (first line, tags and the node-id comment cut off); null when it cannot be told. */
export function nameIn(text: string): string | null {
  const line = /^- (.*?)(?:\s+#[^\s<]+)*\s*<!-- node-id:/m.exec(text)
  return line ? line[1] : null
}
