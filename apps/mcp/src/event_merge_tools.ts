// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 merge-events (POLICY P02, MCP parity): merge two events. The record has no network and no pair keys, so event_merge and
 * event_merge_answer check the record and queue the step for the open app (an approval card, apps/trustweb/src/event_merge_actions.ts),
 * which merges (host of both) or asks the other host, sealed (event_merge_flow.ts). event_merge_asks_list reads the asks and the redirects.
 */
import { mayApprove } from '../../trustweb/src/event_roles.ts'
import type { MergeAsk } from '../../trustweb/src/event_merge.ts'
import type { TwEvent } from '../../trustweb/src/model.ts'
import { announce } from './events.ts'
import { load, needText, schema, S, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

const events = (r: Rec): TwEvent[] => (Array.isArray(r.events) ? (r.events as TwEvent[]) : [])
const asksOf = (r: Rec): MergeAsk[] => (Array.isArray(r.eventMergeAsks) ? (r.eventMergeAsks as MergeAsk[]) : [])
function eventOf(r: Rec, ref: unknown, what: string): TwEvent {
  const key = needText(ref, what)
  const e = events(r).find((x) => x.id === key) ?? events(r).find((x) => x.name.trim().toLowerCase() === key.toLowerCase())
  if (!e) throw new Error(`no event "${key}"`)
  return e
}

export function eventMergeTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const queue = (tool: string, type: string, args: Record<string, unknown>): void =>
    announce(o.file, { at: now().toISOString(), kind: 'action', tool, summary: `${type} ${JSON.stringify(args)}`.slice(0, 200), action: { type, args } })
  const pair = (r: Rec, a: Record<string, unknown>): { keep: TwEvent; gone: TwEvent } => {
    const keep = eventOf(r, a.keep, 'keep')
    const gone = eventOf(r, a.gone, 'gone')
    if (keep.id === gone.id) throw new Error('keep and gone must be two different events')
    return { keep, gone }
  }
  const read: Tool[] = [{
    name: 'event_merge_asks_list', description: 'Merge asks between event hosts (in: another host asks to merge my event `gone` into their `keep`; out: I asked, waiting) and the merged ids (old id -> the event that holds it now).',
    inputSchema: schema({}),
    run: () => {
      const r = load(o.file)
      const name = (id: string): string => events(r).find((e) => e.id === id)?.name ?? ''
      return {
        asks: asksOf(r).map((a) => ({ dir: a.dir, keep: a.keep, keepName: name(a.keep), gone: a.gone, goneName: name(a.gone), from: a.from, at: new Date(a.at).toISOString() })),
        merged: r.eventMerged && typeof r.eventMerged === 'object' ? r.eventMerged : {},
      }
    },
  }]
  if (!o.write) return read
  const write: Tool[] = [
    {
      name: 'event_merge', description: 'Merge event `gone` into event `keep` (id or exact name): keep keeps its id and link; people, resources, roles, notes and posts move over; the old id redirects; gone goes to Recently deleted. A host of both merges at once (mode now); a host of keep only asks the other event\'s connected hosts (mode ask). Queued for the open app as an approval card.',
      inputSchema: schema({ keep: S('the event that stays (id or exact name)'), gone: S('the event merged into it (id or exact name)') }, ['keep', 'gone']),
      run: (a) => {
        const r = load(o.file)
        const { keep, gone } = pair(r, a)
        const me = (r.me as { displayName?: string } | undefined)?.displayName ?? ''
        if (!mayApprove(keep, me, r.people)) throw new Error(`only a host of "${keep.name}" can merge another event into it`)
        queue('event_merge', 'event-merge', { keep: keep.id, gone: gone.id })
        return { queued: true, keep: keep.id, gone: gone.id, mode: mayApprove(gone, me, r.people) ? 'now' : 'ask' }
      },
    },
    {
      name: 'event_merge_answer', description: 'Answer another host\'s ask (event_merge_asks_list, dir in) to merge my event `gone` into their `keep`: yes merges here and tells my event\'s people, no ends the ask. Queued for the open app as an approval card.',
      inputSchema: schema({ keep: S('their event id'), gone: S('my event id'), yes: { type: 'boolean' } }, ['keep', 'gone', 'yes']),
      run: (a) => {
        const keep = needText(a.keep, 'keep')
        const gone = needText(a.gone, 'gone')
        if (typeof a.yes !== 'boolean') throw new Error('yes is required (true or false)')
        if (!asksOf(load(o.file)).some((x) => x.dir === 'in' && x.keep === keep && x.gone === gone)) throw new Error(`no merge ask for "${gone}" into "${keep}"`)
        queue('event_merge_answer', 'event-merge-answer', { keep, gone, yes: a.yes })
        return { queued: true, keep, gone, yes: a.yes }
      },
    },
  ]
  return [...read, ...write]
}
