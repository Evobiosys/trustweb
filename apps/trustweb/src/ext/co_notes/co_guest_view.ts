// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 (co-notes-link): what a guest sees: the connect gate, the "link used" message, and the note with its group chat as the Chat screen of the nested shell. DOM only. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import { coEditor, type CoCtx } from './co_editor'
import type { InviteLink } from './co_invite'
import type { Linker } from './co_link'

const S_ = S.coLink
let arrived = false

/** The sheet with one plain message and, when the failure may pass, a button to try again. */
function message(c: CoCtx, mark: string, text: string, retry?: () => void): void {
  c.h.sheet([
    el('p', { 'data-co-guest-message': mark }, [text]),
    retry ? el('button', { class: 'btn btn-electric wide', 'data-co-retry': '', onclick: () => { c.h.closeSheet(); retry() } }, [S_.retry]) : null,
  ])
}

async function open(c: CoCtx, linker: Linker, link: InviteLink): Promise<void> {
  const r = await linker.redeem(link)
  if (r.ok) return
  if (r.why === 'refused') message(c, 'refused', S_.refused)
  else message(c, 'offline', S_.offline, () => { void open(c, linker, link) })
}

/** Not connected with the sender yet: connect first (Accept), or leave with nothing stored (Decline). */
function gate(c: CoCtx, linker: Linker, link: InviteLink): void {
  const accept = el('button', {
    class: 'btn btn-electric wide', 'data-co-accept': '',
    onclick: async () => {
      accept.setAttribute('disabled', '')
      const person = await c.h.connectTo(link.owner)
      if (!person) { accept.removeAttribute('disabled'); c.h.toast(S_.offline); return }
      c.h.closeSheet()
      await open(c, linker, link)
    },
  }, [S_.accept])
  c.h.sheet([
    el('h3', { 'data-co-connect-gate': '' }, [S_.gateTitle(link.owner.name)]),
    el('p', {}, [S_.gateBody(link.owner.name)]),
    accept,
    el('button', { class: 'btn btn-ghost wide', 'data-co-decline': '', onclick: () => { c.h.closeSheet(); c.h.toast(S_.declined) } }, [S_.decline]),
  ])
}

/** Once, when the app is up: the address carried an invitation. */
export async function arrive(c: CoCtx, linker: Linker): Promise<void> {
  const link = linker.pending()
  if (!link || arrived) return
  arrived = true
  const s = c.h.state()
  if (s.coInvites?.some((i) => i.id === link.id)) return // my own link
  if (s.coGuest?.inviteId === link.id) { c.h.guestChanged(true); return }
  const connected = link.anonymous || s.people.some((p) => c.h.didOf(p.id) === link.owner.did)
  if (connected) await open(c, linker, link)
  else gate(c, linker, link)
}

/** The Chat screen of a guest: the note (editor and group chat) and a way out into the full app. */
export function guestBody(c: CoCtx): Node[] {
  const g = c.h.state().coGuest
  const doc = g ? c.get(g.noteId) : undefined
  if (!g || !doc) return [el('p', { class: 'meta pad' }, [S_.guestNote])]
  const exit = (): void => { delete c.h.state().coGuest; c.h.save(); c.h.guestChanged(false) }
  return [el('div', { class: 'scroll pad', 'data-guest-note': g.noteId }, [
    el('p', { class: 'meta', 'data-guest-from': '' }, [S_.fromOwner(g.owner.name)]),
    g.anonymous ? el('p', { class: 'meta', 'data-co-anon-note': '' }, [S_.anonNote]) : null,
    coEditor(c, doc.id),
    el('button', { class: 'linkbtn', 'data-guest-exit': '', onclick: exit }, [S_.exit]),
  ])]
}

/** On the start screen of a new visitor who came by a note link. */
export const startLine = (linker: Linker): Node | null => {
  const link = linker.pending()
  return link ? el('p', { class: 'invite meta', 'data-co-start-invite': '' }, [S_.startInvite(link.owner.name)]) : null
}
