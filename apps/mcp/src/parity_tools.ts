// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 mcp-parity (POLICY P02): the assistant's actions (apps/trustweb/src/app_actions.ts) the MCP lacked. The ones that only change the
 * record are tools of their own (same rules as the app's action, on the record file); the ones that need the screen (open, tap, look, variations,
 * import rows...) go through `app_action`, which queues the step for the open preview (events.ts). Which action maps to which tool: ext/assistant/actions.ts.
 */
import { APP_ACTION_TYPES } from '../../trustweb/src/ext/assistant/actions.ts'
import { announce } from './events.ts'
import { commitTo, findPerson, needText, schema, slug, S, type Person, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

/** The rings a person can be moved to (Ring in apps/trustweb/src/model.ts, without 'none'). */
const RINGS = ['closest', 'close', 'friend', 'acquaintance', 'intending', 'family']
const FIELD = /^[a-z][a-z0-9_-]{0,39}$/
const RESERVED = new Set(['ring', 'id', 'proto', 'constructor', 'prototype'])
const holds = (p: Person, tag: string): boolean => String(p.fields?.[tag]) === 'true'

export function parityTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const commit = (change: Parameters<typeof commitTo>[2]): boolean => commitTo(o.file, now, change)
  if (!o.write) return []
  return [
    {
      name: 'set_ring', description: `Move a person to a trust ring: ${RINGS.join(', ')}.`,
      inputSchema: schema({ person: S('id or exact name'), ring: S(RINGS.join(' | ')) }, ['person', 'ring']),
      run: (a) => {
        const ring = typeof a.ring === 'string' ? a.ring : ''
        if (!RINGS.includes(ring)) throw new Error(`ring must be one of ${RINGS.join(', ')}`)
        let who: Person | undefined
        commit((r) => { who = findPerson(r, a.person); who.ring = ring })
        return { id: who!.id, name: who!.name, ring }
      },
    },
    {
      name: 'remove_tag', description: 'Take a tag off a person.',
      inputSchema: schema({ person: S('id or exact name'), tag: S('tag name') }, ['person', 'tag']),
      run: (a) => {
        const tag = slug(needText(a.tag, 'tag'))
        let who: Person | undefined
        commit((r) => {
          who = findPerson(r, a.person)
          if (!holds(who, tag)) throw new Error(`${who.name} has no tag "${tag}"`)
          const { [tag]: _gone, ...rest } = who.fields ?? {}
          if (Object.keys(rest).length) who.fields = rest; else delete who.fields
        })
        return { id: who!.id, name: who!.name, tag, removed: true }
      },
    },
    {
      name: 'set_field', description: 'Set a field of a person: "name", "context" (where we met) or any other field key (email, phone, company...). An empty value clears it.',
      inputSchema: schema({ person: S('id or exact name'), field: S('name | context | another key'), value: S('text; "" clears') }, ['person', 'field', 'value']),
      run: (a) => {
        const field = needText(a.field, 'field')
        if (!FIELD.test(field) || RESERVED.has(field)) throw new Error(`field "${field}" cannot be set`)
        if (typeof a.value !== 'string') throw new Error('value must be text ("" clears the field)')
        const value = a.value.trim()
        if (value.length > 500) throw new Error('value is too long')
        if (field === 'name' && !value) throw new Error('a name cannot be empty')
        let who: Person | undefined
        commit((r) => {
          who = findPerson(r, a.person)
          if (field === 'name' || field === 'context') { who[field] = value.slice(0, field === 'name' ? 40 : 500); return }
          const { [field]: _old, ...rest } = who.fields ?? {}
          const next = value ? { ...rest, [field]: value } : rest
          if (Object.keys(next).length) who.fields = next; else delete who.fields
        })
        return { id: who!.id, name: who!.name, field, value }
      },
    },
    {
      name: 'create_group_tag', description: 'Make a tag that groups people and give it to the members named (all must resolve, else nothing changes). A tag someone holds already is refused: use add_tag.',
      inputSchema: schema({ label: S('tag name'), members: { type: 'array', items: { type: 'string' }, description: 'ids or exact names' } }, ['label']),
      run: (a) => {
        const tag = slug(needText(a.label, 'label'))
        if (!tag) throw new Error('label needs letters or digits')
        const names = a.members === undefined ? [] : a.members
        if (!Array.isArray(names) || names.some((m) => typeof m !== 'string') || names.length > 200) throw new Error('members must be a list of ids or names')
        const ids: string[] = []
        commit((r) => {
          if (r.people.some((p) => p.deleted_at === undefined && holds(p, tag))) throw new Error(`the tag "${tag}" exists already: use add_tag`)
          const people = (names as string[]).map((n) => findPerson(r, n))
          for (const p of people) { p.fields = { ...p.fields, [tag]: 'true' }; ids.push(p.id) }
        })
        return { tag, members: ids }
      },
    },
    {
      name: 'app_action', description: `Queue a step that needs the screen for the open TrustWeb preview, which shows it as a card (and runs it on Approve, or at once when "MCP applies directly" is on): ${APP_ACTION_TYPES.join(', ')}. Returns {queued:true}; the outcome shows in the preview.`,
      inputSchema: schema({ type: S(APP_ACTION_TYPES.join(' | ')), args: { type: 'object', description: 'the action\'s arguments, as the assistant writes them' }, why: S('one line: why') }, ['type']),
      run: (a) => {
        const type = needText(a.type, 'type')
        if (!APP_ACTION_TYPES.includes(type)) throw new Error(`unknown or dedicated action "${type}": app_action takes ${APP_ACTION_TYPES.join(', ')}; others have a tool of their own`)
        const args = a.args && typeof a.args === 'object' && !Array.isArray(a.args) ? (a.args as Record<string, unknown>) : {}
        const why = typeof a.why === 'string' && a.why.trim() ? a.why.trim().slice(0, 300) : undefined
        announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'app_action', summary: `${type} ${JSON.stringify(args)}`.slice(0, 200), action: { type, args, ...(why ? { why } : {}) } })
        return { queued: true, type }
      },
    },
  ]
}
