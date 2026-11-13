// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity: what an MCP call tells an open personal preview. Every write tool, after it wrote, appends one line to
 * dev-mcp-events.jsonl beside the record; the dev server hands the new lines to the page (GET /__tw/mcp-events, apps/trustweb/vite_dev_record.mjs),
 * which shows each as a change card (src/mcp_live.ts). kind 'record': the file changed already; kind 'action': a step only the app can do
 * (app_action), queued for the page to run through the same action registry as the assistant. Local file, no network.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface McpEvent {
  id: string
  at: string
  kind: 'record' | 'action'
  tool: string
  summary: string
  action?: { type: string; args: Record<string, unknown>; why?: string }
}

export const eventsFile = (recordFile: string): string => path.join(path.dirname(recordFile), 'dev-mcp-events.jsonl')

export function announce(recordFile: string, ev: Omit<McpEvent, 'id'>): void {
  const line: McpEvent = { id: `${Date.parse(ev.at) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...ev }
  appendFileSync(eventsFile(recordFile), JSON.stringify(line) + '\n')
}

/** The lines from index `from` on, and the index after the last one. A damaged line is skipped. */
export function readEvents(recordFile: string, from: number): { events: McpEvent[]; next: number } {
  const f = eventsFile(recordFile)
  const lines = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
  const events: McpEvent[] = []
  for (const l of lines.slice(Math.max(0, from))) { try { events.push(JSON.parse(l) as McpEvent) } catch { /* skip */ } }
  return { events, next: lines.length }
}
