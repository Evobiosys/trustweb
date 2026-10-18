/** Pure parts of the notes sync (notes_sync.svelte.ts): the payload for the bridge and how the vault's changes land in the record. */
import { Provenance } from '../../trustweb/src/model'
import type { NoteLine, Person } from '../../trustweb/src/model'
import { InteractionKind } from './model'
import type { Interaction } from './model'
import { effectivePerson } from './person_view'

export interface Change { id: string; path: string; newLines: { text: string; date: string }[] }
export interface PushResult { written: number; unchanged: number; noHome: number; pages: number; errors: string[] }

/**
 * The people as the Curator sees them (ring and name edits folded in), for the bridge. The Curator's own notes and
 * what-happened entries (interactions) ride along as bullets with ids `crm-<id>`, so the vault block shows them too.
 */
export function peoplePayload(people: readonly Person[], edits: Record<string, Record<string, unknown>> | undefined, interactions: readonly Interaction[] = []): Person[] {
  const extra = new Map<string, NoteLine[]>()
  for (const i of interactions) {
    const text = i.kind === InteractionKind.Note ? i.text : `${KIND_LABEL[i.kind]}${i.text ? `: ${i.text}` : ''}${i.place ? ` (${i.place})` : ''}`
    if (!text.trim()) continue
    ;(extra.get(i.personId) ?? extra.set(i.personId, []).get(i.personId)!).push({ id: `crm-${i.id}`, text, tag: 'note' as NoteLine['tag'], audience: 'me' as NoteLine['audience'], status: 'current' as NoteLine['status'], notedAt: i.at, checkedAt: i.at })
  }
  return people.map((p) => { const e = effectivePerson(p, edits?.[p.id] as never); const x = extra.get(p.id); return x ? { ...e, lines: [...e.lines, ...x] } : e })
}
const KIND_LABEL: Record<InteractionKind, string> = { [InteractionKind.Met]: 'Met', [InteractionKind.Call]: 'Call', [InteractionKind.Message]: 'Message', [InteractionKind.Event]: 'Event', [InteractionKind.Note]: 'Note' }

export interface ApplyHooks {
  addLine(personId: string, line: NoteLine): void
  now(): number
  newId(): string
}

/** Applies what the vault said: each added bullet as a line with local provenance (the note's path). A ring edited in the file never moves TrustWeb's (the bridge notes the difference in the md instead). */
export function applyChanges(changes: readonly Change[], people: readonly Person[], h: ApplyHooks): { lines: number } {
  let lines = 0
  for (const c of changes) {
    const p = people.find((x) => x.id === c.id)
    if (!p) continue
    const have = new Set(p.lines.map((l) => l.text.trim().toLowerCase()))
    for (const n of c.newLines) {
      const text = n.text.trim()
      if (!text || have.has(text.toLowerCase())) continue
      have.add(text.toLowerCase())
      const at = n.date ? Date.parse(`${n.date}T12:00:00Z`) : h.now()
      h.addLine(p.id, { id: h.newId(), text, tag: 'note' as NoteLine['tag'], audience: 'me' as NoteLine['audience'], status: 'current' as NoteLine['status'], notedAt: at, checkedAt: at, source: { kind: Provenance.Local, path: c.path } })
      lines++
    }
  }
  return { lines }
}
