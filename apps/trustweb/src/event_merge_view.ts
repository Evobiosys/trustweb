// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 merge-events: the event page's part. A host sees a "+ merge" chip (styled like "+ tag" of the person view) that opens a sheet: pick
 * the other event, then Merge now (host of both) or Ask its hosts (event_merge_flow.ts). The host of the other event sees the ask as a card on
 * their event's page (Merge / Not now); the asker sees "Waiting for ...". MCP: event_merge, event_merge_answer, event_merge_asks_list.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState, TwEvent } from './model'
import { mayApprove } from './event_roles'
import { decodeEventLink } from './event_link'
import { mayMerge, mergeCandidates } from './event_merge'
import { hostPeersOf, type MergeStart } from './event_merge_flow'
import { S } from './strings'

export { defineEventMergeActions } from './event_merge_actions'
export { mergedInto } from './event_merge'

export interface MergeViewHost {
  st(): AppState
  openSheet(body: (Node | null)[]): void
  closeSheet(): void
  toast(text: string): void
  redraw(): void
  start(keep: string, gone: string): Promise<MergeStart>
  answer(keep: string, gone: string, yes: boolean): Promise<boolean>
}

const T = S.w45merge
const names = (xs: readonly string[]): string => [...new Set(xs)].join(', ')

export function createMergeView(h: MergeViewHost) {
  const movers = (id: string): number => h.st().people.filter((p) => p.events?.includes(id)).length
  const keepName = (keep: string, link?: string): string =>
    h.st().events?.find((e) => e.id === keep)?.name ?? (link ? decodeEventLink(link.slice(Math.max(0, link.indexOf('#'))))?.name : undefined) ?? keep

  function choose(keep: TwEvent, gone: TwEvent, area: HTMLElement): void {
    const s = h.st()
    const mode = mayMerge(s, keep.id, gone.id)
    const hosts = mode === 'ask' ? hostPeersOf(s, gone).map((p) => p.name) : []
    const run = (): void => {
      const n = movers(gone.id)
      void h.start(keep.id, gone.id).then((r) => {
        h.closeSheet()
        h.toast(r === 'merged' ? T.merged(n) : r === 'asked' ? T.asked(names(hosts)) : r === 'no-host' ? T.noHost : T.notHost)
        h.redraw()
      })
    }
    area.replaceChildren(
      el('p', { class: 'meta', 'data-event-merge-hint': '' }, [T.hint(keep.name)]),
      mode === 'ask' && !hosts.length
        ? el('p', { class: 'meta', 'data-event-merge-nohost': '' }, [T.noHost])
        : el('button', { class: 'btn btn-electric wide', type: 'button', 'data-event-merge-go': mode, onclick: run }, [mode === 'now' ? T.now : T.ask(names(hosts))]),
    )
  }

  function sheet(keep: TwEvent): void {
    const others = mergeCandidates(h.st(), keep.id)
    const area = el('div', { 'data-event-merge-area': '' })
    h.openSheet([
      el('h3', {}, [T.title(keep.name)]),
      others.length
        ? el('div', { class: 'chips', role: 'group', 'aria-label': T.pickAria }, others.map((e) =>
          el('button', { class: 'chip', type: 'button', 'data-event-merge-pick': e.id, onclick: (x: Event) => {
            for (const b of (x.currentTarget as HTMLElement).parentElement?.children ?? []) b.setAttribute('aria-pressed', String(b === x.currentTarget))
            choose(keep, e, area)
          } }, [e.name])))
        : el('p', { class: 'meta', 'data-event-merge-none': '' }, [T.none]),
      area,
      el('button', { class: 'btn btn-ghost wide', type: 'button', onclick: h.closeSheet }, [T.cancel]),
    ])
  }

  /** The event page's merge part: the asks to me about this event, my waiting asks, and the "+ merge" chip for a host. */
  function eventSection(ev: TwEvent): Node[] {
    const s = h.st()
    const asks = s.eventMergeAsks ?? []
    const out: Node[] = asks.filter((a) => a.dir === 'in' && a.gone === ev.id).map((a) => {
      const answer = (yes: boolean): void => {
        const n = movers(ev.id)
        void h.answer(a.keep, a.gone, yes).then((ok) => { if (ok) h.toast(yes ? T.merged(n) : T.declined); h.redraw() })
      }
      return el('div', { class: 'card merge-ask', 'data-event-merge-ask': a.keep }, [
        el('p', { class: 'ev-what' }, [T.askTitle(a.from, keepName(a.keep, a.link))]),
        el('p', { class: 'meta' }, [T.askBody]),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-event-merge-yes': '', onclick: () => answer(true) }, [T.accept]),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-event-merge-no': '', onclick: () => answer(false) }, [T.decline]),
        ]),
      ])
    })
    const waiting = asks.filter((a) => a.dir === 'out' && a.keep === ev.id)
    if (waiting.length) out.push(el('p', { class: 'meta', 'data-event-merge-waiting': '' }, [T.waiting(names(waiting.map((a) => a.from)))]))
    if (mayApprove(ev, s.me.displayName, s.people)) out.push(el('button', { class: 'chip merge-chip', type: 'button', 'data-event-merge': ev.id, 'aria-label': T.open, onclick: () => sheet(ev) }, [T.chip]))
    return out
  }

  return { eventSection }
}
