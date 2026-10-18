/** The "Knows" chip row on a person's card: who they are connected to (Person.knows), drawn as edges in the Network view. */
import { el } from '../../demo/src/ui/dom'
import { matchPeople } from './events'
import type { Person } from './model'
import { S } from './strings'

export function knowsRow(p: Person, people: readonly Person[], save: () => void, redraw: () => void): HTMLElement {
  const known = people.filter((x) => p.knows?.includes(x.id))
  const box = el('div', { class: 'chips', 'data-person-knows': p.id }, [
    el('span', { class: 'chips-lbl' }, [S.knowsTitle]),
    ...known.map((x) => el('span', { class: 'chip', 'data-knows-chip': x.id }, [x.name, el('button', {
      class: 'btn btn-ghost btn-sm', 'aria-label': S.knowsRemove(x.name),
      onclick: () => { p.knows = p.knows?.filter((id) => id !== x.id); if (!p.knows?.length) delete p.knows; save(); redraw() },
    }, ['×'])])),
  ])
  const pick = (): void => {
    const input = el('input', { class: 'field', placeholder: S.knowsSearch, 'aria-label': S.knowsSearch, 'data-knows-search': '' }) as HTMLInputElement
    const results = el('div', { class: 'chips' })
    const draw = (): void => results.replaceChildren(...matchPeople(people.filter((x) => x.id !== p.id && !p.knows?.includes(x.id)), input.value).map((x) =>
      el('button', { class: 'chip', 'data-knows-pick': x.id, onclick: () => { p.knows = [...(p.knows ?? []), x.id]; save(); redraw() } }, [x.name])))
    input.addEventListener('input', draw)
    draw()
    add.replaceWith(el('div', {}, [input, results]))
    input.focus()
  }
  const add = el('button', { class: 'chip', 'data-knows-add': '', onclick: pick }, [S.knowsAdd])
  box.append(add)
  return box
}
