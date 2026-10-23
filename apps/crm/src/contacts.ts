/**
 * Contact list logic: search, grouping by ring, sorting by last activity, and
 * the pipeline (lines tagged opportunity / looking / offer by stage). Pure.
 */
import type { NoteLine, Person } from '../../trustweb/src/model'
import { LineStatus, Tag } from '../../trustweb/src/model'
import type { Contact, CrmView } from './model'
import { ContactPointKind, Stage } from './model'
import { RING_ORDER, ringOf } from './rings'
import type { RingId } from './rings'
import { lastActivity } from './timeline'

export enum SortOrder {
  Recent = 'recent',
  Name = 'name',
}

export function norm(s: string): string {
  return s.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
}

/** Name, context, any current line, or a custom tag. */
export function matches(p: Person, query: string): boolean {
  const q = norm(query.trim())
  if (!q) return true
  if (norm(p.name).includes(q) || norm(p.context).includes(q)) return true
  return p.lines.some((l) => l.status === LineStatus.Current
    && (norm(l.text).includes(q) || (l.customTag !== undefined && norm(l.customTag).includes(q))))
}

export interface ContactRow {
  person: Person
  lastAt: number
  openLines: number
}

export function contactRows(view: CrmView, query: string, order: SortOrder): ContactRow[] {
  const rows = view.app.people.filter((p) => matches(p, query)).map((person) => ({
    person,
    lastAt: lastActivity(view, person.id),
    openLines: person.lines.filter((l) => l.status === LineStatus.Current).length,
  }))
  return rows.sort((a, b) => order === SortOrder.Name
    ? a.person.name.localeCompare(b.person.name)
    : b.lastAt - a.lastAt || a.person.name.localeCompare(b.person.name))
}

/** Ids in the stored order; ids it lacks follow in their current order. */
export function inCustomOrder<T>(items: T[], idOf: (t: T) => string, stored: string[] | undefined): T[] {
  const at = (t: T): number => { const i = (stored ?? []).indexOf(idOf(t)); return i < 0 ? Infinity : i }
  return [...items].sort((a, b) => (at(a) === at(b) ? 0 : at(a) - at(b)))
}

/** The stored order of a section after `id` was dropped before `before` (the end when null). */
export function moveInOrder(current: string[], id: string, before: string | null): string[] {
  const rest = current.filter((x) => x !== id)
  const at = before === null ? -1 : rest.indexOf(before)
  rest.splice(at < 0 ? rest.length : at, 0, id)
  return rest
}

/** The collapsed ring groups after `key` was toggled. */
export const toggleGroup = (collapsed: readonly string[], key: string): string[] =>
  collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]

/** Hide every group; when all are hidden already, show them all. */
export const toggleAll = (collapsed: readonly string[], keys: readonly string[]): string[] =>
  keys.every((k) => collapsed.includes(k)) ? [] : [...keys]

/** Rows grouped by ring in ring order (closest first, family, then unsorted), empty rings left out. */
export function groupByRing(rows: ContactRow[]): { ring: RingId; rows: ContactRow[] }[] {
  return RING_ORDER
    .map((ring) => ({ ring, rows: rows.filter((r) => ringOf(r.person.ring) === ring) }))
    .filter((g) => g.rows.length > 0)
}

export const PIPELINE_TAGS: readonly Tag[] = [Tag.Opportunity, Tag.Looking, Tag.Offer]

export interface PipelineCard {
  person: Person
  line: NoteLine
  stage: Stage
}

/** Every current opportunity / looking / offer line, with its stage. */
export function pipeline(view: CrmView): PipelineCard[] {
  const cards: PipelineCard[] = []
  for (const person of view.app.people) {
    for (const line of person.lines) {
      if (line.status !== LineStatus.Current || !PIPELINE_TAGS.includes(line.tag)) continue
      cards.push({ person, line, stage: view.crm.stages[line.id] ?? Stage.Idea })
    }
  }
  return cards.sort((a, b) => b.line.notedAt - a.line.notedAt)
}

export function byStage(cards: PipelineCard[], stage: Stage): PipelineCard[] {
  return cards.filter((c) => c.stage === stage)
}

/** Name, organisation, title, email or phone digits. */
export function contactMatches(c: Contact, query: string): boolean {
  const q = norm(query.trim())
  if (!q) return true
  const text = [c.name, c.org ?? '', c.title ?? '', ...c.emails].map(norm)
  if (text.some((t) => t.includes(q))) return true
  const digits = q.replace(/\D/g, '')
  return digits.length >= 3 && c.phones.some((p) => p.replace(/\D/g, '').includes(digits))
}

/** Imported contacts matching the search, by name. */
export function visibleContacts(list: readonly Contact[], query: string): Contact[] {
  return list.filter((c) => contactMatches(c, query)).sort((a, b) => a.name.localeCompare(b.name))
}

export function pointHref(kind: ContactPointKind, value: string): string {
  return kind === ContactPointKind.Phone ? `tel:${value.replace(/[^\d+]/g, '')}` : `mailto:${encodeURI(value)}`
}

/** "1985-03-12" -> "12 Mar 1985"; "--07-21" -> "21 Jul"; anything else as written. */
export function birthdayText(birthday: string, months: readonly string[]): string {
  const m = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/.exec(birthday)
  const month = m ? months[Number(m[2]) - 1] : undefined
  if (!m || !month) return birthday
  return `${Number(m[3])} ${month}${m[1] ? ` ${m[1]}` : ''}`
}
