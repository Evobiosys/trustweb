// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33 (intro_ask.ts): the "Ask for intros" body of the ask dock. DOM and words only; main.ts passes the app in. */
import { el } from '../../demo/src/ui/dom'
import type { AskResult } from './net'
import type { AppState } from './model'
import { effectiveMaxHops } from './hops'
import { introCandidates, introMaxHop } from './intro_ask'
import { INTRO_WHY_MAX } from './intro_link'
import type { IntroCandidate } from './intro_ask'
import { S } from './strings'
import { parseIntroTarget, skillMatches } from './support_inbox'

export interface IntroIo {
  st: () => AppState
  /** Sends the intro ask to one person (their id in the web); resolves null when they are not a connected peer. */
  ask: (peerId: string, target: string) => Promise<AskResult | null>
  /** The "How far?" chips, built by the dock. */
  reach: HTMLElement
  /** The reach (steps) the chips hold. */
  steps: () => number
  onResult: (target: string, result: AskResult) => void
  /** The dedicated intro link for this target and reason (intro_link.ts), with the asker's own name and connect link. */
  link: (target: string, why: string) => Promise<string>
  copy: (text: string) => void
  /** Wave 42: ask the connected people whose skills match a free-text category (the default target) at once. */
  skill?: (category: string, people: AppState['people']) => void
}

let target = ''
/** Wave 42: "at Anna" targets the person Anna; anything else is a category (plumber). The target the ask carries has no "at". */
const eff = (): string => { const t = parseIntroTarget(target); return t?.kind === 'person' ? t.name : target.trim() }
let why = ''
const state = new Map<string, string>()
/** Wave 36: groups_view.ts opens the intro ask with this target already typed. */
export function setIntroTarget(t: string): void { target = t.slice(0, 80) }
/** Targets an intro ask went out for in this visit. */
const asked = new Set<string>()

/** The intro link for the typed target: reason box, the link itself, Copy and (where the phone has one) Share. Shown once an intro ask went out. */
function linkBox(io: IntroIo): HTMLElement {
  const out = el('input', { class: 'field', type: 'text', readonly: '', 'aria-label': S.introLinkLbl, 'data-intro-link': '' }) as HTMLInputElement
  const fill = (): void => { void io.link(eff(), why).then((url) => { out.value = url }) }
  const reason = el('input', { class: 'field', type: 'text', maxlength: String(INTRO_WHY_MAX), placeholder: S.introWhyPh, 'data-intro-why': '', value: why })
  reason.addEventListener('input', () => { why = reason.value; fill() })
  fill()
  return el('div', { 'data-intro-link-box': '' }, [
    el('label', { class: 'chips-lbl' }, [S.introLinkLbl]),
    reason,
    out,
    el('button', { class: 'btn btn-ghost btn-sm', 'data-intro-link-copy': '', onclick: () => io.copy(out.value) }, [S.introLinkCopy]),
    typeof navigator.share === 'function'
      ? el('button', { class: 'btn btn-ghost btn-sm', 'data-intro-link-share': '', onclick: () => { void navigator.share({ text: out.value }).catch(() => undefined) } }, [S.introLinkShare])
      : null,
    el('small', { class: 'hint' }, [S.introLinkNote]),
  ])
}

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
          state.set(p.id, S.introSent(p.name)); asked.add(eff()); redraw()
          void io.ask(p.peerId ?? '', eff()).then((r) => {
            const items = r?.decoded?.outcome === 'shared' ? r.decoded.shared?.items.map((i) => i.text).join('; ') : ''
            if (r && items) { state.set(p.id, `${S.introAnswered(p.name)} ${items}`); io.onResult(eff(), r) }
            redraw()
          })
        },
      }, [S.introAskBtn(p.name)]),
  ])
}

export function introForm(io: IntroIo): HTMLElement {
  const list = el('div', { class: 'ppl', 'data-intro-list': '' })
  const redraw = (): void => {
    const rows = introCandidates(io.st().people, eff(), introMaxHop(effectiveMaxHops(io.steps())))
    list.replaceChildren(...(eff() && !rows.length ? [el('p', { class: 'hint', 'data-intro-none': '' }, [S.introNone])] : rows.map((c) => row(io, c, redraw))))
    // Wave 42: a category (the default) also reaches the people who have that skill.
    const t = parseIntroTarget(target)
    const skilled = t?.kind === 'category' && io.skill ? skillMatches(io.st().people, t.category) : []
    if (skilled.length && t?.kind === 'category') list.prepend(el('div', { class: 'conn-row', 'data-intro-skill': String(skilled.length) }, [
      el('b', {}, [S.w42.skillFound(skilled.length)]),
      el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-intro-skill-ask': '', onclick: () => { io.skill?.(t.category, skilled); redraw() } }, [S.w42.skillAsk]),
    ]))
    // Linked to the target typed when the box was drawn: a changed target redraws the list, the box follows once an ask went out for it.
    if (eff() && asked.has(eff())) list.append(linkBox(io))
  }
  const box = el('input', { class: 'field', type: 'text', maxlength: '80', list: 'tw-intro-names', placeholder: S.w42.introPh, 'aria-label': S.introTargetLbl, 'data-intro-target': '', value: target })
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
