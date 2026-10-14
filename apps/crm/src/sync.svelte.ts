/** Saves a field edit, queues it for Tana when the person chose Tana, and pushes the queue (auto or "Sync now"). */
import { mergedFields, baseFields } from './fields'
import type { FieldValue } from './fields'
import { Pkm, prefs, savePrefs } from './prefs.svelte'
import { setField, store } from './state.svelte'
import { PERSON_TAG_ID, connect, nodeIdIn, planFieldSync } from './tana_sync'
import type { ToolCall } from './tana_sync'

const MAX_LOG = 100
const TANA_PREFIX = 'tana-'

export const sync = $state({ running: false })

function log(text: string): void {
  prefs.log = [`${new Date().toTimeString().slice(0, 8)} ${text}`, ...prefs.log].slice(0, MAX_LOG)
  savePrefs()
}

/** The edit goes to the CRM's own record first; Tana only hears about it afterwards, and only on request or with auto sync. */
export function saveField(personId: string, key: string, value: FieldValue): void {
  setField(personId, key, value)
  if (prefs.pkm !== Pkm.Tana || 'manual' in planFieldSync(key, value)) return
  if (!prefs.queue.some((q) => q.personId === personId && q.key === key)) prefs.queue.push({ personId, key })
  savePrefs()
  if (prefs.autoSync) void flush()
}

async function nodeFor(call: ToolCall, personId: string): Promise<string> {
  if (personId.startsWith(TANA_PREFIX)) return personId.slice(TANA_PREFIX.length)
  const known = prefs.nodeIds[personId]
  if (known) return known
  const person = store.app.people.find((p) => p.id === personId)
  if (!person) throw new Error('person not found')
  const parent = prefs.parentNodeId.trim()
    || nodeIdIn(await call('get_or_create_calendar_node', { workspaceId: prefs.workspaceId.trim(), granularity: 'day' }))
  if (!parent) throw new Error('no parent node for new people')
  const made = nodeIdIn(await call('import_tana_paste', { parentNodeId: parent, content: `${person.name} #person` }))
  if (!made) throw new Error('Tana did not return the new node id')
  prefs.nodeIds[personId] = made
  savePrefs()
  log(`created ${person.name} as #person in Tana (${made})`)
  return made
}

async function push(call: ToolCall, item: { personId: string; key: string }): Promise<void> {
  const person = store.app.people.find((p) => p.id === item.personId)
  const value = mergedFields(person ? baseFields(person) : undefined, store.crm.personFields?.[item.personId])[item.key]
  const op = planFieldSync(item.key, value)
  if ('manual' in op) return
  const nodeId = await nodeFor(call, item.personId)
  await call(op.tool, { nodeId, ...op.args })
  const checkbox = typeof value === 'boolean' ? ' (checkbox via text, unverified)' : ''
  log(`${person?.name ?? item.personId}: ${item.key} -> Tana ok${checkbox}`)
}

/** Pushes the queue. An unreachable API keeps it; a refused edit is logged and dropped (never retried blind). */
export async function flush(): Promise<void> {
  if (sync.running || prefs.pkm !== Pkm.Tana || prefs.queue.length === 0) return
  sync.running = true
  try {
    const call = await connect(prefs.token.trim())
    while (prefs.queue.length > 0) {
      const item = prefs.queue[0]
      try {
        await push(call, item)
      } catch (e) {
        log(`${item.personId}: ${item.key} refused: ${e instanceof Error ? e.message : String(e)}`)
      }
      prefs.queue.shift()
      savePrefs()
    }
  } catch (e) {
    log(`Tana not reachable (${e instanceof Error ? e.message : String(e)}); ${prefs.queue.length} edit(s) kept`)
  } finally {
    sync.running = false
  }
}

/** Asks Tana to add the TrustWeb-only "famous" checkbox to #person. Off by default; outcome goes to the log. */
export async function createFamousField(): Promise<void> {
  try {
    const call = await connect(prefs.token.trim())
    const out = await call('add_field_to_tag', { tagId: PERSON_TAG_ID, name: 'famous, no intent to connect', dataType: 'checkbox' })
    log(`add_field_to_tag: ${out.slice(0, 120)}`)
  } catch (e) {
    log(`add_field_to_tag failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

if (prefs.autoSync && prefs.queue.length > 0) void flush()
