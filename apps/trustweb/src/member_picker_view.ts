// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker: the sheet behind "+" on a community's Members: the people I know first (type-to-select, @ and #), below them "Add a new person". */
import { el } from '../../demo/src/ui/dom'
import { loadColourTags } from './colour_tags'
import { eventPersonPicker, type PickerHooks } from './event_person_picker'
import { addKnownMembers, memberExclude } from './member_picker'
import { S } from './strings'

export interface MemberPickerDeps extends PickerHooks {
  tag: string
  tagLabel: string
  /** The sheet's content goes here (main.ts openSheet). */
  open: (body: HTMLElement[]) => void
  /** The people were added: close the sheet, toast, redraw. */
  done: (message: string) => void
  /** "Add a new person": the existing Add-someone view with the tag preset. */
  addNew: () => void
}

export function openMemberPicker(d: MemberPickerDeps): void {
  const name = (id: string): string => d.state().people.find((p) => p.id === id)?.name ?? ''
  const take = (ids: string[]): void => {
    if (!addKnownMembers(d.state().people, ids, d.tag)) return
    d.save()
    d.done(ids.length === 1 ? S.w44pp.added(name(ids[0]), d.tagLabel) : S.w44pp.added(`${ids.length}`, d.tagLabel))
  }
  const picker = eventPersonPicker(d, '', {
    exclude: memberExclude(d.state().people, d.tag), placeholder: S.w44pp.pickHint, ariaLabel: S.w44pp.pickTitle(d.tagLabel),
    inputAttr: 'data-member-search', personAttr: 'data-member-pick', tags: loadColourTags,
    onPick: (id) => take([id]), onPickMany: take, onCreate: () => d.addNew(),
  })
  d.open([
    el('h3', {}, [S.w44pp.pickTitle(d.tagLabel)]),
    picker,
    el('button', { class: 'btn btn-ghost', type: 'button', 'data-member-add-new': '', onclick: d.addNew }, [S.w44pp.addNew]),
  ])
}
