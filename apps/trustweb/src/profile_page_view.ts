// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b profile-page (Jakob item 27, shot 11): "Your profile" as a page. The minimum (avatar, display name, Discoverable) sits on top; everything
 * else is behind the V expander (P3): the own phone-book entry (prefix, first, middle, last, suffix, nickname), bio, pronouns, languages, place and up
 * to four related links, each field with a visibility chip (only me | people I trust | directory). Structure after Mastodon's "Edit profile" and
 * Pixelfed's profile settings (own code). Logic: profile_fields.ts; the Discoverable block and its auto-open: social_hosting_view.ts.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { FIELDS, LINK_MAX, VIS, addLink, fieldOf, maxOf, profileOf, removeLink, setFields, setVis, checkProfileLink, visOf } from './profile_fields'
import type { FieldKey, VisKey } from './profile_fields'
import { S } from './strings'

export interface ProfilePageDeps {
  state: () => AppState
  save: () => void
  face: () => HTMLElement
  toast: (msg: string) => void
  /** social.profileBlock: the Discoverable switch with its dependent toggles. */
  discoverable: (redraw: () => void) => HTMLElement
  /** The existing "who sees which section" summary (own_profile_view.ts). */
  zones: () => HTMLElement
  redraw: () => void
  fetch: typeof fetch
  /** This app's address: a linked page proves itself by linking back here with rel="me". */
  origin: string
}

const T = S.profile44
/** The V expander stays as the owner left it across redraws (a name change redraws the page). */
let moreOpen = false

export function profilePage(d: ProfilePageDeps): HTMLElement {
  const me = (): AppState['me'] => d.state().me

  const chip = (key: VisKey): HTMLElement => {
    const b = el('button', { class: 'profile-vis', type: 'button', 'data-vis': visOf(me(), key), 'data-profile-vis': key, 'aria-label': T.visAria(key, T.vis[visOf(me(), key)]) }, [T.vis[visOf(me(), key)]])
    b.addEventListener('click', () => {
      const next = VIS[(VIS.indexOf(visOf(me(), key)) + 1) % VIS.length]
      setVis(me(), key, next); d.save(); b.textContent = T.vis[next]; b.dataset.vis = next; b.setAttribute('aria-label', T.visAria(key, T.vis[next]))
    })
    return b
  }

  const fieldRow = (k: FieldKey, optional = true): HTMLElement => {
    const long = k === 'bio'
    const input = el(long ? 'textarea' : 'input', { id: `pf-${k}`, class: 'field', maxlength: String(maxOf(k)), ...(long ? { rows: '3' } : {}), 'data-profile-field': k, autocomplete: 'off', placeholder: optional ? T.optional : '' }) as HTMLInputElement
    input.value = fieldOf(me(), k)
    input.addEventListener('change', () => {
      try { setFields(me(), { [k]: input.value }); d.save() } catch (e) { d.toast(String((e as Error).message)) }
    })
    const row = el('div', { class: 'profile-field' + (optional ? ' profile-opt' : '') }, [el('label', { for: `pf-${k}` }, [T.field[k]]), input])
    if (k !== 'first' && k !== 'last') row.append(chip(k))
    return row
  }

  const links = (): HTMLElement => {
    const box = el('div', { class: 'profile-links', 'data-profile-links': '' })
    const draw = (): void => {
      const list = profileOf(me()).links ?? []
      const label = el('input', { class: 'field', maxlength: '30', 'aria-label': T.linkLabel, placeholder: T.linkLabel, 'data-profile-link-label': '' }) as HTMLInputElement
      const url = el('input', { class: 'field', type: 'url', maxlength: '200', 'aria-label': T.linkUrl, placeholder: T.linkUrl, 'data-profile-link-url': '' }) as HTMLInputElement
      const add = el('button', { class: 'btn btn-ghost', type: 'button', 'data-profile-link-add': '', onclick: () => {
        try { addLink(me(), label.value, url.value); d.save(); draw() } catch (e) { d.toast(String((e as Error).message)) }
      } }, [T.linkAdd])
      box.replaceChildren(
        el('div', { class: 'profile-field' }, [el('b', {}, [T.linksTitle]), chip('links')]),
        ...list.map((l) => {
          const state = el('small', { class: 'meta', 'aria-live': 'polite' })
          return el('div', { class: 'profile-link', 'data-prof-link': l.url }, [
            l.verified ? el('span', { class: 'tw-ok', title: T.linkChecked }, ['✓']) : null,
            el('a', { href: l.url, target: '_blank', rel: 'me noopener noreferrer' }, [l.label]),
            el('button', { class: 'btn btn-ghost', type: 'button', 'data-profile-link-check': '', onclick: async () => {
              const ok = (await checkProfileLink(me(), l.url, d.origin, d.fetch)).verified
              d.save(); state.textContent = ok ? T.linkChecked : T.linkNotChecked; if (ok) draw()
            } }, [T.linkCheck]),
            el('button', { class: 'btn btn-ghost', type: 'button', 'data-profile-link-remove': '', onclick: () => { removeLink(me(), l.url); d.save(); draw() } }, [T.linkRemove]),
            state,
          ])
        }),
        list.length < LINK_MAX ? el('div', { class: 'profile-field profile-opt' }, [label, url, add]) : el('p', { class: 'meta' }, [T.linkMax]),
      )
    }
    draw()
    return box
  }

  const name = el('input', { class: 'field', maxlength: '40', autocomplete: 'name', 'aria-label': T.nameLabel, 'data-profile-name': '', value: me().displayName }) as HTMLInputElement
  name.addEventListener('change', () => {
    const n = name.value.trim().slice(0, 40)
    if (!n) { name.value = me().displayName; return }
    me().displayName = n; d.save(); d.toast(T.nameSaved); d.redraw()
  })

  const more = el('div', { class: 'profile-more', 'data-profile-more': '', ...(moreOpen ? {} : { hidden: '' }) }, [
    el('h4', { class: 'eyebrow' }, [T.phoneBook]),
    ...(['prefix', 'first', 'middle', 'last', 'suffix', 'nickname'] as FieldKey[]).map((k) => fieldRow(k)),
    ...FIELDS.filter((k) => !['prefix', 'first', 'middle', 'last', 'suffix', 'nickname'].includes(k)).map((k) => fieldRow(k)),
    links(),
    el('p', { class: 'meta' }, [T.visHint]),
    el('h4', { class: 'eyebrow' }, [T.zones]),
    d.zones(),
  ])
  const expander = el('button', { class: 'tw-expander', type: 'button', 'data-profile-expander': '', 'aria-expanded': String(moreOpen), 'aria-label': T.more, onclick: () => {
    moreOpen = !moreOpen; more.hidden = !moreOpen; expander.setAttribute('aria-expanded', String(moreOpen)); expander.textContent = moreOpen ? '▴' : '▾'
  } }, [moreOpen ? '▴' : '▾'])

  return el('div', { class: 'scroll pad profile-page', 'data-profile-page': '' }, [
    el('div', { class: 'profile-head' }, [d.face(), name]),
    el('p', { class: 'meta' }, [T.lead]),
    d.discoverable(d.redraw),
    el('div', { class: 'social-row' }, [el('b', {}, [T.more]), expander]),
    more,
  ])
}
