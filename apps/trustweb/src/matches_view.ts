// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31: Resources > eye > Matches. Cards per offer, strongest first; the empty state explains the pc24 service and keeps the offers editable. */
import { el } from '../../demo/src/ui/dom'
import { dismissMatch, groupMatches, matchKey } from './matches'
import type { MatchStatus } from './dev_matches'
import type { AppState, Match } from './model'
import { S } from './strings'

export interface MatchesDeps {
  status: MatchStatus | null
  nameOf: (personId: string) => string | null
  openPerson: (personId: string) => void
  newId: () => string
  save: () => void
  render: () => void
}

function liveLine(s: AppState, status: MatchStatus | null): Node {
  const n = s.matches?.length ?? 0
  const running = status && status.phase !== 'done'
  const text = !status ? '' : running ? S.matches.live(status.done ?? 0, status.total ?? 0, n) : S.matches.liveDone(n)
  return el('p', { class: 'hint', 'data-matches-status': '', style: running ? '' : 'opacity:.6' }, [text])
}

function row(s: AppState, m: Match, d: MatchesDeps): HTMLElement {
  const name = m.personId ? d.nameOf(m.personId) ?? m.personId : m.communityId ?? ''
  const pct = Math.round(m.confidence * 100)
  return el('div', { class: 'inv', 'data-match-row': matchKey(m) }, [
    el('div', { class: 'inv-main' }, [
      m.personId ? el('button', { class: 'inv-text', 'data-match-open': m.personId, style: 'text-decoration:underline', onclick: () => d.openPerson(m.personId!) }, [name]) : el('b', {}, [`${S.matches.community}: ${name}`]),
      el('p', {}, [m.need]),
      el('div', { class: 'inv-actions' }, [
        m.pays ? el('span', { class: 'tagpill' }, [S.matches.pays[m.pays] ?? m.pays]) : null,
        el('span', { class: 'tagpill', 'data-match-confidence': String(pct) }, [S.matches.confidence(pct)]),
      ]),
      m.next ? el('p', { class: 'hint' }, [S.matches.next + m.next]) : null,
      el('div', { class: 'inv-actions' }, [
        m.personId ? el('button', { class: 'btn btn-electric btn-sm', style: 'text-decoration:underline', 'data-match-reach': '', onclick: () => d.openPerson(m.personId!) }, [S.matches.reachOut]) : null,
        el('button', { class: 'btn btn-ghost btn-sm', style: 'text-decoration:underline', 'data-match-dismiss': '', onclick: () => { (s.matchFeedback ??= []).push(dismissMatch(m, Date.now())); d.save(); d.render() } }, [S.matches.notRelevant]),
      ]),
    ]),
  ])
}

function offersSection(s: AppState, d: MatchesDeps): Node {
  const offers = (s.offers ??= [])
  const input = el('input', { class: 'field', placeholder: S.matches.offerAddPh, maxlength: '120', 'aria-label': S.matches.offerAddPh })
  const add = (): void => {
    const v = input.value.trim()
    if (!v) { input.focus(); return }
    offers.push({ id: d.newId(), title: v })
    d.save(); d.render()
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') add() })
  return el('div', { 'data-matches-offers': '' }, [
    el('h4', { class: 'eyebrow' }, [S.matches.offersTitle]),
    el('p', { class: 'hint' }, [S.matches.offersHint]),
    el('div', { class: 'add-row' }, [input, el('button', { class: 'btn btn-electric btn-sm', style: 'text-decoration:underline', onclick: add }, [S.matches.offerAdd])]),
    ...offers.map((o) => el('div', { class: 'inv' }, [
      el('div', { class: 'inv-main' }, [el('input', { class: 'field', value: o.title, maxlength: '120', 'aria-label': S.matches.offerAria, 'data-offer': o.id, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) { o.title = v; d.save() } else d.render() } })]),
      el('div', { class: 'inv-side' }, [el('button', { class: 'x', 'aria-label': S.remove, onclick: () => { s.offers = offers.filter((x) => x !== o); d.save(); d.render() } }, ['×'])]),
    ])),
  ])
}

export function matchesView(s: AppState, d: MatchesDeps): Node[] {
  const groups = groupMatches(s.matches ?? [], s.offers ?? [])
  return [
    liveLine(s, d.status),
    ...(groups.length
      ? groups.map((g) => el('section', { 'data-matches-offer': g.offerId }, [el('h4', { class: 'eyebrow' }, [g.title]), ...g.items.map((m) => row(s, m, d))]))
      : [el('p', { class: 'empty', 'data-matches-empty': '' }, [S.matches.empty])]),
    offersSection(s, d),
  ]
}
