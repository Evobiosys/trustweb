/** Saves a field edit, queues it for Tana when the person chose Tana, and pushes the queue (auto or "Sync now"). */
import { dayKey } from './dates'
import { mergedFields, baseFields, HIDE_KEY, INTENDING_KEY, NOTES_KEY, SINCE_KEY } from './fields'
import { InteractionKind } from './model'
import { entityValues, splitName } from './person_view'
import { LAST_NAME_KEY } from './placement'
import type { FieldValue } from './fields'
import { prefs, savePrefs, tanaOn } from './prefs.svelte'
import { addInteraction, hidePerson, setField, store, unhidePerson } from './state.svelte'
import { FAMILY_KEY, RING_APPROVED_KEY, RING_KEY } from './rings'
import { parseSuggestions } from './suggestions'
import { PERSON_TAG_ID, connect, nodeIdIn, planFieldSync } from './tana_sync'
import type { ToolCall } from './tana_sync'

const MAX_LOG = 100
const TANA_PREFIX = 'tana-'
/** The queue key of "take #person off the node" (not a field). */
const UNTAG_KEY = '#untag'
/** The queue key of "move this node under another person's node" (a merge); `into` is the survivor. */
const MOVE_KEY = '#move'
/** The queue key of "rename the node"; `rename` holds the full old and new name. */
const RENAME_KEY = '#rename'
/** read_node shows the checkbox as `**ring approved**: [X]`. */
const APPROVED_RE = /ring approved\**:\s*\[X\]/i

export const sync = $state({ running: false })

function log(text: string): void {
  prefs.log = [`${new Date().toTimeString().slice(0, 8)} ${text}`, ...prefs.log].slice(0, MAX_LOG)
  savePrefs()
}

const DEBOUNCE_MS = 2000
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** `approved` = the person set or confirmed this value (a ring then goes to Tana with "ring approved" ticked). */
function queueOnce(personId: string, key: string, approved = false): void {
  const queued = prefs.queue.find((q) => q.personId === personId && q.key === key && !q.append)
  if (queued) queued.approved ||= approved
  else prefs.queue.push({ personId, key, ...(approved ? { approved } : {}) })
  savePrefs()
}

/** The edit goes to the CRM's own record first; Tana hears about it 2 s after the last keystroke of that field (auto sync), or on "Sync now". */
export function saveField(personId: string, key: string, value: FieldValue): void {
  setField(personId, key, value)
  if (!tanaOn() || 'manual' in planFieldSync(key, value)) return
  // Queued (and persisted) at once, so a window killed inside the 2 s still replays the edit on the next boot.
  queueOnce(personId, key, true)
  if (!prefs.autoSync) return
  const id = `${personId}|${key}`
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => { timers.delete(id); void flush() }, DEBOUNCE_MS))
}

/** Inline name edit: the CRM's own record at once (given + last name), the Tana node name through the queue. */
export function renamePerson(personId: string, from: string, to: string): void {
  const next = to.trim()
  if (!next || next === from) return
  const { first, last } = splitName(next)
  setField(personId, 'tw-first', first)
  setField(personId, LAST_NAME_KEY, last)
  if (!tanaOn() || !knownNode(personId)) return
  prefs.queue.push({ personId, key: RENAME_KEY, rename: { from, to: next } })
  savePrefs()
  if (prefs.autoSync) void flush()
}

/** Queues one note line ("2026-10-14 text") for Tana's "Notes from TrustWeb"; pushed at once (auto sync) or with "Sync now". */
export function noteToTana(personId: string, text: string, at: number = Date.now()): void {
  if (!tanaOn()) return
  prefs.queue.push({ personId, key: NOTES_KEY, append: `${dayKey(at)} ${text.replace(/\s+/g, ' ').trim()}` })
  savePrefs()
  if (prefs.autoSync) void flush()
}

/** A typed note: saved at once as a Note on the timeline, and queued for Tana. */
export function addNote(personId: string, text: string): void {
  const t = text.trim()
  if (!t) return
  addInteraction(personId, InteractionKind.Note, t)
  noteToTana(personId, t)
}

/** Takes #person off the node in Tana (a queued edit, like the others) and the person out of every list here. */
export function untagPerson(personId: string): void {
  if (tanaOn() && knownNode(personId)) {
    prefs.queue.push({ personId, key: UNTAG_KEY })
    savePrefs()
    if (prefs.autoSync) void flush()
  }
  hidePerson(personId)
}

/** After a merge: the loser's Tana node moves under the survivor's (queued behind the note and the hide). */
export function moveUnder(personId: string, intoId: string): void {
  if (!tanaOn() || !knownNode(personId) || !knownNode(intoId)) return
  prefs.queue.push({ personId, key: MOVE_KEY, into: intoId })
  savePrefs()
  if (prefs.autoSync) void flush()
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

function knownNode(personId: string): string | undefined {
  return personId.startsWith(TANA_PREFIX) ? personId.slice(TANA_PREFIX.length) : prefs.nodeIds[personId]
}

async function nodeFor(call: ToolCall, personId: string): Promise<string> {
  const known = knownNode(personId)
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

async function push(call: ToolCall, item: { personId: string; key: string; approved?: boolean; append?: string; into?: string; rename?: { from: string; to: string } }): Promise<void> {
  if (item.key === RENAME_KEY && item.rename) {
    await call('edit_node', { nodeId: await nodeFor(call, item.personId), name: { old_string: item.rename.from, new_string: item.rename.to } })
    log(`${item.rename.from}: renamed to ${item.rename.to} in Tana`)
    return
  }
  if (item.key === UNTAG_KEY) {
    await call('tag', { nodeId: await nodeFor(call, item.personId), action: 'remove', tagIds: [PERSON_TAG_ID] })
    log(`${item.personId}: #person removed in Tana`)
    return
  }
  if (item.key === MOVE_KEY && item.into) {
    await call('move_node', { nodeId: await nodeFor(call, item.personId), targetNodeId: await nodeFor(call, item.into) })
    log(`${item.personId}: moved under ${item.into} in Tana`)
    return
  }
  const person = store.app.people.find((p) => p.id === item.personId)
  const name = person?.name ?? store.crm.hiddenPeople?.find((h) => h.id === item.personId)?.name ?? item.personId
  if (item.append) {
    await call('set_field_content', { nodeId: await nodeFor(call, item.personId), attributeId: item.key, content: item.append, mode: 'append' })
    log(`${name}: note -> Tana ok`)
    return
  }
  const edits = store.crm.personFields?.[item.personId]
  if (item.key === RING_KEY && !person) return
  const value = (item.key === RING_KEY && person ? entityValues(person, baseFields(person), edits) : mergedFields(person ? baseFields(person) : undefined, edits))[item.key]
  const op = planFieldSync(item.key, value)
  if ('manual' in op) return
  const nodeId = await nodeFor(call, item.personId)
  // A suggestion never replaces a ring Jakob approved in Tana.
  if (item.key === RING_KEY && !item.approved && APPROVED_RE.test(await call('read_node', { nodeId }))) {
    log(`${name}: ring already approved in Tana, suggestion skipped`)
    return
  }
  await call(op.tool, { nodeId, ...op.args })
  // "ring approved" is ticked when the person set or confirmed the ring (an approved item), open while it is only a suggestion.
  if (item.key === RING_KEY) await call('set_field_content', { nodeId, attributeId: RING_APPROVED_KEY, content: item.approved ? '[X]' : '[ ]', mode: 'replace' })
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

/** Once per person whose ring came from a suggestion: queues the suggested ring (approved [ ]), family tag and desire (number + since date) for Tana. */
function queueSuggested(): void {
  if (!tanaOn()) return
  const suggestions = parseSuggestions(__TW_SUGGESTIONS__)
  for (const p of store.app.people) {
    const s = suggestions[p.id]
    if (!s || !(p as { ringSuggested?: boolean }).ringSuggested) continue
    const keys = [
      ...(prefs.ringQueued.includes(p.id) ? [] : [RING_KEY]),
      ...(prefs.suggestedQueued.includes(p.id) ? [] : [...(s.family ? [FAMILY_KEY] : []), ...(s.intending > 0 ? [INTENDING_KEY, SINCE_KEY] : [])]),
    ]
    for (const key of keys) {
      if (!prefs.queue.some((q) => q.personId === p.id && q.key === key && !q.append)) prefs.queue.push({ personId: p.id, key })
    }
    if (!prefs.suggestedQueued.includes(p.id)) prefs.suggestedQueued.push(p.id)
    if (!prefs.ringQueued.includes(p.id)) prefs.ringQueued.push(p.id)
  }
  savePrefs()
}

/** Standalone only (hosted, the ring is the record's): local wins, a ring edit that differs from the record's ring goes to Tana again on every boot until the record catches up. */
function queueLocalRings(): void {
  if (!tanaOn()) return
  for (const p of store.app.people) {
    const ring = store.crm.personFields?.[p.id]?.[RING_KEY]
    if (typeof ring === 'string' && ring !== p.ring) queueOnce(p.id, RING_KEY, true)
  }
}

queueSuggested()
queueLocalRings()
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { void flush() })
if (prefs.autoSync && prefs.queue.length > 0) void flush()
