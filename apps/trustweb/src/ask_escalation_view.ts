// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-escalation: the DOM of the second round, the "x people asked" line and the switch under Advanced. Logic lives in ask_escalation.ts. */
import { el } from '../../demo/src/ui/dom'
import { ZONES } from './audience_zones'
import type { Zone } from './audience_zones'
import { ringOfZone, zoneState } from './audience_filter'
import { S } from './strings'
import type { AskResult } from './net'

export interface EscalateDeps {
  zone: Zone
  setZone: (z: Zone) => void
  /** A second round is out: the button waits, the tips show when they came. */
  busy: boolean
  send: () => void
  tips: AskResult[] | null
}

/** The tips that came back (private to the asker, never stored). */
export function knowTips(tips: AskResult[]): HTMLElement {
  const shared = tips.filter((r) => r.decoded?.outcome === 'shared' && r.decoded.shared)
  return el('div', { 'data-know-tips': '' }, [
    el('b', {}, [S.askKnow.tipsTitle]),
    ...(shared.length
      ? shared.flatMap((r) => (r.decoded?.shared?.items ?? []).map((it) => el('div', { class: 'shared-item', 'data-know-tip': r.peerId }, [el('small', {}, [S.askKnow.tipFrom(r.peerName)]), el('span', {}, [it.text])])))
      : [el('p', { class: 'meta', 'data-know-none': '' }, [S.askKnow.nothing])]),
  ])
}

/** "Not enough yet?": the zones to ask further, the button, and the tips that came back (private to the asker, never stored). */
export function escalateBlock(d: EscalateDeps): HTMLElement {
  return el('div', { class: 'esc-box', 'data-escalate': '' }, [
    el('b', {}, [S.askKnow.title]),
    el('p', { class: 'hint' }, [S.askKnow.hint]),
    el('div', { class: 'seg', role: 'group', 'aria-label': S.askKnow.zonesAria }, ZONES.map((z) => el('button', {
      class: { on: 'on', in: 'in', off: 'tw-off' }[zoneState(z, d.zone)], type: 'button', 'data-escalate-zone': z, 'aria-pressed': String(z === d.zone), disabled: d.busy,
      onclick: () => d.setZone(z),
    }, [S.ringLabel[ringOfZone(z)]]))),
    el('button', { class: 'btn btn-electric', type: 'button', 'data-escalate-send': '', disabled: d.busy, onclick: d.send }, [d.busy ? S.askKnow.sending : S.askKnow.send]),
    d.tips ? knowTips(d.tips) : null,
  ])
}

/** "x people asked" on an incoming ask: a tap shows the names (only given to Closest few and Close, and only when the asker left it on). */
export function askedWhoLine(names: readonly string[]): HTMLElement {
  const list = el('ul', { class: 'asked-who-list', hidden: true, 'data-asked-who-list': '' }, names.map((n) => el('li', {}, [n])))
  const btn = el('button', { class: 'asked-who', type: 'button', 'data-asked-who': '', 'aria-expanded': 'false', 'aria-label': S.askedWho.aria, onclick: () => {
    list.hidden = !list.hidden
    btn.setAttribute('aria-expanded', String(!list.hidden))
  } }, [S.askedWho.line(names.length)])
  return el('div', { class: 'ask-foot' }, [btn, list])
}

/** The switch under Advanced: this ask tells Closest few and Close who else was asked (on by default). */
export function showAskedRow(on: boolean, toggle: () => void): HTMLElement {
  return el('div', { class: 'afv-row', 'data-ask-show-asked': '' }, [
    el('button', { class: 'passon-row' + (on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(on), onclick: toggle }, [
      el('span', { class: 'passon-text' }, [el('b', {}, [S.askedWho.show])]),
      el('span', { class: 'passon-ctl' }, [el('span', { class: 'passon-state' }, [on ? S.passOnStateOn : S.passOnStateOff]), el('span', { class: 'ios-switch', 'aria-hidden': 'true' }, [el('span', { class: 'ios-knob' })])]),
    ]),
    el('p', { class: 'hint' }, [S.askedWho.showHint]),
  ])
}

/** The body of an incoming second-round ask: a tip box instead of matches. */
export function knowCard(onSend: (note: string) => void, onNo: () => void): HTMLElement[] {
  const note = el('textarea', { class: 'field know-note', rows: '2', maxlength: '200', placeholder: S.askKnow.notePh, 'aria-label': S.askKnow.noteAria, 'data-know-note': '' })
  const give = el('button', { class: 'btn btn-mint', type: 'button', 'data-know-send': '', disabled: true, onclick: () => onSend(note.value) }, [S.askKnow.give])
  note.addEventListener('input', () => { give.disabled = !note.value.trim() })
  return [el('p', { class: 'ask-lbl' }, [S.askKnow.ask]), note, give, el('button', { class: 'btn btn-ghost', type: 'button', 'data-know-no': '', onclick: onNo }, [S.askKnow.none])]
}
