// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 bulk-invite-filter: the "Invite many" sheet of an event page. Add chips (@person, #tag), Except chips, the live list with its count,
 * "Invite N people"; a community event first warns about the people who are not members. Chips and typeahead: chip_input.ts; rules: bulk_invite.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { toInvite, nonMembers } from './bulk_invite'
import { chipInput } from './chip_input'
import type { ColourTag } from './colour_tags'
import { inviteGuests } from './event_draft'
import { eventTagLabel } from './event_tag'
import { tagLabel } from './events'
import type { AppState, TwEvent } from './model'
import { candidates, suggest } from './share_page'
import { S } from './strings'

export interface BulkInviteDeps {
  st: () => AppState
  save: () => void
  tags: () => readonly ColourTag[]
  openSheet: (body: (Node | null)[]) => void
  closeSheet: () => void
  toast: (text: string) => void
}

/** Opens the sheet; `done` runs after people were invited (the event page redraws). */
export function openBulkInvite(ev: TwEvent, d: BulkInviteDeps, done: () => void): void {
  const include: string[] = []
  const exclude: string[] = []
  const all = candidates({ people: d.st().people.filter((p) => p.deleted_at === undefined && !p.via), tags: d.tags() }).filter((c) => /^(person|tag):/.test(c.id))
  const label = (id: string): string => all.find((c) => c.id === id)?.label ?? id
  const label0 = eventTagLabel(tagLabel(ev))
  const list = el('div', { class: 'chips bulk-list', 'data-bulk-list': '' })
  const count = el('p', { class: 'bulk-count', 'data-bulk-count': '' })
  const go = el('button', { class: 'btn btn-electric wide', type: 'button', 'data-bulk-go': '' }) as HTMLButtonElement
  const chipRow = (rows: string[]): HTMLElement => el('div', { class: 'chips' }, rows.map((id) => el('button', { class: 'chip on', type: 'button', 'data-bulk-chip': id, 'aria-label': `${label(id)} ×`, onclick: () => { rows.splice(rows.indexOf(id), 1); refresh() } }, [`${label(id)} ×`])))
  const box = (kind: 'include' | 'exclude', rows: string[], ph: string): HTMLElement => {
    const holder = el('div', { class: 'bulk-chips' })
    const pick = chipInput({
      placeholder: ph, aria: ph, attrs: { 'data-bulk-input': kind },
      hits: (text) => suggest(text, all, [...include, ...exclude]).map((c) => ({ label: c.label, attrs: { 'data-bulk-hit': c.id }, pick: () => { rows.push(c.id); pick.input.value = ''; pick.hits.replaceChildren(); refresh() } })),
    })
    return el('div', { class: 'bulk-row', 'data-bulk-row': kind }, [el('span', { class: 'chips-lbl' }, [S.bulkInvite[kind]]), holder, pick.input, pick.hits])
  }
  const rows = { include: box('include', include, S.bulkInvite.includePh), exclude: box('exclude', exclude, S.bulkInvite.excludePh) }
  function refresh(): void {
    for (const k of ['include', 'exclude'] as const) rows[k].querySelector('.bulk-chips')?.replaceChildren(chipRow(k === 'include' ? include : exclude))
    const who = toInvite(d.st(), ev, include, exclude)
    list.replaceChildren(...who.map((p) => el('span', { class: 'chip', 'data-bulk-person': p.id }, [p.name])))
    count.textContent = who.length ? S.bulkInvite.count(who.length) : S.bulkInvite.nobody
    go.textContent = S.bulkInvite.go(who.length)
    go.disabled = !who.length
    go.onclick = () => {
      const nm = nonMembers(who, ev)
      if (nm.people.length) warn(who.map((p) => p.id), nm.people.length, nm.community ?? '')
      else invite(who.map((p) => p.id))
    }
  }
  function invite(ids: string[]): void {
    inviteGuests(ev, ids)
    d.save(); d.closeSheet(); d.toast(S.bulkInvite.done(ids.length)); done()
  }
  function warn(ids: string[], n: number, community: string): void {
    const name = d.tags().find((t) => t.id === community)?.label ?? community
    d.openSheet([
      el('h3', {}, [S.bulkInvite.title(label0)]),
      el('p', { 'data-bulk-warning': String(n) }, [S.bulkInvite.notMembers(n, name)]),
      el('button', { class: 'btn btn-electric wide', type: 'button', 'data-bulk-anyway': '', onclick: () => invite(ids) }, [S.bulkInvite.anyway]),
      el('button', { class: 'btn btn-ghost wide', type: 'button', onclick: d.closeSheet }, [S.bulkInvite.back]),
    ])
  }
  d.openSheet([
    el('div', { class: 'bulk-invite', 'data-bulk-invite': ev.id }, [el('h3', {}, [S.bulkInvite.title(label0)]), rows.include, rows.exclude, count, list, go,
      el('button', { class: 'btn btn-ghost wide', type: 'button', onclick: d.closeSheet }, [S.close])]),
  ])
  refresh()
}
