// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 (group-tags): Settings > Your web > Tags. Create group tags, put tags under them, leave people out, mark a tag managed with stewards, fork. Redraws itself in place (the Settings sheet stays as it is). Edits are tag_manager.ts. */
import { el } from '../../demo/src/ui/dom'
import { alphaHeading } from './alpha_heading'
import { memberIds, type ColourTag } from './colour_tags'
import { tagPill } from './components/tag_pill'
import type { Person } from './model'
import { foldText } from './settings_search'
import { S } from './strings'
import { addChild, createGroup, forkTag, removeChild, setManaged, toggleExclude, toggleSteward } from './tag_manager'
import { childrenOf, toTag } from './tags_model'

export interface TagManagerIo {
  tags: () => ColourTag[]
  saveTags: (tags: readonly ColourTag[]) => void
  people: () => readonly Person[]
  toast: (text: string) => void
}

export function tagManagerView(io: TagManagerIo): HTMLElement {
  const root = el('details', { class: 'settings-adv', 'data-settings-tags': '' })
  /** The rows open at the last redraw (read from the DOM, so a redraw never closes what the person works in). */
  let open = new Set<string>()
  let draft = ''

  /** Runs an edit; a refused one (a loop) says so and changes nothing. */
  const apply = (edit: (tags: readonly ColourTag[]) => ColourTag[]): void => {
    try { io.saveTags(edit(io.tags())) } catch (e) { io.toast((e as Error).message === 'cycle' ? S.tagsCycle : S.tagsGone) }   // review wave 40: not every refusal is a loop
    draw()
  }
  const nameOf = (id: string): string => io.people().find((p) => p.id === id)?.name ?? id
  const personBox = (attr: string, taken: readonly string[], pick: (id: string) => void): HTMLElement => {
    const hits = el('div', { class: 'chips' })
    const input = el('input', { class: 'field', type: 'search', placeholder: S.tagsFindPh, 'aria-label': S.tagsFindPh, autocomplete: 'off', [attr]: '' }) as HTMLInputElement
    input.addEventListener('input', () => {
      const q = foldText(input.value)
      hits.replaceChildren(...(q ? io.people().filter((p) => !taken.includes(p.id) && foldText(p.name).includes(q)).slice(0, 5) : []).map((p) => el('button', { class: 'chip', type: 'button', 'data-tag-person-hit': p.id, onclick: () => pick(p.id) }, [p.name])))
    })
    return el('div', {}, [input, hits])
  }
  const people = (label: string, ids: readonly string[], attr: string, drop: (id: string) => void): HTMLElement | null => ids.length === 0 ? null : el('div', { class: 'chips', [attr]: '' }, [
    el('span', { class: 'chips-lbl' }, [label]),
    ...ids.map((id) => el('button', { class: 'chip on', type: 'button', 'aria-label': S.supportRemove(nameOf(id)), onclick: () => drop(id) }, [nameOf(id) + ' ×'])),
  ])

  const row = (t: ColourTag, all: readonly ColourTag[]): HTMLElement => {
    const m = toTag(t)
    const kids = childrenOf(all.map(toTag), t.id)
    const addable = all.filter((x) => x.id !== t.id && !x.system && !m.parents.includes(x.id) && !kids.some((k) => k.id === x.id))
    return el('details', { class: 'tm-row', 'data-tag-row': t.id, ...(open.has(t.id) ? { open: '' } : {}) }, [
      el('summary', { class: 'tm-head' }, [tagPill(t), el('span', { class: 'tm-count' }, [S.tagsCount(memberIds(io.people(), all, t.id).length)]), m.forkedFrom ? el('span', { class: 'tm-count' }, [S.tagsForkedFrom(all.find((x) => x.id === m.forkedFrom)?.label ?? m.forkedFrom)]) : null]),
      el('div', { class: 'chips', 'data-tag-children': t.id }, [
        el('span', { class: 'chips-lbl' }, [S.tagsChildren]),
        ...(kids.length ? kids.map((k) => tagPill(all.find((x) => x.id === k.id) as ColourTag, { class: 'chip', text: k.name + ' ×', attrs: { 'data-tag-child': k.id, 'aria-label': S.tagsRemoveChild(k.name) }, onclick: () => apply((l) => removeChild(l, t.id, k.id)) })) : [el('span', { class: 'meta' }, [S.tagsNoChildren])]),
      ]),
      el('select', { class: 'field', 'aria-label': S.tagsAddChild, 'data-tag-add-child': t.id, onchange: (e) => { const v = (e.target as HTMLSelectElement).value; if (v) apply((l) => addChild(l, t.id, v)) } }, [
        el('option', { value: '' }, [S.tagsAddChild]), ...addable.map((x) => el('option', { value: x.id }, [x.label ?? x.id])),
      ]),
      people(S.tagsLeftOut, m.excludes, 'data-tag-excluded', (id) => apply((l) => toggleExclude(l, t.id, id))),
      personBox('data-tag-exclude-find', m.excludes, (id) => apply((l) => toggleExclude(l, t.id, id))),
      el('label', { class: 'radio' }, [
        el('input', { type: 'checkbox', 'data-tag-managed': t.id, ...(m.kind === 'managed' ? { checked: '' } : {}), onchange: (e) => apply((l) => setManaged(l, t.id, (e.target as HTMLInputElement).checked)) }),
        el('span', {}, [S.tagsManaged]),
      ]),
      ...(m.kind === 'managed' ? [
        people(S.tagsStewards, m.stewardIds, 'data-tag-stewards', (id) => apply((l) => toggleSteward(l, t.id, id))),
        personBox('data-tag-steward-find', m.stewardIds, (id) => apply((l) => toggleSteward(l, t.id, id))),
      ] : []),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-tag-fork': t.id, onclick: () => apply((l) => forkTag(l, t.id)) }, [S.tagsFork]),
    ].filter((n): n is HTMLElement => n !== null))
  }

  const draw = (): void => {
    const all = io.tags().filter((t) => !t.system)
    const create = (): void => {
      const name = draft.trim()
      if (!name) return
      draft = ''
      apply((l) => createGroup(l, name))
    }
    const input = el('input', { class: 'field', placeholder: S.tagsNewPh, 'aria-label': S.tagsNewPh, maxlength: '40', value: draft, 'data-tag-new': '', oninput: (e) => { draft = (e.target as HTMLInputElement).value } }) as HTMLInputElement
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create() } })
    const wasOpen = (root as HTMLDetailsElement).open
    open = new Set(Array.from(root.querySelectorAll<HTMLDetailsElement>('[data-tag-row]')).filter((d) => d.open).map((d) => d.dataset.tagRow ?? ''))
    root.replaceChildren(
      el('summary', { class: 'adv-toggle' }, alphaHeading(S.tagsTitle)),
      el('div', { class: 'tag-manager' }, [
        el('p', { class: 'meta' }, [S.tagsLead]),
        el('div', { class: 'tm-head' }, [input, el('button', { class: 'btn btn-ghost', type: 'button', 'data-tag-create': '', onclick: create }, [S.tagsCreate])]),
        ...(all.length ? all.map((t) => row(t, all)) : [el('p', { class: 'meta' }, [S.tagsNone])]),
      ]),
    )
    ;(root as HTMLDetailsElement).open = wasOpen
  }
  draw()
  return root
}
