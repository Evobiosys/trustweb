/** Saves a field edit, queues it for Tana when the person chose Tana, and pushes the queue (auto or "Sync now"). */
import { mergedFields, baseFields, HIDE_KEY } from './fields'
import type { FieldValue } from './fields'
import { prefs, savePrefs, tanaOn } from './prefs.svelte'
import { hidePerson, setField, store, unhidePerson } from './state.svelte'
import { connect, nodeIdIn, planFieldSync } from './tana_sync'
import type { ToolCall } from './tana_sync'

const MAX_LOG = 100
const TANA_PREFIX = 'tana-'

export const sync = $state({ running: false })

function log(text: string): void {
  prefs.log = [`${new Date().toTimeString().slice(0, 8)} ${text}`, ...prefs.log].slice(0, MAX_LOG)
  savePrefs()
}

const DEBOUNCE_MS = 2000
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function enqueue(personId: string, key: string): void {
  if (!prefs.queue.some((q) => q.personId === personId && q.key === key)) prefs.queue.push({ personId, key })
  savePrefs()
  void flush()
}

/** The edit goes to the CRM's own record first; Tana hears about it 2 s after the last keystroke of that field (auto sync), or on "Sync now". */
export function saveField(personId: string, key: string, value: FieldValue): void {
  setField(personId, key, value)
  if (!tanaOn() || 'manual' in planFieldSync(key, value)) return
  if (!prefs.autoSync) {
    if (!prefs.queue.some((q) => q.personId === personId && q.key === key)) prefs.queue.push({ personId, key })
    savePrefs()
    return
  }
  const id = `${personId}|${key}`
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => { timers.delete(id); enqueue(personId, key) }, DEBOUNCE_MS))
}

/** "Hide from TrustWeb": ticks the Tana checkbox through the sync and takes the person out of the lists at once. */
export function hideFromTrustweb(personId: string): void {
  saveField(personId, HIDE_KEY, true)
  hidePerson(personId)
}

export function unhideInTrustweb(personId: string): void {
  saveField(personId, HIDE_KEY, false)
  unhidePerson(personId)
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
  const name = person?.name ?? store.crm.hiddenPeople?.find((h) => h.id === item.personId)?.name ?? item.personId
  const value = mergedFields(person ? baseFields(person) : undefined, store.crm.personFields?.[item.personId])[item.key]
  const op = planFieldSync(item.key, value)
  if ('manual' in op) return
  const nodeId = await nodeFor(call, item.personId)
  await call(op.tool, { nodeId, ...op.args })
  const checkbox = typeof value === 'boolean' ? ' (checkbox via text, unverified)' : ''
  log(`${name}: ${item.key} -> Tana ok${checkbox}`)
}

/** Pushes the queue. An unreachable API keeps it; a refused edit is logged and dropped (never retried blind). */
export async function flush(): Promise<void> {
  if (sync.running || !tanaOn() || prefs.queue.length === 0) return
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

if (prefs.autoSync && prefs.queue.length > 0) void flush()
