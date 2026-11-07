// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 (co-notes-link): the share sheet of a co-note, laid out like a file-sharing sheet: add people, who has access, general access, copy link, done. DOM only. */
import { el } from '../../../../demo/src/ui/dom'
import { chipInput } from '../../chip_input'
import { matchPeople } from '../../events'
import { RINGS, Ring } from '../../model'
import { S } from '../../strings'
import type { CoCtx } from './co_editor'
import { accessRows, offerFor, type CoInvite } from './co_invite'
import type { Linker } from './co_link'

const S_ = S.coLink
const POLL_MS = 8000

export function openShare(c: CoCtx, linker: Linker, id: string): void {
  const note = c.get(id)
  if (!note) return
  c.h.page(S_.shareTitle(note.title), [shareSheet(c, linker, id)], 'co-note-share')
}

function shareSheet(c: CoCtx, linker: Linker, id: string): HTMLElement {
  const root = el('div', { class: 'co-share-sheet', 'data-co-share-sheet': id })
  let ring: Ring = Ring.Intending
  let watch = false
  let message = ''
  const doc = (): NonNullable<ReturnType<CoCtx['get']>> => c.get(id) as NonNullable<ReturnType<CoCtx['get']>>
  const say = (m: string): void => { message = m; draw() }

  const copy = async (inv: CoInvite): Promise<void> => {
    try { await navigator.clipboard.writeText(linker.url(inv)); c.h.toast(S_.linkCopied) } catch { say(linker.url(inv)) }
  }
  const make = async (who: { name: string; did?: string; personId?: string; mode?: 'anyone'; watch?: boolean }): Promise<void> => {
    const r = await linker.create(doc(), { ...who, ring })
    if (!r.ok) { say(S_.noRelay); return }
    message = ''
    draw()
    await copy(r.invite)
  }

  const ringRow = (): HTMLElement => el('div', { class: 'co-ring-row', 'data-co-rings': '' }, [
    el('span', { class: 'meta' }, [`${S_.ringPick}: `]),
    ...RINGS.map((r) => el('button', { class: 'btn btn-ghost btn-sm' + (r === ring ? ' on' : ''), 'aria-pressed': String(r === ring), 'data-co-ring': r, onclick: () => { ring = r; draw() } }, [S.ringLabel[r]])),
  ])

  const addField = (): HTMLElement => {
    const people = c.h.state().people
    const taken = new Set(linker.invites(id).flatMap((i) => (i.personId ? [i.personId] : [])))
    const picker = chipInput({
      placeholder: S_.addPh, aria: S_.addPeople, attrs: { 'data-co-share-input': '' },
      hits: (t) => {
        const found = matchPeople(people.filter((p) => !taken.has(p.id)), t)
        const offer = offerFor(t, found.length)
        return [
          ...found.map((p) => ({ label: p.name, attrs: { 'data-co-share-hit': p.id }, pick: () => { void make({ name: p.name, personId: p.id, ...(c.h.didOf(p.id) ? { did: c.h.didOf(p.id) as string } : {}) }) } })),
          ...(offer ? [{ label: S_.singleUse(offer), attrs: { 'data-co-share-offer': offer }, pick: () => { void make({ name: offer }) } }] : []),
        ]
      },
    })
    return el('div', {}, [el('label', { class: 'eyebrow' }, [S_.addPeople]), picker.input, picker.hits])
  }

  const rows = (): HTMLElement => el('div', { class: 'co-access', 'data-co-access': '' }, [
    el('h4', { class: 'eyebrow' }, [S_.access]),
    ...accessRows(c.h.me().name || '?', linker.invites(id)).map((r) => el('div', { class: 'co-access-row', 'data-co-access-row': r.role }, [
      el('div', { class: 'co-access-who' }, [
        el('b', {}, [r.invite?.mode === 'anyone' ? S_.anyoneName : r.name]),
        el('span', { class: 'meta' }, [r.role === 'owner' ? S_.owner : r.invite?.mode === 'anyone' ? `${S_.guest}, ${S_.state[r.state ?? 'invited']}` : `${S.ringLabel[r.invite?.ring ?? Ring.Intending]} · ${S_.state[r.state ?? 'invited']}`]),
      ]),
      r.invite ? el('button', { class: 'linkbtn', 'data-co-copy-link': r.invite.id, onclick: () => { void copy(r.invite as CoInvite) } }, [S_.copyLink]) : null,
      r.invite ? el('button', { class: 'linkbtn', 'data-co-remove-invite': r.invite.id, onclick: () => { const inv = r.invite as CoInvite; void linker.remove(inv).then((gone) => { c.h.toast(gone ? S_.removedUnopened : S_.removedOpened); draw() }) } }, [S_.remove]) : null,
    ])),
  ])

  const general = (): HTMLElement => el('div', { class: 'co-general' }, [
    el('h4', { class: 'eyebrow' }, [S_.general]),
    el('p', {}, [el('b', { 'data-co-restricted': '' }, [S_.restricted]), el('br'), el('span', { class: 'meta' }, [S_.restrictedHint])]),
    el('details', { class: 'co-advanced', 'data-co-advanced': '' }, [
      el('summary', {}, [S_.advanced]),
      el('p', { class: 'meta' }, [el('b', {}, [S_.anyone]), el('br'), S_.anyoneHint]),
      el('label', { class: 'meta' }, [el('input', { type: 'checkbox', 'data-co-watch': '', checked: watch, onchange: (e: Event) => { watch = (e.target as HTMLInputElement).checked } }), ` ${S_.watch}`]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-co-anon-create': '', onclick: () => { void make({ name: S_.anyoneName, mode: 'anyone', watch }) } }, [S_.anonCreate]),
    ]),
  ])

  function draw(): void {
    const open = root.querySelector<HTMLDetailsElement>('[data-co-advanced]')?.open ?? false
    root.replaceChildren(
      addField(), ringRow(), message ? el('p', { class: 'warn', 'data-co-share-message': '' }, [message]) : '', rows(), general(),
      el('p', { class: 'meta' }, [S_.helpHonest]),
      el('button', { class: 'btn btn-electric wide', 'data-co-share-done': '', onclick: () => history.back() }, [S_.done]),
    )
    if (open) root.querySelector<HTMLDetailsElement>('[data-co-advanced]')?.setAttribute('open', '')
  }

  // Guests who opened a link show up here without leaving the sheet.
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return }
    void linker.refresh().then((changed) => { if (changed && root.isConnected && !root.contains(document.activeElement)) draw() })
  }, POLL_MS)
  draw()
  return root
}
