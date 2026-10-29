// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 25 (Jakob 2026-10-29): the pieces of a person's card that moved onto the page: the Connect panel (bare TrustWeb link plus the
 * Signal / WhatsApp / other links typed here) and the collapsible Days section. DOM only; the rules are person_links.ts, person_days.ts, fold.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { foldKey, foldOpen, foldStored } from './fold'
import { ICONS } from './icons'
import type { AppState, Person } from './model'
import { LINK_KINDS, linkEntries, setLink } from './person_links'
import type { LinkKind } from './person_links'
import { DAYS_PAGE, personDays } from './person_days'
import { S } from './strings'

export interface ConnectDeps {
  /** My bare TrustWeb connect link. */
  link: () => Promise<string>
  save: () => void
  toast: (msg: string) => void
}

const GLYPH: Record<LinkKind, string> = { signal: ICONS.signal, whatsapp: ICONS.whatsapp, other: ICONS.web }
const icon = (kind: LinkKind): HTMLElement => { const s = el('span', { class: 'tl-glyph', 'aria-hidden': 'true' }); s.innerHTML = GLYPH[kind]; return s }

/** "<name> isn't connected on TrustWeb yet. Connect first to chat here." with Connect underlined; a tap opens the panel under it. */
export function connectBlock(p: Person, name: string, d: ConnectDeps): HTMLElement {
  const linkText = el('p', { class: 'connect-link', 'data-connect-link': '' }, [S.cardConnectLoading])
  const linksBox = el('div', { class: 'card-links', 'data-card-links': p.id })
  const form = el('div')
  const draw = (): void => {
    linksBox.replaceChildren(...linkEntries(p).map(({ kind, url }) => el('div', { class: 'card-ch', 'data-card-link': kind }, [
      icon(kind), el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, [url]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-edit-link': kind, onclick: () => edit(kind) }, [S.cardLinkEdit]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-remove-link': kind, onclick: () => { setLink(p, kind, ''); d.save(); draw() } }, [S.cardLinkRemove]),
    ])))
  }
  const edit = (kind: LinkKind): void => {
    const input = el('input', { class: 'field', type: 'url', maxlength: '300', placeholder: S.cardLinkPh, 'aria-label': S.cardAddLink[kind], value: p.links?.[kind] ?? '', 'data-link-input': kind }) as HTMLInputElement
    form.replaceChildren(el('div', { class: 'card-ch' }, [input,
      el('button', { class: 'btn btn-electric btn-sm', 'data-link-save': kind, onclick: () => {
        if (!input.value.trim() && !p.links?.[kind]) { form.replaceChildren(); return }
        if (!setLink(p, kind, input.value)) { d.toast(S.cardLinkBad); return }
        d.save(); draw(); form.replaceChildren()
      } }, [S.tlSave]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => form.replaceChildren() }, [S.tlCancel]),
    ]))
    input.focus()
  }
  const panel = el('div', { class: 'connect-panel', hidden: true, 'data-connect-panel': p.id }, [
    linkText,
    el('div', { class: 'card-ch' }, [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-connect-copy': '', onclick: () => { void navigator.clipboard.writeText(linkText.textContent ?? '').then(() => d.toast(S.meetCopied)) } }, [S.cardCopy]),
      typeof navigator.share === 'function' ? el('button', { class: 'btn btn-ghost btn-sm', 'data-connect-share': '', onclick: () => { void navigator.share({ text: linkText.textContent ?? '' }).catch(() => undefined) } }, [S.cardShare]) : null,
    ]),
    linksBox,
    el('div', { class: 'card-ch' }, LINK_KINDS.map((kind) => el('button', { class: 'btn btn-ghost btn-sm', 'data-add-link': kind, onclick: () => edit(kind) }, [S.cardAddLink[kind]]))),
    form,
  ])
  draw()
  const connect = el('button', { class: 'card-connect', 'data-connect-first': p.id, 'aria-expanded': 'false', onclick: (e: Event) => {
    panel.hidden = !panel.hidden
    ;(e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!panel.hidden))
    if (!panel.hidden) void d.link().then((u) => { linkText.textContent = u }, () => { linkText.textContent = S.cardConnectNoLink })
  } }, [S.cardConnect])
  return el('div', { class: 'card-chat-why' }, [el('p', { class: 'meta' }, [S.cardNotConnectedLead(name), connect, S.cardNotConnectedTail]), panel])
}

/** "Days": what happened with this person by day, newest first; open by default, 30 days at a time, the fold remembered. */
export function daysSection(state: () => AppState, p: Person): HTMLElement {
  const read = (): boolean => { try { return foldOpen(window.localStorage.getItem(foldKey('days')), true) } catch { return true } }
  let open = read()
  let limit = DAYS_PAGE
  const body = el('div', { class: 'days-body' })
  const head = el('button', { class: 'fold-btn', 'aria-expanded': String(open), 'data-days-toggle': p.id })
  const draw = (): void => {
    const { days, more } = personDays(state(), state().people.find((x) => x.id === p.id) ?? p, limit)
    head.textContent = `${open ? '▾' : '▸'} ${S.pdTitle} (${days.length}${more ? '+' : ''})`
    head.setAttribute('aria-expanded', String(open))
    body.hidden = !open
    body.replaceChildren(
      ...days.map((d) => el('div', { class: 'days-day', 'data-tl-day': String(d.day) }, [
        el('h5', { class: 'eyebrow' }, [new Date(d.day).toLocaleDateString([], { dateStyle: 'medium' })]),
        ...d.entries.map((e) => el('p', { class: 'meta' }, [e.summary])),
      ])),
      ...(days.length ? [] : [el('p', { class: 'meta' }, [S.tlNone])]),
      ...(more ? [el('button', { class: 'btn btn-ghost btn-sm', 'data-days-more': '', onclick: () => { limit += DAYS_PAGE; draw() } }, [S.pdMore])] : []),
    )
  }
  head.addEventListener('click', () => { open = !open; try { window.localStorage.setItem(foldKey('days'), foldStored(open)) } catch { /* not remembered */ } draw() })
  draw()
  return el('div', { class: 'card-days', 'data-card-days': p.id }, [el('h4', { class: 'fold-head' }, [head]), body])
}
