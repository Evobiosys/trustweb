// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b filters-communities (POLICY P02, MCP parity): saved filter states (filter_state_list / _save / _apply / _pin) and EVENT MODE
 * (event_mode_get / event_mode_set). Both live in the record (`savedFilters`, `uiRings.eventMode`); the app redraws on its next load.
 */
import { eventTagSlug } from '../../trustweb/src/event_tag.ts'
import { bubbleOn, setEveryone } from '../../trustweb/src/event_bubble.ts'
import { applySavedFilter, pinSavedFilter, saveFilterState, type SavedFilter } from '../../trustweb/src/saved_filters.ts'
import { commitTo, load, schema, S, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
interface Ev { id: string; name: string; tagName?: string }
type Rec = Obj & { savedFilters?: SavedFilter[]; uiRings?: Obj & { show?: string[]; hide?: string[]; eventMode?: string; eventEveryone?: true }; eventBubbleOff?: true; events?: Ev[] }

const shape = (f: SavedFilter): Obj => ({ id: f.id, name: f.name, show: f.show, hide: f.hide, pinned: f.pinned === true })
const find = (r: Rec, key: unknown): SavedFilter => {
  const k = typeof key === 'string' ? key.trim() : ''
  const hit = (r.savedFilters ?? []).find((f) => f.id === k || f.name.toLowerCase() === k.toLowerCase())
  if (!hit) throw new Error(`no saved filter "${k}"`)
  return hit
}
/** `event_<slug>` or the event id. */
function eventId(r: Rec, v: unknown): string {
  const k = typeof v === 'string' ? v.trim() : ''
  const ev = (r.events ?? []).find((e) => e.id === k || eventTagSlug(e.tagName ?? e.name).toLowerCase() === k.toLowerCase())
  if (!ev) throw new Error(`no event "${k}": use event_<slug> or the event id`)
  return ev.id
}
const modeOf = (r: Rec): Obj => {
  const id = r.uiRings?.eventMode
  const ev = (r.events ?? []).find((e) => e.id === id)
  return { on: !!ev, ...(ev ? { event: eventTagSlug(ev.tagName ?? ev.name), id: ev.id, webNarrowed: bubbleOn(r) } : {}) }   // wave45 event-bubble: webNarrowed = the Web shows only the event's people
}

export function filterStateTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const read: Tool[] = [
    { name: 'filter_state_list', description: 'The saved filter states (in/out chips under a name) and which are pinned above the filter row.', inputSchema: schema({}), run: () => (((load(o.file) as Rec).savedFilters ?? []).map(shape)) },
    { name: 'event_mode_get', description: 'EVENT MODE: whether Web, Chat, Resources and Ask are narrowed to one event\'s people, and which event.', inputSchema: schema({}), run: () => modeOf(load(o.file) as Rec) },
  ]
  if (!o.write) return read
  const write: Tool[] = [
    {
      name: 'filter_state_save', description: 'Save the Web filter as it stands now (the in/out chips) under a name; the same name replaces. Nothing to save when no chip is on.',
      inputSchema: schema({ name: S('name of the saved filter') }, ['name']),
      run: (a) => {
        let out: SavedFilter | null = null
        commitTo(o.file, now, (r) => { out = saveFilterState(r as Rec, typeof a.name === 'string' ? a.name : '') })
        if (!out) throw new Error('give a name and switch at least one filter chip on first')
        return shape(out)
      },
    },
    {
      name: 'filter_state_apply', description: 'Put a saved filter state (id or name) back into the Web filter.',
      inputSchema: schema({ filter: S('saved filter id or name') }, ['filter']),
      run: (a) => { let out: Obj = {}; commitTo(o.file, now, (r) => { const f = find(r as Rec, a.filter); applySavedFilter(r as Rec, f.id); out = shape(f) }); return out },
    },
    {
      name: 'filter_state_pin', description: 'Pin a saved filter state above the filter row on Web, Chat, Resources and Ask (pinned: false unpins).',
      inputSchema: schema({ filter: S('saved filter id or name'), pinned: { type: 'boolean', description: 'default true' } }, ['filter']),
      run: (a) => { let out: Obj = {}; commitTo(o.file, now, (r) => { const f = find(r as Rec, a.filter); pinSavedFilter(r as Rec, f.id, a.pinned !== false); out = shape(f) }); return out },
    },
    {
      name: 'event_mode_set', description: 'Switch EVENT MODE on for an event (event_<slug> or its id): the Web shows everyone connected with it, Chat, Resources and Ask only those people. Omit the event to leave the mode.',
      inputSchema: schema({ event: S('event_<slug> or event id; omit to leave event mode') }),
      run: (a) => {
        let out: Obj = {}
        commitTo(o.file, now, (r) => {
          const rec = r as Rec
          const ui = { ...rec.uiRings }
          delete ui.eventEveryone
          if (a.event === undefined || a.event === null || a.event === '') delete ui.eventMode; else ui.eventMode = eventId(rec, a.event)
          rec.uiRings = ui
          out = modeOf(rec)
        })
        return out
      },
    },
    {
      name: 'event_bubble_set', description: 'EVENT MODE bubble: everyone true = the chip "Everyone" lifts the Web narrowing to the event\'s people (Chat, Resources and Ask stay narrowed); false puts it back. Needs event mode on; it ends with the mode. Turning the auto-bubble off for good is settings_set events.autoBubble.',
      inputSchema: schema({ everyone: { type: 'boolean', description: 'true lifts, false restores' } }, ['everyone']),
      run: (a) => {
        let out: Obj = {}
        commitTo(o.file, now, (r) => {
          const rec = r as Rec
          if (!rec.uiRings?.eventMode) throw new Error('event mode is off: nothing to lift')
          setEveryone(rec, a.everyone === true)
          out = modeOf(rec)
        })
        return out
      },
    },
  ]
  return [...read, ...write]
}
