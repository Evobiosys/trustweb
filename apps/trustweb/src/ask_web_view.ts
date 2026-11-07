// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Ask your web, in the ask box (wave 31): matches in my web as the person types, a source-set picker, "Also search online" and, with
 * their own AI endpoint, "Summarise with my AI". Settings > Advanced: the engine template and the source sets.
 */
import { el } from '../../demo/src/ui/dom'
import { ALL_SCOPE, SUMMARY_SYSTEM, askScopes, matchWeb, searchEngineUrl, summaryPrompt } from './ask_web_search'
import { ENGINES, engineById, engineUrl, isAdvanced, type OnlineEngine } from './search_engines'
import { ownChannels } from './channel_readers'
import { askEndpointText, configured } from './llm_endpoint'
import type { AppState } from './model'
import { S } from './strings'
import { alive } from './deleted_people'

export interface AskWebHooks { state: () => AppState; save: () => void }

let scope = ALL_SCOPE
let onlineOpen = false

/** One engine as a chip that opens the words there in a new tab and remembers the choice. */
function engineChip(h: AskWebHooks, e: OnlineEngine, q: string): HTMLElement {
  const on = engineById(h.state().askEngine).id === e.id
  const a = el('a', {
    class: 'chip' + (on ? ' on' : ''), href: engineUrl(e.id, q), target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
    'data-ask-engine': e.id, 'aria-current': String(on),
  }, [e.private ? `${e.name} · ${S.askWebPrivate}` : e.name])
  a.addEventListener('click', () => {
    h.state().askEngine = e.id
    h.save()
    a.parentElement?.parentElement?.querySelectorAll('[data-ask-engine]').forEach((c) => { const me = c === a; c.classList.toggle('on', me); c.setAttribute('aria-current', String(me)) })
  })
  return a
}

/** The block under the ask box; `update(words)` redraws it without touching the typing field. */
export function askWebPanel(h: AskWebHooks, query: string): { el: HTMLElement; update: (q: string) => void } {
  const root = el('div', { class: 'ask-web', 'data-ask-web': '1' })
  let words = query
  let summary = ''
  const draw = (): void => {
    const s = h.state()
    const q = words.trim()
    const scopes = askScopes(s)
    if (!scopes.some((x) => x.id === scope)) scope = ALL_SCOPE
    const matches = q ? matchWeb(s, q, scope) : []
    const url = s.askEngineUrl ? searchEngineUrl(s.askEngineUrl, q) : null
    const ai = s.advanced?.ai
    const out = el('p', { class: 'meta', 'data-ask-summary': '1', 'aria-live': 'polite' }, [summary])
    root.replaceChildren(
      ...(q ? [
      ...(scopes.length > 1 ? [el('div', { class: 'chips' }, [
        el('span', { class: 'chips-lbl' }, [S.askWebScope]),
        ...scopes.map((x) => el('button', {
          class: 'chip' + (x.id === scope ? ' on' : ''), type: 'button', 'aria-pressed': String(x.id === scope), 'data-ask-scope': x.id,
          onclick: () => { scope = x.id; summary = ''; draw() },
        }, [x.name || S.askWebEveryone])),
      ])] : []),
      el('p', { class: 'web-search-head' }, [el('b', {}, [S.askWebHere])]),
      matches.length
        ? el('ul', { class: 'ask-web-list' }, matches.slice(0, 8).map((m) => el('li', { 'data-ask-match': m.kind }, [
            m.label, ' ', el('small', {}, [[S.askWebKind[m.kind], m.detail].filter(Boolean).join(' · ')]),
          ])))
        : el('p', { class: 'meta' }, [S.askWebNone]),
      ...(configured(ai) && matches.length ? [el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', 'data-ask-summarise': '1', title: S.askWebSummaryHint,
        onclick: async () => {
          out.textContent = S.askWebSummarising
          try { summary = await askEndpointText(ai, SUMMARY_SYSTEM, summaryPrompt(q, matches.slice(0, 8)), undefined, undefined, ownChannels(s)); out.textContent = summary }
          catch (e) { out.textContent = S.askWebSummaryError((e as Error).message) }
        },
      }, [S.askWebSummarise])] : []),
      out,
      ] : []),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', 'data-ask-online': '1', 'aria-expanded': String(onlineOpen), title: S.askWebOnlineHint,
        onclick: () => { onlineOpen = !onlineOpen; draw() },
      }, [S.askWebOnline]),
      ...(onlineOpen ? [el('div', { class: 'ask-engines' }, [
        el('div', { class: 'chips' }, ENGINES.filter((e) => !isAdvanced(e.id)).map((e) => engineChip(h, e, q))),
        el('details', { 'data-ask-engines-advanced': '1' }, [
          el('summary', {}, [S.askWebAdvanced]),
          el('div', { class: 'chips' }, ENGINES.filter((e) => isAdvanced(e.id)).map((e) => engineChip(h, e, q))),
        ]),
        ...(url ? [el('a', { class: 'btn btn-ghost btn-sm', href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer', 'data-ask-own': '1' }, [S.askWebOwnEngine])] : []),
      ])] : []),
    )
  }
  draw()
  return { el: root, update: (q) => { if (q !== words) summary = ''; words = q; draw() } }
}

/** Settings > Advanced: the online engine template and the source sets (name, tags; people are picked by name). */
export function askWebSettings(h: AskWebHooks): HTMLElement[] {
  const box = el('div', { class: 'channels', 'data-ask-web-settings': '' })
  const draw = (): void => {
    const s = h.state()
    const engine = el('input', { class: 'field', type: 'url', placeholder: S.askWebEngine, 'aria-label': S.askWebEngine, value: s.askEngineUrl ?? '', 'data-ask-engine-url': '' }) as HTMLInputElement
    engine.addEventListener('change', () => { const v = engine.value.trim(); if (v) s.askEngineUrl = v; else delete s.askEngineUrl; h.save() })
    box.replaceChildren(
      el('h4', { class: 'eyebrow' }, [S.askWebSettings]),
      engine,
      el('h4', { class: 'eyebrow' }, [S.askWebSets]),
      ...(s.askSets ?? []).map((set) => {
        const name = el('input', { class: 'field', placeholder: S.askWebSetName, 'aria-label': S.askWebSetName, value: set.name, 'data-ask-set-name': set.id }) as HTMLInputElement
        name.addEventListener('change', () => { set.name = name.value.trim() || set.name; h.save() })
        const tags = el('input', { class: 'field', placeholder: S.askWebSetTags, 'aria-label': S.askWebSetTags, value: set.tags.join(', '), 'data-ask-set-tags': set.id }) as HTMLInputElement
        tags.addEventListener('change', () => { set.tags = tags.value.split(',').map((t) => t.trim()).filter(Boolean); h.save() })
        return el('div', { class: 'ask-set', 'data-ask-set': set.id }, [
          name, tags,
          el('div', { class: 'chips' }, alive(s.people).map((p) => el('button', {
            class: 'chip' + (set.personIds.includes(p.id) ? ' on' : ''), type: 'button', 'aria-pressed': String(set.personIds.includes(p.id)),
            onclick: () => { set.personIds = set.personIds.includes(p.id) ? set.personIds.filter((x) => x !== p.id) : [...set.personIds, p.id]; h.save(); draw() },
          }, [p.name]))),
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { s.askSets = (s.askSets ?? []).filter((x) => x !== set); if (!s.askSets.length) delete s.askSets; h.save(); draw() } }, [S.askWebSetRemove]),
        ])
      }),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', 'data-ask-set-add': '1',
        onclick: () => { (s.askSets ??= []).push({ id: crypto.randomUUID(), name: S.askWebSetName, personIds: [], tags: [] }); h.save(); draw() },
      }, [S.askWebSetAdd]),
      el('p', { class: 'meta' }, [S.askWebSetsHint]),
    )
  }
  draw()
  return [box]
}
