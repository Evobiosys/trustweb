// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 (intro_ask.ts): the "Ask for intros" body of the ask dock. DOM and words only; main.ts passes the app in. */
import { el } from '../../demo/src/ui/dom'
import type { AskResult } from './net'
import type { AppState } from './model'
import { effectiveMaxHops } from './hops'
import { introCandidates, introMaxHop } from './intro_ask'
import type { IntroCandidate } from './intro_ask'
import { S } from './strings'

export interface IntroIo {
  st: () => AppState
  /** Sends the intro ask to one person (their id in the web); resolves null when they are not a connected peer. */
  ask: (peerId: string, target: string) => Promise<AskResult | null>
  /** The "How far?" chips, built by the dock. */
  reach: HTMLElement
  /** The reach (steps) the chips hold. */
  steps: () => number
  onResult: (target: string, result: AskResult) => void
}

let target = ''
const state = new Map<string, string>()

function row(io: IntroIo, c: IntroCandidate<AppState['people'][number]>, redraw: () => void): HTMLElement {
  const p = c.person
  const note = state.get(p.id)
  return el('div', { class: 'prow', 'data-intro-candidate': p.id, 'data-intro-hop': String(c.hop) }, [
    el('div', { class: 'who' }, [
      el('b', {}, [p.name]),
      el('small', {}, [`${S.introHop(c.hop)} · ${c.reasons.map((r) => S.introWhy[r]).join(', ')}`]),
    ]),
    note
      ? el('small', { 'data-intro-state': p.id }, [note])
      : el('button', {
        class: 'btn btn-ghost btn-sm', 'data-intro-ask': p.id,
        onclick: () => {
          state.set(p.id, S.introSent(p.name)); redraw()
          void io.ask(p.peerId ?? '', target).then((r) => {
            const items = r?.decoded?.outcome === 'shared' ? r.decoded.shared?.items.map((i) => i.text).join('; ') : ''
            if (r && items) { state.set(p.id, `${S.introAnswered(p.name)} ${items}`); io.onResult(target, r) }
            redraw()
          })
        },
      }, [S.introAskBtn(p.name)]),
  ])
}

export function introForm(io: IntroIo): HTMLElement {
  const list = el('div', { class: 'ppl', 'data-intro-list': '' })
  const redraw = (): void => {
    const rows = introCandidates(io.st().people, target, introMaxHop(effectiveMaxHops(io.steps())))
    list.replaceChildren(...(target.trim() && !rows.length ? [el('p', { class: 'hint', 'data-intro-none': '' }, [S.introNone])] : rows.map((c) => row(io, c, redraw))))
  }
  const box = el('input', { class: 'field', type: 'text', maxlength: '80', list: 'tw-intro-names', placeholder: S.introTargetPh, 'aria-label': S.introTargetLbl, 'data-intro-target': '', value: target })
  box.addEventListener('input', () => { target = box.value; redraw() })
  redraw()
  return el('div', { 'data-intro-form': '' }, [
    el('details', { class: 'ask-how', 'data-intro-how': '' }, [el('summary', {}, [S.introHow]), el('p', { class: 'hint' }, [S.introHowBody])]),
    io.reach,
    el('label', { class: 'chips-lbl' }, [S.introTargetLbl]),
    box,
    el('datalist', { id: 'tw-intro-names' }, io.st().people.filter((p) => p.ring !== 'none').map((p) => el('option', { value: p.name }))),
    list,
  ])
}
