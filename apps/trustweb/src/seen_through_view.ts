// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c seen-through: the DOM of the three sources (seen_through.ts): the card of a bubble outside the rings ("via Lena", Ask Lena to
 * introduce), the host's "Introduce to the people here" section on the event page, the yes / no card of a show ask, and the optional
 * "who has it" box on the tip card. Words in S.seenThrough; the host app gives state and I/O.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState, Person, TwEvent } from './model'
import { attendees } from './events'
import { isEventHost } from './event_roles'
import { introAskText } from './intro_ask'
import { S } from './strings'

const T = S.seenThrough

export interface SeenIo {
  st(): AppState
  toast(msg: string): void
  openSheet(children: (Node | null)[]): void
  closeSheet(): void
  /** net.ts askIntro: one intro ask to that connected person. */
  askIntro(peerId: string, target: string): Promise<unknown>
  /** net.ts askShow: does that connected person agree to be shown to `seer`? */
  askShow(peerId: string, seer: string, text: string): Promise<boolean>
  /** event_envelope.ts introduce: the introduction to the people at the event. */
  introduce(eventId: string, who: string, shown: boolean, skip?: string): Promise<void>
}

/** What "Ask <friend> to introduce" asks for: the name, or (nameless) the ask or the event it came from. */
export function seenIntroTarget(p: Pick<Person, 'name' | 'anonymous' | 'seen'>, eventName: string): string {
  if (!p.anonymous && p.name) return p.name
  if (p.seen?.event) return T.anonEvent(eventName)
  return p.seen?.resource ? T.anonAsk(p.seen.resource) : T.anonPlain
}

export function createSeenThrough(io: SeenIo) {
  /** The card of a bubble outside the rings. */
  function open(id: string): void {
    const s = io.st()
    const p = s.people.find((x) => x.id === id)
    const friend = p ? s.people.find((x) => x.id === p.via) : undefined
    if (!p || !friend) return
    const ev = p.seen?.event ? s.events?.find((e) => e.id === p.seen?.event) : undefined
    const target = seenIntroTarget(p, ev?.name ?? '')
    const ask = el('button', { class: 'btn btn-mint', type: 'button', 'data-seen-ask': '', disabled: !friend.peerId, onclick: () => {
      if (!friend.peerId) return
      io.closeSheet()
      io.toast(T.asked(friend.name))
      void io.askIntro(friend.peerId, target)
    } }, [T.askIntro(friend.name)])
    io.openSheet([el('div', { class: 'seen-card', 'data-seen-card': id }, [
      el('span', { class: 'eyebrow', 'data-seen-via': '' }, [T.via(friend.name)]),
      el('h2', { 'data-seen-name': '' }, [p.anonymous || !p.name ? T.someone : p.name]),
      p.seen?.resource ? el('span', { class: 'chip', 'data-seen-resource': '' }, [p.seen.resource]) : null,
      ev ? el('p', { class: 'meta' }, [T.atEvent(ev.name)]) : null,
      el('p', { class: 'meta seen-prefill', 'data-seen-prefill': '' }, [introAskText(target)]),
      ask,
      friend.peerId ? null : el('small', { class: 'hint' }, [T.notConnected(friend.name)]),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: io.closeSheet }, [T.close]),
    ])])
  }

  /** review-44c: one introduction (the button below, and the action seen-introduce / MCP event_introduce_person): only a host, only someone at the event. */
  async function introducePerson(eventId: string, personId: string): Promise<void> {
    const s = io.st()
    const ev = (s.events ?? []).find((e) => e.id === eventId)
    const p = s.people.find((x) => x.id === personId && x.deleted_at === undefined && !x.via)
    if (!ev || !p || !isEventHost(ev, s.me.displayName, s.people) || !attendees(s, ev.id).some((x) => x.id === p.id)) return
    const shown = p.peerId ? await io.askShow(p.peerId, ev.name, T.showEventText(ev.name)) : false
    await io.introduce(ev.id, p.name, shown, p.peerId)
    io.toast(shown ? T.introducedNamed(p.name) : T.introducedNameless(p.name))
  }

  /** The host's section on the event page: pick a person here and introduce them; the name goes only with their own yes. */
  function eventSection(ev: TwEvent): Node[] {
    const s = io.st()
    if (!isEventHost(ev, s.me.displayName, s.people)) return []
    const people = attendees(s, ev.id).filter((p) => !p.via)
    if (!people.length) return []
    const pick = el('select', { class: 'field', 'aria-label': T.pickAria, 'data-seen-pick': '' }, people.map((p) => el('option', { value: p.id }, [p.name]))) as HTMLSelectElement
    const go = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-seen-introduce': '', onclick: async () => {
      go.disabled = true
      await introducePerson(ev.id, pick.value)
      go.disabled = false
    } }, [T.introduce]) as HTMLButtonElement
    return [el('div', { class: 'seen-intro', 'data-seen-intro': ev.id }, [el('h3', {}, [T.introduceTitle]), el('small', { class: 'hint' }, [T.introduceHint]), pick, go])]
  }

  return { open, eventSection, introducePerson }
}

/** The yes / no card of a show ask (a friend asks whether the person further out may see me). */
export function showAskCard(a: { show: string; fromName: string }, yes: () => void, no: () => void): HTMLElement {
  return el('div', { 'data-show-card': '' }, [
    el('p', { class: 'ask-lbl' }, [T.showTitle(a.fromName, a.show)]),
    el('small', { class: 'hint' }, [T.showBody(a.fromName)]),
    el('button', { class: 'btn btn-mint', type: 'button', 'data-show-yes': '', onclick: yes }, [T.showYes]),
    el('button', { class: 'btn btn-ghost', type: 'button', 'data-show-no': '', onclick: no }, [T.showNo]),
  ])
}

/** The optional "who has it" box under a tip (P7: small, greyed); my people's names as suggestions. The input carries data-know-who. */
export function knowWhoBox(people: readonly Pick<Person, 'name' | 'via' | 'deleted_at'>[]): HTMLElement {
  const list = el('datalist', { id: 'seen-who-list' }, people.filter((p) => !p.via && p.deleted_at === undefined && p.name).slice(0, 200).map((p) => el('option', { value: p.name })))
  const box = el('input', { class: 'field opt-min seen-who', type: 'text', maxlength: '40', list: 'seen-who-list', placeholder: T.whoPh, 'aria-label': T.whoAria, 'data-know-who': '' })
  return el('div', { class: 'seen-who-wrap' }, [box, list])
}
