// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 bottom-bar: the bottom bar through MCP, over the pure functions the Settings list uses (apps/trustweb/src/bottom_bar.ts), so the app,
 * the list and an agent read and write one `uiBar` in the record. Every view, Record too, can be hidden; the last shown one stays.
 * The edit stream (record_diff.ts) follows people only, so a bar change is saved straight into the record (atomic replace), unlogged.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { barChoices, canHideBar, resolveBar, setBarOrder, toggleBar, type BarFlags, type BarId, type UiBar } from '../../trustweb/src/bottom_bar.ts'
import type { Tool } from './protocol.ts'

type Rec = Record<string, unknown> & { uiBar?: UiBar }
const schema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })
const idArg = schema({ id: { type: 'string', description: 'view id, e.g. web, chat, record, events, inventory' } }, ['id'])
const need = (v: unknown): string => { if (typeof v !== 'string' || !v.trim()) throw new Error('id is required'); return v.trim() }

/** The flags the record alone can tell: Events and Resources on, the Feed when switched on, People and Map on, no advanced entries, no module buttons. */
const flagsOf = (r: Rec): BarFlags => ({ events: true, feed: (r.feed as { on?: unknown } | undefined)?.on !== false, inventory: true, people: true, map: true })

function shape(r: Rec): Record<string, unknown> {
  const { ids, primary } = resolveBar(r.uiBar, flagsOf(r))
  return { shown: ids, primary, hidden: (r.uiBar?.hidden ?? []).filter((h) => !ids.includes(h as BarId)) }
}

export function barTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const save = (r: Rec): void => { const tmp = o.file + '.tmp'; writeFileSync(tmp, JSON.stringify(r)); renameSync(tmp, o.file) }
  /** Applies the new bar and saves; `next` is undefined for bad input. */
  const apply = (next: (r: Rec) => UiBar | undefined, bad: string): Record<string, unknown> => {
    const r = load()
    const bar = next(r)
    if (!bar) throw new Error(bad)
    if (bar !== r.uiBar) { r.uiBar = bar; save(r) }
    return shape(r)
  }
  const flip = (id: string, hide: boolean): Record<string, unknown> => {
    const r = load()
    const f = flagsOf(r)
    if (!barChoices(r.uiBar, f).some((c) => c.id === id)) throw new Error(`unknown view: ${id}`)
    if (resolveBar(r.uiBar, f).ids.includes(id as BarId) === hide) {
      if (hide && !canHideBar(r.uiBar, id, f)) throw new Error('the bar needs at least one view, so the last one stays')
      r.uiBar = toggleBar(r.uiBar, id, f)
      save(r)
    }
    return shape(r)
  }

  const read: Tool[] = [{
    name: 'bar_list', description: 'The bottom bar: the views shown in order, the raised one, and the ones taken out.',
    inputSchema: schema({}), run: () => shape(load()),
  }]
  const write: Tool[] = [
    {
      name: 'bar_set', description: 'Set the bottom bar: the views listed are shown in that order, every other view is taken out. Needs at least one known view.',
      inputSchema: schema({ order: { type: 'array', items: { type: 'string' }, description: 'view ids in the order wanted' } }, ['order']),
      run: (a) => apply((r) => { const next = setBarOrder(r.uiBar, Array.isArray(a.order) ? a.order.map(need) : [], flagsOf(r)); return next === r.uiBar ? undefined : next }, 'order needs at least one known view'),
    },
    { name: 'bar_hide', description: 'Take one view (Record too) out of the bottom bar. The last shown view stays.', inputSchema: idArg, run: (a) => flip(need(a.id), true) },
    { name: 'bar_show', description: 'Put a view back in the bottom bar.', inputSchema: idArg, run: (a) => flip(need(a.id), false) },
  ]
  return [...read, ...(o.write ? write : [])]
}
