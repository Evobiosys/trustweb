// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c shell-fix-2 (43-D2): "Pull from Tana" as an in-app action (Settings > Import) and as MCP import_tana_pull. Read-only on Tana's local API
 * (loopback): list the #person nodes, read each, convert with the CRM converter, show what would change, and only on Apply write to the record.
 * UNVERIFIED against a live workspace (like crm/src/tana_sync.ts): the search_nodes query shape follows crm/scripts/tana_hidden.mjs.
 * Pure and node-safe (apps/mcp runs it under plain node): the only value import is the converter .mjs; the caller hands in the tool call and the schema.
 */
import { convert } from '../../crm/scripts/tana_convert.mjs'
import type { Person } from './model'

export type ToolCall = (name: string, args: object) => Promise<string>
type Entity = Person & { fields?: Record<string, unknown> }

/** The #person supertag of the owner's workspace (same id as crm/src/tana_sync.ts PERSON_TAG_ID). */
const PERSON_TAG_ID = 'Kd2-lusfBo'
/** One pull reads at most this many people (the local API answers one call per node; the CLI has no cap). */
export const MAX_PEOPLE = 500
const PAUSE_MS = 50

interface IndexNode { id: string; name: string; created?: string; breadcrumb?: string[]; workspaceId?: string }

/** The schema the converter needs: the CRM's generated person fields (src/person_fields.ts), handed in so this file stays node-safe. */
type Schema = Parameters<typeof convert>[2]

export interface ReadOptions { today: string; pause?: number; onProgress?: (done: number, total: number) => void }
export interface ReadResult { entities: Entity[]; unreadable: string[]; listed: number }

function parseIndex(raw: string): IndexNode[] {
  let data: unknown
  try { data = JSON.parse(raw) } catch { throw new Error('unexpected reply from Tana (not JSON)') }
  const list = Array.isArray(data) ? data : (data as { results?: unknown })?.results
  if (!Array.isArray(list)) throw new Error('unexpected reply from Tana (no node list)')
  const seen = new Set<string>()
  const out: IndexNode[] = []
  for (const n of list) {
    if (!n || typeof n !== 'object') continue
    const { id, name } = n as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || typeof name !== 'string' || seen.has(id)) continue
    seen.add(id)
    out.push(n as IndexNode)
  }
  return out.slice(0, MAX_PEOPLE)
}

/** Lists the #person nodes, reads each (read_node, depth 1) and converts them to people. Throws when the API itself fails; a node it cannot read is counted and skipped. */
export async function readPersons(call: ToolCall, schema: Schema, o: ReadOptions): Promise<ReadResult> {
  const index = parseIndex(await call('search_nodes', { query: { hasType: PERSON_TAG_ID }, limit: MAX_PEOPLE }))
  const nodes: Record<string, string> = {}
  const unreadable: string[] = []
  const pause = o.pause ?? PAUSE_MS
  for (const [i, n] of index.entries()) {
    try { nodes[n.id] = await call('read_node', { nodeId: n.id, maxDepth: 1 }) } catch { unreadable.push(n.id) }
    o.onProgress?.(i + 1, index.length)
    if (pause) await new Promise((r) => setTimeout(r, pause))
  }
  const readable = index.filter((n) => n.id in nodes).map((n) => ({ created: new Date(0).toISOString(), ...n }))
  const { record } = convert(readable, nodes, schema, [], undefined, {}, new Set(), {}, {}, o.today)
  return { entities: record.people as Entity[], unreadable, listed: index.length }
}

export interface PullUpdate { id: string; name: string; fields: Record<string, unknown>; lines: Person['lines'] }
export interface PullPlan { add: Entity[]; update: PullUpdate[]; same: number }

/** The converter's own marker on a person it gave a derived ring; meaningful for a new person only. */
const DERIVED_MARK = 'ring: derived'

/** A line is the same line by its Tana node id, else by its text. */
type Line = Person['lines'][number] & { tanaId?: string }
const sameLine = (a: Line, b: Line): boolean => (a.tanaId || b.tanaId ? a.tanaId === b.tanaId : a.text === b.text)

/** The dry run: who would be added, who gets Tana's field values and lines they lack, how many are already the same. Changes nothing. */
export function planPull(people: readonly Person[], entities: readonly Entity[]): PullPlan {
  const plan: PullPlan = { add: [], update: [], same: 0 }
  for (const e of entities) {
    const have = people.find((p) => p.id === e.id) as Entity | undefined
    if (!have) { plan.add.push(e); continue }
    const fields = Object.fromEntries(Object.entries(e.fields ?? {}).filter(([k, v]) => JSON.stringify(have.fields?.[k]) !== JSON.stringify(v)))
    const lines = e.lines.filter((l) => l.text !== DERIVED_MARK && !have.lines.some((x) => sameLine(x, l)))
    if (!Object.keys(fields).length && !lines.length) plan.same++
    else plan.update.push({ id: e.id, name: have.name, fields, lines })
  }
  return plan
}

/** Applies a plan to the people list in place. Tana is the source of truth for the fields it names; the name, ring, context and the person's own lines stay. */
export function applyPull(people: Person[], plan: PullPlan): void {
  for (const u of plan.update) {
    const have = people.find((p) => p.id === u.id) as Entity | undefined
    if (!have) continue
    if (Object.keys(u.fields).length) have.fields = { ...have.fields, ...u.fields } as Person['fields']
    for (const l of u.lines) have.lines.push(have.lines.some((x) => x.id === l.id) ? { ...l, id: `${l.id}-${have.lines.length}` } : l)
  }
  for (const e of plan.add) if (!people.some((p) => p.id === e.id)) people.push(e)
}

export type PullErrorKind = 'reach' | 'auth' | 'other'

/** Which words the person sees: Tana not running or not reachable, a refused token, anything else. */
export function pullErrorKind(e: unknown): PullErrorKind {
  const m = e instanceof Error ? e.message : String(e)
  if (/HTTP 40[13]\b/.test(m)) return 'auth'
  if (e instanceof TypeError || /failed to fetch|network|ECONNREFUSED|load failed/i.test(m)) return 'reach'
  return 'other'
}
