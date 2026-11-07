// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 (invitations.ts): the Resources section "Invited to", its add/edit and paste sheets, and the Invitations line on a person card. DOM and words only; main.ts passes the app in. */
import { el } from '../../demo/src/ui/dom'
import type { AppState, Invitation, Person } from './model'
import { INVITATION_STATUSES, groupByPlace, invitationsOfHost, newInvitation, parseInvitationList } from './invitations'
import { S } from './strings'

export interface InvitationIo {
  st: () => AppState
  save: () => void
  render: () => void
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (text: string) => void
  newId: () => string
}

const hostName = (s: AppState, i: Invitation): string => s.people.find((p) => p.id === i.host)?.name ?? ''

/** One line per invitation: the event, else who invited me; the date after it. */
const label = (s: AppState, i: Invitation): string => [i.event || hostName(s, i) || i.place || '', i.date ?? '', i.status === 'open' ? '' : S.invitedStatuses[i.status]].filter(Boolean).join(' · ')

function row(io: InvitationIo, i: Invitation): HTMLElement {
  return el('button', { class: 'prow', 'data-invitation': i.id, onclick: () => invitationSheet(io, i) }, [
    el('span', { class: 'who' }, [el('b', {}, [label(io.st(), i)])]),
  ])
}

/** Resources: the section, grouped by place. */
export function invitationsSection(io: InvitationIo): Node[] {
  const s = io.st()
  const groups = groupByPlace(s.invitations ?? [])
  return [
    el('section', { class: 'invited', 'data-invited': '' }, [
      el('h3', {}, [S.invitedTitle]),
      groups.length === 0 ? el('p', { class: 'empty' }, [S.invitedEmpty]) : null,
      ...groups.flatMap((g) => [el('h4', { class: 'eyebrow', 'data-invited-place': g.place }, [g.place || S.invitedNoPlace]), ...g.items.map((i) => row(io, i))]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-invitation-add': '', onclick: () => invitationSheet(io) }, [S.invitedAdd]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-invitation-paste': '', onclick: () => pasteSheet(io) }, [S.invitedPaste]),
    ]),
  ]
}

/** Add (preset: place and/or host from a card) or edit one invitation. */
export function invitationSheet(io: InvitationIo, existing?: Invitation, preset?: { host?: string; place?: string }): void {
  const s = io.st()
  const text = (v = '', type = 'text'): HTMLInputElement => el('input', { class: 'field', type, value: v })
  const place = text(existing?.place ?? preset?.place)
  const event = text(existing?.event)
  const date = text(existing?.date, 'date')
  const link = text(existing?.link, 'url')
  const note = el('textarea', { class: 'field', rows: '2' }, [existing?.note ?? ''])
  const host = el('select', { class: 'field', 'data-invitation-host': '' }, [
    el('option', { value: '' }, [S.invitedHostNone]),
    ...s.people.map((p) => el('option', { value: p.id }, [p.name])),
  ])
  host.value = existing?.host ?? preset?.host ?? ''
  const status = el('select', { class: 'field', 'data-invitation-status': '' }, INVITATION_STATUSES.map((k) => el('option', { value: k }, [S.invitedStatuses[k]])))
  status.value = existing?.status ?? 'open'
  const error = el('p', { class: 'warn', 'data-invitation-error': '', hidden: true })
  const field = (name: string, input: HTMLElement): Node[] => [el('label', { class: 'meta' }, [name]), input]
  const save = (): void => {
    const made = newInvitation({ place: place.value, host: host.value, event: event.value, date: date.value, link: link.value, note: note.value, status: status.value }, existing?.id ?? io.newId(), existing?.source)
    if (typeof made === 'string') { error.textContent = S.invitedErr[made]; error.hidden = false; return }
    s.invitations = [...(s.invitations ?? []).filter((i) => i.id !== made.id), made]
    io.save()
    io.closeSheet()
    io.render()
  }
  io.openSheet([
    el('h3', {}, [S.invitedTitle]),
    ...field(S.invitedPlace, place), ...field(S.invitedHost, host), ...field(S.invitedEvent, event),
    ...field(S.invitedDate, date), ...field(S.invitedLink, link), ...field(S.invitedStatus, status), ...field(S.invitedNote, note),
    error,
    el('button', { class: 'btn btn-electric wide', 'data-invitation-save': '', onclick: save }, [S.invitedSave]),
    existing ? el('button', { class: 'btn btn-ghost btn-sm', 'data-invitation-remove': existing.id, onclick: () => { s.invitations = (s.invitations ?? []).filter((i) => i.id !== existing.id); io.save(); io.closeSheet(); io.render() } }, [S.invitedRemove]) : null,
  ])
}

/** "Place: Person, Person" lines become invitations. */
export function pasteSheet(io: InvitationIo): void {
  const box = el('textarea', { class: 'field', rows: '6', placeholder: S.invitedPastePh, 'aria-label': S.invitedPaste, 'data-invitation-paste-text': '' }) as HTMLTextAreaElement
  io.openSheet([
    el('h3', {}, [S.invitedPaste]),
    el('p', { class: 'meta' }, [S.invitedPasteLead]),
    box,
    el('button', { class: 'btn btn-electric wide', 'data-invitation-paste-go': '', onclick: () => {
      const s = io.st()
      const made = parseInvitationList(box.value, s.people, io.newId)
      if (!made.length) return
      s.invitations = [...(s.invitations ?? []), ...made]
      io.save()
      io.closeSheet()
      io.toast(S.invitedPasteDone(made.length))
      io.render()
    } }, [S.invitedPasteGo]),
  ])
}

/** Person card: the invitations this person made, and "Invite" to add one with them as host. */
export function cardInvitationsRow(io: InvitationIo, p: Person): HTMLElement {
  const s = io.st()
  return el('div', { class: 'card-invitations', 'data-card-invitations': p.id }, [
    el('b', {}, [S.invitedCardTitle]),
    ...invitationsOfHost(s, p.id).map((i) => el('button', { class: 'btn btn-ghost btn-sm', 'data-invitation': i.id, onclick: () => invitationSheet(io, i) }, [[i.event, i.place, i.date].filter(Boolean).join(' · ') || S.invitedTitle])),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-invitation-card-add': p.id, 'aria-label': S.invitedCardAria(p.name), onclick: () => invitationSheet(io, undefined, { host: p.id }) }, [S.invitedCardInvite]),
  ])
}
