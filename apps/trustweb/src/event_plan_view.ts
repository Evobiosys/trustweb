// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-event: the sections of an event page made in a community: about, sign-up sheet, roles, resource asks ("I bring it") and
 * the celebration, which shows only to people on the invitee list (event_plan.ts celebrationVisible). Shown through events_view `extra`.
 */
import { el } from '../../demo/src/ui/dom'
import { askResource, celebrationVisible, coverResource, leaveSignup, queueResourceAsk, resourceSummary, signUp, takeRole } from './event_plan'
import type { AppState, TwEvent } from './model'
import { S } from './strings'

export interface EventPlanHooks {
  state: () => AppState
  save: () => void
  redraw: () => void
  newId: () => string
  /** My identity for the celebration gate; undefined = none. */
  meDid: () => string | undefined
  /** Sends the support asks just queued (support_flush.ts). */
  flush: () => void
}

const T = S.w42ev

export function eventPlanSection(ev: TwEvent, h: EventPlanHooks): Node[] {
  const celebration = celebrationVisible(ev, h.meDid())
  if (!ev.signup && !celebration) return []   // an event not made as a community event: nothing here, no hint of a celebration
  const people = h.state().people
  const who = (id: string): string => (id === 'me' ? T.me : people.find((p) => p.id === id)?.name ?? id)
  const change = (fn: () => unknown): void => { fn(); h.save(); h.redraw() }
  const btn = (label: string, attr: string, onclick: () => void, cls = 'btn btn-ghost btn-sm'): HTMLElement => el('button', { class: cls, type: 'button', [attr]: '', onclick }, [label])

  const joined = ev.signup?.includes('me') ?? false
  const sign = ev.signup ? el('section', { 'data-event-signup': '' }, [
    el('h3', {}, [T.signupTitle, el('sub', { class: 'alpha', 'data-alpha-label': '' }, [S.alphaLabel])]),
    el('p', { class: 'meta', 'data-event-signup-count': '' }, [T.signupCount(ev.signup.length)]),
    ev.signup.length ? el('p', {}, [ev.signup.map(who).join(', ')]) : null,
    joined ? btn(T.signupLeave, 'data-event-leave', () => change(() => leaveSignup(ev, 'me'))) : btn(T.signupJoin, 'data-event-join', () => change(() => signUp(ev, 'me')), 'btn btn-sm'),
  ]) : null

  const roles = ev.roles?.length ? el('section', { 'data-event-roles': '' }, [
    el('h3', {}, [T.rolesTitle]),
    ...ev.roles.map((r) => el('div', { class: 'row', 'data-event-role': r.name }, [
      el('b', {}, [r.name]), ' ', r.who ? who(r.who) : btn(T.roleTake, 'data-event-role-take', () => change(() => takeRole(ev, r.name, 'me'))),
    ])),
  ]) : null

  const input = el('input', { type: 'text', placeholder: T.resourcePlaceholder, 'aria-label': T.resourcesTitle, 'data-event-resource-input': '', maxlength: '120' }) as HTMLInputElement
  const note = el('p', { class: 'meta', 'data-event-resource-note': '' }, [])
  const ask = (): void => {
    const text = input.value.trim()
    if (!text) return
    try {
      const s = h.state()
      const r = askResource(ev, text, h.newId())
      const q = ev.community ? (() => { try { return queueResourceAsk(s, ev, r, Date.now(), h.newId()) } catch { return undefined } })() : undefined
      h.save()
      if (q) h.flush()
      h.redraw()
      note.textContent = q ? T.resourceAsked(q.to.length) : T.resourceNoAudience
    } catch (e) { note.textContent = (e as Error).message }
  }
  const sum = resourceSummary(ev)
  const resources = ev.signup ? el('section', { 'data-event-resources': '' }, [
    el('h3', {}, [T.resourcesTitle]),
    ev.resources?.length ? el('p', { class: 'meta', 'data-event-resource-summary': '' }, [T.resourceSummary(sum.open, sum.covered)]) : null,
    ...(ev.resources ?? []).map((r) => el('div', { class: 'row', 'data-event-resource': r.id }, [
      el('b', {}, [r.text]), ' ', r.by ? T.resourceCovered(who(r.by)) : btn(T.resourceBring, 'data-event-resource-bring', () => change(() => coverResource(ev, r.id, 'me'))),
    ])),
    el('div', { class: 'row' }, [input, btn(T.resourceAsk, 'data-event-resource-ask', ask)]),
    note,
  ]) : null

  return [
    ev.docs?.description ? el('section', {}, [el('h3', {}, [T.descriptionTitle]), el('p', {}, [ev.docs.description])]) : null,
    sign, roles, resources,
    ev.docs?.followup ? el('section', {}, [el('h3', {}, [T.followupTitle]), el('p', {}, [ev.docs.followup])]) : null,
    celebration ? el('section', { 'data-event-celebration': '' }, [el('h3', {}, [T.celebration]), el('p', {}, [T.celebrationText])]) : null,
  ].filter((n): n is HTMLElement => !!n)
}

