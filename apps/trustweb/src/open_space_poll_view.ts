// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 open-space-date-poll: the date poll on the event page of an online open space (inside open_space_view.ts): each proposed date with its
 * yes / maybe / no counts and my three chips, the leading date marked, and for a host "Propose a date" (behind an expander, P3) and "Use this date".
 * Only counts show, never names (votes are tokens, open_space_poll.ts).
 */
import { el } from '../../demo/src/ui/dom'
import { isEventHost } from './event_roles'
import { tokenOf } from './open_space'
import { addPollOption, leadingOption, tallyOf, useDate, votePoll } from './open_space_poll'
import type { DatePollOption, PollVote, TwEvent } from './model'
import type { OpenSpaceHooks } from './open_space_view'
import { S } from './strings'

const T = S.w45osp
const draft = { open: false, from: '', to: '', error: '' }
const VOTES: PollVote[] = ['yes', 'maybe', 'no']

export function pollSection(ev: TwEvent, h: OpenSpaceHooks): Node | null {
  const st = h.state()
  const poll = ev.openSpace?.poll
  const host = isEventHost(ev, st.me.displayName, st.people)
  if (!poll && !host) return null
  const me = tokenOf(ev.id, st.me.displayName)
  const lead = leadingOption(poll)
  const change = (fn: () => unknown): void => { fn(); h.save(); h.push(ev); h.redraw() }
  const label = (o: DatePollOption): string => `${o.from.replace('T', ' ')}${o.to ? `–${o.to.slice(11)}` : ''}`

  const row = (o: DatePollOption): HTMLElement => {
    const t = tallyOf(o)
    return el('div', { class: 'os-poll-opt', 'data-poll-opt': o.id }, [
      el('div', { class: 'os-head' }, [
        el('b', { class: 'os-title', 'data-poll-date': '' }, [label(o)]),
        poll?.chosen === o.id ? el('span', { class: 'meta', 'data-poll-chosen': '' }, [T.chosen]) : lead?.id === o.id && !poll?.chosen ? el('span', { class: 'meta', 'data-poll-leading': '' }, [T.leading]) : null,
      ]),
      el('p', { class: 'meta', 'data-poll-tally': '' }, [T.tally(t.yes, t.maybe, t.no)]),
      el('div', { class: 'os-head' }, [
        ...VOTES.map((v) => {
          const on = o.votes[me]?.v === v
          return el('button', { class: 'chip' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), 'data-poll-vote': `${o.id}:${v}`, onclick: () => change(() => votePoll(ev, o.id, me, v, Date.now())) }, [T[v]])
        }),
        host && !poll?.chosen ? el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-poll-use': o.id, onclick: () => change(() => useDate(ev, o.id)) }, [T.use]) : null,
      ]),
    ])
  }

  const from = el('input', { class: 'field', type: 'datetime-local', value: draft.from, 'aria-label': T.from, 'data-poll-from': '' }) as HTMLInputElement
  from.addEventListener('input', () => { draft.from = from.value })
  const to = el('input', { class: 'field opt-min', type: 'time', value: draft.to, 'aria-label': T.to, title: T.to, 'data-poll-to': '' }) as HTMLInputElement
  to.addEventListener('input', () => { draft.to = to.value })
  const add = (): void => {
    try {
      addPollOption(ev, { from: draft.from, ...(draft.to ? { to: `${draft.from.slice(0, 10)}T${draft.to}` } : {}) }, h.newId())
      draft.from = ''; draft.to = ''; draft.error = ''
      change(() => undefined)
    } catch (e) { draft.error = (e as Error).message; h.redraw() }
  }
  const form = host && !poll?.chosen ? [
    el('button', { class: 'btn btn-ghost wide', type: 'button', 'aria-expanded': String(draft.open), 'data-poll-add': '', onclick: () => { draft.open = !draft.open; h.redraw() } }, [T.add + (draft.open ? ' ▴' : ' ▾')]),
    draft.open ? el('div', { class: 'os-form', 'data-poll-form': '' }, [
      from, to,
      draft.error ? el('p', { class: 'warn', 'data-poll-error': '' }, [draft.error]) : null,
      el('button', { class: 'btn btn-electric wide', type: 'button', 'data-poll-go': '', onclick: add }, [T.addGo]),
    ]) : null,
  ] : []

  return el('section', { class: 'os-poll', 'data-os-poll': ev.id }, [
    el('h3', {}, [T.title]),
    poll?.options.length ? null : el('p', { class: 'meta' }, [T.hint]),
    ...(poll?.options ?? []).map(row),
    ...form,
  ])
}
