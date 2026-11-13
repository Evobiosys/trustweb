// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity: what an agent does through MCP shows in the open personal preview within a second. The MCP program (apps/mcp) appends one
 * line per write to dev-mcp-events.jsonl; the dev server serves the new lines (GET /__tw/mcp-events, vite_dev_record.mjs); this module polls it and
 * shows each as a change card (the small notice under the header: no overlay).
 *   kind 'record': the program already changed the record file. Apply takes that file (reload); Undo puts this page's record back over it.
 *   kind 'action': a step only the app can do (app_action): Apply runs it through the same action registry as the assistant (actions.ts), with its Undo.
 * "MCP applies directly" (Settings > Advanced > MCP and agents, record flag mcpApplyDirectly): record changes are taken at once, and an action runs at once
 * when it needs no approval of its own (remove-person and tap always wait). Only where the dev server answers; a stock preview and a build never start it.
 */
import type { Actions } from './actions'
import { S } from './strings'

export interface McpEvent { id: string; at: string; kind: 'record' | 'action'; tool: string; summary: string; action?: { type: string; args: Record<string, unknown>; why?: string } }
export interface CardButton { label: string; attr: string; run: () => void }

export interface McpLiveDeps {
  fetch: typeof fetch
  actions: Pick<Actions, 'check' | 'run'>
  /** The owner's "MCP applies directly" switch. */
  direct: () => boolean
  /** Takes the live record file into this page (reloads when it changed). */
  adopt: () => Promise<void>
  /** Puts this page's record back over the live file. */
  keepMine: () => Promise<void>
  show: (title: string, body: string, buttons: CardButton[]) => void
  hide: () => void
  toast: (msg: string, o?: { onClick?: () => void }) => void
  setTimer?: (fn: () => void, ms: number) => unknown
}

export const POLL_MS = 600

export type Plan = { do: 'apply' } | { do: 'card' } | { do: 'error'; error: string }

/** What a single event gets: run/take at once (direct mode, nothing that needs its own approval) or wait on a card. */
export function plan(ev: McpEvent, direct: boolean, checked: ReturnType<Actions['check']> | null): Plan {
  if (ev.kind === 'record') return direct ? { do: 'apply' } : { do: 'card' }
  if (!checked) return { do: 'error', error: 'no action' }
  if (!checked.ok) return { do: 'error', error: checked.error }
  return direct && checked.action.auto && checked.action.undoable ? { do: 'apply' } : { do: 'card' }
}

/** The index to ask from next, and the events (none on the first answer: a page starts at "now"). */
export async function pollOnce(f: typeof fetch, cursor: number | null): Promise<{ events: McpEvent[]; next: number } | null> {
  try {
    const r = await f(cursor === null ? '/__tw/mcp-events' : `/__tw/mcp-events?from=${cursor}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = (await r.json()) as { events?: McpEvent[]; next?: number }
    return typeof j.next === 'number' && Array.isArray(j.events) ? { events: j.events, next: j.next } : null
  } catch { return null }
}

/** One line per record change, as the card shows it: "set_ring {"person":"Ada"...}" -> readable enough, capped. */
export const summaryOf = (evs: McpEvent[]): string => {
  const line = (e: McpEvent): string => e.summary.replace(/^([a-z_]+) /, '$1: ')
  return evs.length === 1 ? line(evs[0]) : `${evs.length}: ${evs.slice(0, 3).map(line).join('; ')}${evs.length > 3 ? '; ...' : ''}`
}

export function startMcpLive(d: McpLiveDeps): { stop: () => void; handle: (events: McpEvent[]) => void } {
  const T = S.mcpLive
  const later = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  let cursor: number | null = null
  let stopped = false
  const queue: McpEvent[] = []
  let showing = false

  const next = (): void => {
    showing = false
    const ev = queue.shift()
    if (!ev) { d.hide(); return }
    // Several record changes arriving together are one card: one Apply takes the file once.
    const records = ev.kind === 'record' ? [ev, ...queue.filter((e) => e.kind === 'record')] : []
    if (records.length > 1) for (const e of records.slice(1)) queue.splice(queue.indexOf(e), 1)
    showing = true
    if (ev.kind === 'record') {
      d.show(T.recordTitle, summaryOf(records), [
        { label: T.apply, attr: 'data-mcp-apply', run: () => { void d.adopt() } },
        { label: T.undo, attr: 'data-mcp-undo', run: () => { void d.keepMine().then(next) } },
      ])
      return
    }
    const c = d.actions.check({ type: ev.action?.type, args: ev.action?.args, why: ev.action?.why })
    if (!c.ok) { d.show(T.errorTitle, c.error, [{ label: T.dismiss, attr: 'data-mcp-dismiss', run: next }]); return }
    d.show(T.actionTitle, `${c.action.label}${c.action.why ? ` (${c.action.why})` : ''}`, [
      { label: T.apply, attr: 'data-mcp-apply', run: () => { try { const a = d.actions.run(c.action, 'assistant'); if (c.action.undoable) d.toast(`${a.label} (${T.tapUndo})`, { onClick: a.undo }) } catch (e) { d.toast((e as Error).message) } next() } },
      { label: T.dismiss, attr: 'data-mcp-dismiss', run: next },
    ])
  }

  function handle(events: McpEvent[]): void {
    for (const ev of events) {
      const checked = ev.kind === 'action' ? d.actions.check({ type: ev.action?.type, args: ev.action?.args, why: ev.action?.why }) : null
      const p = plan(ev, d.direct(), checked)
      if (p.do === 'apply' && ev.kind === 'record') { void d.adopt(); return }
      if (p.do === 'apply' && checked?.ok) {
        try { const a = d.actions.run(checked.action, 'assistant'); d.toast(`${T.directDone} ${a.label} (${T.tapUndo})`, { onClick: a.undo }) } catch (e) { d.toast((e as Error).message) }
        continue
      }
      queue.push(ev)
    }
    if (!showing) next()
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    const r = await pollOnce(d.fetch, cursor)
    if (r === null && cursor === null) return   // no such route here (stock preview, a build): never starts
    if (r) { cursor = r.next; if (r.events.length) handle(r.events) }
    if (!stopped) later(() => { void tick() }, POLL_MS)
  }
  void tick()
  return { stop: () => { stopped = true }, handle }
}
