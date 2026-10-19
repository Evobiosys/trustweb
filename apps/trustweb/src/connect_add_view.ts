/**
 * The sheet that opens after a scan or a pasted connect link (wave 6b, owner 2026-10-08: "let them scan the code, trustintheweb.org
 * opens for them with the person who shared their qr code in the web selected"): the person is connected already (the handshake
 * ran when the link opened), the sheet asks only how close they are and lets the name be corrected.
 *
 * The name may not be known yet (a link without one, the server still answering): the field is then empty with a "Waiting for
 * their name..." placeholder, editable at once. setTheirName() fills it when the name arrives, unless the person typed there first.
 * "Add to my web" is never blocked by a missing name.
 */
import { el } from '../../demo/src/ui/dom'
import { RINGS, Ring } from './model'
import { S } from './strings'
import { cleanHelloName } from './hello'

export interface ConnectAddOptions {
  /** The name the link or the handshake gave; '' when none is known yet. */
  name: string
  ring: Ring
  /** The line under the title; default S.connectAddLead ("You are connected."). */
  lead?: string
  /** The person pressed "Add to my web": the typed (or given) name, possibly '', and the ring. */
  onAdd: (name: string, ring: Ring) => void
  /** "Not now": the person stays as connected, in the ring they were put in. */
  onLater: () => void
}

export interface ConnectAddHandle {
  nodes: Node[]
  /** The name arrived over the handshake. Replaces the field only while the person has not typed there. */
  setTheirName(name: string): void
  /** The text now in the name field. */
  typed(): string
}

/** The primary button follows the picked ring (Jakob 2026-10-19): an intending person is not yet in the web. */
export function addLabel(ring: Ring): string {
  return ring === Ring.Intending ? S.connectAddAsIntended : S.addSave
}

export function renderConnectAdd(o: ConnectAddOptions): ConnectAddHandle {
  let picked = o.ring
  let given = cleanHelloName(o.name)
  let dirty = false
  const add = el('button', { class: 'btn btn-electric', 'data-connect-add': '', onclick: () => o.onAdd(name.value.trim().slice(0, 40), picked) }, [addLabel(picked)])
  const title = el('h3', { 'data-connect-add-title': '' }, [S.connectAddTitle(given)])
  const hint = el('p', { class: 'meta', 'data-connect-add-waiting': '', hidden: given !== '' }, [S.connectAddWaitingHint])
  const name = el('input', {
    class: 'field', maxlength: '40', 'aria-label': S.connectAddNamePh, 'data-connect-add-name': '',
    placeholder: given ? S.connectAddNamePh : S.connectAddWaiting, value: given,
  })
  name.addEventListener('input', () => { dirty = true })
  const radios = el('div', { class: 'add-rings' })
  const drawRadios = (): void => {
    radios.replaceChildren(...RINGS.map((r) => el('button', {
      class: 'radio' + (picked === r ? ' on' : ''), 'data-ring': r,
      onclick: () => { picked = r; drawRadios(); add.textContent = addLabel(r) },
    }, [el('b', {}, [S.ringLabel[r]]), el('small', {}, [S.ringHint[r]])])))
  }
  drawRadios()
  const nodes: Node[] = [
    title,
    el('p', { class: 'meta' }, [o.lead ?? S.connectAddLead]),
    name,
    hint,
    radios,
    add,
    el('button', { class: 'btn btn-ghost', 'data-connect-later': '', onclick: o.onLater }, [S.addCancel]),
  ]
  return {
    nodes,
    typed: () => name.value,
    setTheirName(next: string): void {
      const clean = cleanHelloName(next)
      if (!clean || clean === given) return
      given = clean
      title.textContent = S.connectAddTitle(given)
      hint.hidden = true
      name.setAttribute('placeholder', S.connectAddNamePh)
      if (!dirty) name.value = given
    },
  }
}
