// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 hover-sources: the card on a dashed line ("Y and Z: friends (we think, 0.7)" / Why / Correct this / Not related) and the person-card section "How they relate to others I know". DOM; the callers pass the app in. */
import { el } from '../../demo/src/ui/dom'
import { alphaHeading } from './alpha_heading'
import { allColourTags } from './colour_tags'
import type { AppState, Person } from './model'
import { KINDS, relationIndex } from './relations_model'
import type { Relation, RelationIndex, RelationKind } from './relations_model'
import { headline, kindName, sourceText, whyLine } from './relations_text'
import { shortLabel } from './short_label'
import { S } from './strings'

/** The people to relate: `people` holds no archived or deleted contact. */
export const relationsOf = (s: AppState, people: readonly Person[]): RelationIndex =>
  relationIndex({ me: s.me, people, tags: allColourTags(), events: s.events, groups: s.groups, relations: s.relations })

export interface RelationIo {
  /** Says how a pair relates ('none' = not related). */
  set: (a: string, b: string, kind: RelationKind | 'none') => void
  /** Takes my statement back: the pair is derived again. */
  clear: (a: string, b: string) => void
}

const kindButtons = (onPick: (k: RelationKind) => void): HTMLElement =>
  el('div', { class: 'rel-kinds', 'data-rel-kinds': '' }, KINDS.map((k) => el('button', { class: 'linkbtn', type: 'button', 'data-rel-kind': k, onclick: () => onPick(k) }, [kindName(k)])))

/** The hover / tap card on one dashed line. */
export function relationCard(r: Relation, name: (id: string) => string, io: RelationIo): HTMLElement {
  const y = name(r.a), z = name(r.b)
  const body = el('div', { class: 'rel-actions' })
  const showButtons = (): void => body.replaceChildren(
    el('button', { class: 'linkbtn', type: 'button', 'data-rel-correct': '', onclick: () => body.replaceChildren(el('p', { class: 'meta' }, [S.relations.pick]), kindButtons((k) => io.set(r.a, r.b, k))) }, [S.relations.correct]),
    el('button', { class: 'linkbtn', type: 'button', 'data-rel-none': '', onclick: () => io.set(r.a, r.b, 'none') }, [S.relations.notRelated]),
  )
  showButtons()
  return el('div', { class: 'ring-card rel-card', 'data-rel-card': `${r.a}|${r.b}`, role: 'dialog', 'aria-label': S.relations.aria(y, z) }, [
    el('b', { 'data-rel-headline': '' }, [headline(r, y, z)]),
    el('span', { class: 'meta', 'data-rel-why': '' }, [whyLine(r)]),
    body,
  ])
}

/** The person card's section: who this person relates to, with the same source lines, editable. */
export function relationsSection(p: Person, s: AppState, people: readonly Person[], open: (id: string) => void, io: RelationIo): HTMLElement {
  const byId = new Map(people.map((x) => [x.id, x]))
  const rows = relationsOf(s, people).of(p.id)
  const hidden = (s.relations ?? []).filter((r) => r.kind === 'none' && (r.a === p.id || r.b === p.id)).map((r) => byId.get(r.a === p.id ? r.b : r.a)).filter((x): x is Person => x !== undefined)
  const row = (r: Relation): HTMLElement => {
    const other = byId.get(r.a === p.id ? r.b : r.a)!
    const pick = el('select', { class: 'field', 'aria-label': S.relations.correct, 'data-rel-select': other.id,
      onchange: (e: Event) => io.set(p.id, other.id, (e.target as HTMLSelectElement).value as RelationKind) },
      KINDS.map((k) => el('option', { value: k, ...(k === r.kind ? { selected: '' } : {}) }, [kindName(k)]))) as HTMLSelectElement
    return el('li', { class: 'rel-row', 'data-rel-row': other.id }, [
      el('button', { class: 'linkbtn', type: 'button', 'data-rel-open': other.id, title: other.name, onclick: () => open(other.id) }, [shortLabel(other.name)]),
      ' ', S.relations.short(kindName(r.kind), r.confidence),
      el('div', { class: 'meta' }, [S.relations.why + r.sources.map(sourceText).join('; ')]),
      pick, ' ',
      el('button', { class: 'linkbtn', type: 'button', 'data-rel-none': other.id, onclick: () => io.set(p.id, other.id, 'none') }, [S.relations.notRelated]),
    ])
  }
  return el('div', { class: 'rel-section', 'data-person-relations': p.id }, [
    el('span', { class: 'chips-lbl' }, alphaHeading(S.relations.section)),
    rows.length || hidden.length ? el('ul', { class: 'rel-list' }, [
      ...rows.map(row),
      ...hidden.map((o) => el('li', { class: 'rel-row', 'data-rel-hidden': o.id }, [S.relations.hidden(o.name), ' ', el('button', { class: 'linkbtn', type: 'button', onclick: () => io.clear(p.id, o.id) }, [S.relations.undo])])),
    ]) : el('p', { class: 'meta' }, [S.relations.empty]),
  ])
}
