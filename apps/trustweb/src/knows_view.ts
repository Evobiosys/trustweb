/** The "Knows" chip row on a person's card: who they are connected to (Person.knows), drawn as edges in the Network view. */
import { el } from '../../demo/src/ui/dom'
import { matchPeople } from './events'
import type { Person } from './model'
import { notePreview } from './person_image'
import { onHoverOrLongPress } from './press'
import { shortLabel } from './short_label'
import { S } from './strings'

/** `open`: a press on a name opens that person's card; `face`: their picture (or initials) as the small card shows it. `people` holds no archived contact. */
export function knowsRow(p: Person, people: readonly Person[], save: () => void, redraw: () => void, open: (id: string) => void, face: (x: Person) => HTMLElement): HTMLElement {
  const known = people.filter((x) => p.knows?.includes(x.id))
  const entry = (x: Person): HTMLElement => {
    const note = notePreview(x)
    const peek = el('span', { class: 'knows-peek', hidden: true, 'data-knows-peek': x.id }, [face(x), note ? el('span', { class: 'knows-note' }, [note]) : null])
    const chip = el('span', { class: 'chip knows-chip', 'data-knows-chip': x.id }, [
      el('button', { class: 'knows-name', 'data-knows-open': x.id, 'aria-label': S.knowsOpenAria(x.name), title: x.name, onclick: () => open(x.id) }, [shortLabel(x.name)]),
      el('button', {
        class: 'btn btn-ghost btn-sm', 'aria-label': S.knowsRemove(x.name),
        onclick: () => { p.knows = p.knows?.filter((id) => id !== x.id); if (!p.knows?.length) delete p.knows; save(); redraw() },
      }, ['×']),
      peek,
    ])
    const close = (e: Event): void => { if (!chip.contains(e.target as Node)) peek.hidden = true }
    onHoverOrLongPress(chip, () => { peek.hidden = false; document.addEventListener('pointerdown', close, { once: true }) }, () => { peek.hidden = true })
    return chip
  }
  const box = el('div', { class: 'chips', 'data-person-knows': p.id }, [el('span', { class: 'chips-lbl' }, [S.knowsTitle]), ...known.map(entry)])
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
