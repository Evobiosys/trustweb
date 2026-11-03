// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (messengers-combined): the Chat screen's source pill + three-dots menu and the combined list (rows from every chosen source, a C-bracket in the source colour on the left edge). DOM + localStorage. */
import { ICONS } from './icons'
import { el } from '../../demo/src/ui/dom'
import type { MessengerSource, ThreadSummary } from './ext/registry'
import { activateKey, dismissOnOutside } from './key_press'
import { focusRows, hideNewerThan, listEntries, mergeThreads, parseOff, parseSelection, sourceColor, toggleSource, usableSelection, viewTitle, TRUSTWEB_SOURCE, type SourceEntry, type TaggedThread } from './messenger_combine'
import { ageLabel } from './model'
import { S } from './strings'

const SELECTION_KEY = 'trustweb.ui.chatSources'
const OFF_KEY = 'trustweb.msg.off'

const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* not remembered */ } }

export const switchedOff = (): Set<string> => parseOff(read(OFF_KEY))
export function setSourceOff(id: string, off: boolean): void {
  const set = switchedOff()
  if (off) set.add(id); else set.delete(id)
  write(OFF_KEY, JSON.stringify([...set]))
  // A source switched off leaves the chosen view too.
  write(SELECTION_KEY, JSON.stringify(parseSelection(read(SELECTION_KEY)).filter((x) => !set.has(x))))
}

export interface CombinedDeps {
  sources: readonly MessengerSource[]
  /** TrustWeb's own chats as thread summaries (id = person id). */
  trustweb: () => ThreadSummary[]
  openTrustweb: (id: string) => void
  /** Do Not Disturb: when it was switched on, or undefined while it is off. */
  dndSince: () => number | undefined
  /** Draws the Chat screen again. */
  redraw: () => void
}

/** Module state for the one-person focus; gone with the page. */
let focus: string | null = null

export interface ChatView {
  selection: string[]
  /** Only TrustWeb: the simple chat list stays as it is. */
  simple: boolean
  title: string
  pill: HTMLElement
  dots: HTMLElement
  /** The combined / single-source body; null for the simple chat. */
  body: HTMLElement | null
}

export function chatView(d: CombinedDeps): ChatView {
  const off = switchedOff()
  const entries = listEntries(d.sources, off, S.chatViaTrustweb)
  const selection = usableSelection(parseSelection(read(SELECTION_KEY)), entries)
  const labels = Object.fromEntries(entries.map((e) => [e.id, e.label]))
  const usable = entries.filter((e) => e.state === 'on').length
  const title = viewTitle(selection, labels, S.chatViewAll, usable)
  const choose = (sel: string[]): void => { write(SELECTION_KEY, JSON.stringify(sel)); focus = null; d.redraw() }
  const wrap = el('span', { class: 'chat-row-wrap chat-source-wrap', 'data-chat-switch': '' })
  const menu = el('div', { class: 'chat-menu chat-source-menu', role: 'menu', 'data-chat-source-menu': '', hidden: '' })
  // Wave 29: a round ⇄ button in the header's views slot (like the Web's eye); the current service's name sits under it.
  const pill = el('button', { class: 'hdr-btn icon-only chat-switch-btn', 'data-chat-source-pill': '', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': S.chatSwitchAria, title: S.chatViewMenu })
  pill.innerHTML = ICONS.switch
  const name = el('small', { class: 'chat-switch-name', 'data-chat-view-name': '' }, [title])
  const dots = el('button', { class: 'hdr-btn icon-only', 'data-chat-dots': '', 'aria-haspopup': 'menu', 'aria-label': S.chatViewMore, title: S.chatViewMore }, ['⋯'])
  let stop: (() => void) | null = null
  const hide = (): void => { menu.hidden = true; pill.setAttribute('aria-expanded', 'false'); stop?.(); stop = null }
  const show = (): void => {
    menu.replaceChildren(...menuRows(d, entries, selection, off, choose, hide))
    menu.hidden = false
    pill.setAttribute('aria-expanded', 'true')
    stop = dismissOnOutside((t) => t instanceof Node && (wrap.contains(t) || dots.contains(t)), hide)
  }
  const toggle = (e: Event): void => { e.stopPropagation(); if (menu.hidden) show(); else hide() }
  pill.addEventListener('click', toggle)
  dots.addEventListener('click', toggle)
  wrap.append(pill, name, menu)
  const simple = selection.length === 1 && selection[0] === TRUSTWEB_SOURCE
  return { selection, simple, title, pill: wrap, dots, body: simple ? null : combinedBody(d, selection, labels) }
}

function menuRows(d: CombinedDeps, entries: readonly SourceEntry[], selection: string[], off: Set<string>, choose: (s: string[]) => void, hide: () => void): Node[] {
  const src = (id: string): MessengerSource | undefined => d.sources.find((s) => s.id === id)
  const rows = entries.map((e) => {
    const s = src(e.id)
    const grey = e.state === 'setup'
    const hint = el('small', { class: 'meta', 'data-chat-source-hint': e.id }, grey ? [S.chatViewSetup] : [])
    if (grey && s?.probe) void s.probe().then((f) => { if (f !== 'live') hint.textContent = (f === 'installed' ? S.chatGebFound : S.chatGebAbsent) + ' ' + S.chatViewSetup })
    return el('div', { class: 'chat-menu-item' + (grey ? ' grey' : ''), role: 'none', 'data-chat-source': e.id, 'data-state': e.state }, [
      el('button', { class: 'chat-menu-open', role: 'menuitem', 'data-chat-source-open': e.id, 'aria-label': grey ? `${e.label}. ${S.chatViewSetup}` : S.chatViewOnly(e.label), onclick: () => { hide(); if (grey) s?.setup?.(); else choose([e.id]) } }, [e.label, grey ? el('br') : null, grey ? hint : null]),
      grey ? null : el('button', { class: 'chat-menu-pin' + (selection.includes(e.id) ? ' on' : ''), 'data-chat-add': e.id, 'aria-pressed': String(selection.includes(e.id)), 'aria-label': S.chatViewAdd(e.label, selection.includes(e.id)), onclick: () => { hide(); choose(toggleSource(selection, e.id)) } }, [selection.includes(e.id) ? '✓' : '+']),
      e.id === TRUSTWEB_SOURCE ? null : el('button', { class: 'chat-menu-pin', 'data-chat-off': e.id, 'aria-label': S.chatViewOff(e.label), onclick: () => { hide(); setSourceOff(e.id, true); d.redraw() } }, ['⊘']),
    ])
  })
  const ready = entries.filter((e) => e.state === 'on').map((e) => e.id)
  return [
    ...rows,
    ready.length > 1 ? el('button', { class: 'chat-menu-open', role: 'menuitem', 'data-chat-all': '', onclick: () => { hide(); choose(ready) } }, [S.chatViewAllBtn]) : null,
    ...(off.size ? [el('small', { class: 'meta' }, [S.chatViewOffTitle]), ...[...off].map((id) => {
      const label = src(id)?.label ?? id
      return el('button', { class: 'chat-menu-open', role: 'menuitem', 'data-chat-on': id, onclick: () => { hide(); setSourceOff(id, false); d.redraw() } }, [S.chatViewOn(label)])
    })] : []),
  ].filter((n): n is HTMLElement => n !== null)
}

function row(t: TaggedThread, label: string, col: number, open: () => void, only: () => void): HTMLElement {
  return el('div', {
    class: 'prow chat-row src-row', role: 'button', tabindex: '0', 'data-msg-thread': t.id, 'data-chat-src': t.source,
    style: `--src:${sourceColor(t.source)};--col:${col}`, onclick: open, onkeydown: activateKey(open),
  }, [
    el('div', { class: 'who' }, [el('b', {}, [t.title]), el('small', { class: 'meta src-tag' }, [S.chatFrom(label)])]),
    t.lastAt ? el('span', { class: 'when' }, [ageLabel(t.lastAt, Date.now())]) : null,
    t.unread > 0 ? el('span', { class: 'dot', role: 'img', 'aria-label': S.chatTabUnread(t.unread) }) : null,
    el('button', { class: 'btn btn-ghost btn-sm', 'data-chat-only': `${t.source}:${t.id}`, onclick: (e: Event) => { e.stopPropagation(); only() } }, [S.chatOnlyThis]),
  ])
}

function combinedBody(d: CombinedDeps, selection: string[], labels: Record<string, string>): HTMLElement {
  const own = selection.length === 1 ? d.sources.find((s) => s.id === selection[0])?.view : undefined
  if (own) return el('div', { class: 'msg-ext', 'data-msg-source': selection[0] }, own())
  const box = el('div', { class: 'msg-ext msg-merged', 'data-msg-merged': selection.join(','), style: `--cols:${selection.length}` })
  box.append(el('p', { class: 'meta' }, [S.msgLoading]))
  const since = d.dndSince()
  const fetchOne = async (id: string): Promise<ThreadSummary[]> => (id === TRUSTWEB_SOURCE ? d.trustweb() : (await d.sources.find((s) => s.id === id)?.threads()) ?? [])
  void Promise.allSettled(selection.map(fetchOne)).then((results) => {
    const by: Record<string, ThreadSummary[]> = {}
    const down: string[] = []
    results.forEach((r, i) => { if (r.status === 'fulfilled') by[selection[i]] = r.value; else down.push(selection[i]) })
    const rows = hideNewerThan(mergeThreads(by), since)
    const paint = (): void => {
      const shown = focusRows(rows, focus)
      box.replaceChildren(
        ...down.map((id) => el('p', { class: 'empty', 'data-msg-down': id }, [S.msgUnreachable(labels[id] ?? id)])),
        ...(focus ? [el('button', { class: 'btn btn-ghost btn-sm', 'data-chat-show-all': '', onclick: () => { focus = null; paint() } }, [S.chatShowAll])] : []),
        ...(shown.length ? shown.map((t) => row(t, labels[t.source] ?? t.source, selection.indexOf(t.source) + 1, () => (t.source === TRUSTWEB_SOURCE ? d.openTrustweb(t.id) : d.sources.find((s) => s.id === t.source)?.open(t.id)), () => { focus = `${t.source}:${t.id}`; paint() })) : [el('p', { class: 'empty' }, [S.msgNoThreads])]),
        ...(selection.length === 1 ? (d.sources.find((s) => s.id === selection[0])?.extra?.() ?? []) : []),
      )
    }
    paint()
  })
  return box
}
