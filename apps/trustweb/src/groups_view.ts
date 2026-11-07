// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 (group_fit.ts): "Groups I could join or help": ranked group cards, each with who I know there, and the Add / Edit form. Local only (I1). DOM; main.ts passes the app in. */
import { el } from '../../demo/src/ui/dom'
import type { AppState, TwGroup } from './model'
import { Ring } from './model'
import { chipInput } from './chip_input'
import { myTags, rankGroups, warmPath } from './group_fit'
import { S } from './strings'

export interface GroupsIo {
  st: () => AppState
  save: () => void
  /** Opens the intro ask for this target (the existing consent flow, intro_ask.ts). */
  askIntro: (target: string) => void
}

const STATUSES = ['watching', 'talking', 'joined', 'contributing'] as const
const MAX_TAGS = 12
let draft: TwGroup | null = null
let isNew = false

const split = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean)

function card(io: GroupsIo, r: ReturnType<typeof rankGroups>[number], redraw: () => void): HTMLElement {
  const g = r.group
  const warm = warmPath(g, io.st())
  const link = /^https?:\/\//i.test(g.link ?? '') ? g.link : undefined
  return el('article', { class: 'grp-card', 'data-group': g.id }, [
    el('div', { class: 'grp-head' }, [
      el('b', { class: 'grp-name' }, [g.name]),
      g.status ? el('span', { class: 'grp-status', 'data-group-status': g.status }, [S.groups.status[g.status]]) : null,
    ]),
    g.about ? el('p', { class: 'grp-about' }, [g.about]) : null,
    el('ul', { class: 'grp-reasons', 'data-group-reasons': '' }, (r.fit.reasons.length ? r.fit.reasons.slice(0, 3) : [S.groups.noReason]).map((t) => el('li', {}, [t]))),
    warm.length
      ? el('p', { class: 'grp-warm', 'data-group-warm': '' }, [el('small', {}, [S.groups.knowHere + ': ']), warm.map((w) => w.person.name + (w.via ? ` (${S.groups.via(w.via.name)})` : '')).join(', ')])
      : null,
    el('div', { class: 'grp-acts' }, [
      el('button', { class: 'linkbtn', 'data-group-edit': g.id, onclick: () => { draft = { ...g, tags: [...g.tags], members: [...g.members] }; isNew = false; redraw() } }, [S.groups.edit]),
      warm.some((w) => w.via) ? el('button', { class: 'linkbtn', 'data-group-intro': g.id, onclick: () => io.askIntro(g.name) }, [S.groups.askIntro]) : null,
      link ? el('a', { class: 'linkbtn', href: link, target: '_blank', rel: 'noopener' }, [S.groups.open]) : null,
    ]),
  ])
}

function chips(items: Array<{ label: string; attr: string; remove: () => void }>): HTMLElement {
  return el('div', { class: 'chips' }, items.map((i) => el('button', { class: 'chip on', type: 'button', 'data-group-chip': i.attr, 'aria-label': i.label + ' ×', onclick: i.remove }, [i.label + ' ×'])))
}

function form(io: GroupsIo, g: TwGroup, redraw: () => void): HTMLElement {
  const s = io.st()
  const field = (label: string, node: HTMLElement): HTMLElement => el('label', { class: 'grp-field' }, [el('span', { class: 'chips-lbl' }, [label]), node])
  const text = (key: 'name' | 'about' | 'link', label: string, max: number): HTMLElement => {
    const i = el('input', { class: 'field', type: key === 'link' ? 'url' : 'text', maxlength: String(max), 'data-group-field': key, value: g[key] ?? '' }) as HTMLInputElement
    i.addEventListener('input', () => { g[key] = i.value })
    return field(label, i)
  }
  const known = [...new Set([...myTags(s), ...(s.groups ?? []).flatMap((x) => x.tags)])]
  const addTag = (t: string): void => { const tag = t.trim().toLowerCase(); if (tag && !g.tags.includes(tag) && g.tags.length < MAX_TAGS) { g.tags.push(tag); redraw(); focus('[data-group-tag-input]') } }
  const tagBox = chipInput({
    placeholder: S.groups.tags, aria: S.groups.tags, attrs: { 'data-group-tag-input': '' },
    hits: (q) => {
      const typed = split(q.replace(/;/g, ','))
      return [...typed.map((t) => ({ label: '+ ' + t, attrs: { 'data-group-tag-add': t }, pick: () => addTag(t) })),
        ...known.filter((t) => q.trim() && t.includes(q.trim().toLowerCase()) && !g.tags.includes(t)).slice(0, 5).map((t) => ({ label: t, attrs: { 'data-group-tag-add': t }, pick: () => addTag(t) }))]
    },
  })
  const pick = (id: string): void => { g.members = g.members.includes(id) ? g.members.filter((m) => m !== id) : [...g.members, id]; redraw(); focus('[data-group-member-input]') }
  const personBox = chipInput({
    placeholder: S.groups.members, aria: S.groups.members, attrs: { 'data-group-member-input': '' },
    hits: (q) => s.people.filter((p) => p.ring !== Ring.None && !g.members.includes(p.id) && q.trim() && p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
      .map((p) => ({ label: p.name, attrs: { 'data-group-member-add': p.id }, pick: () => pick(p.id) })),
  })
  const resources = el('select', { class: 'field', 'data-group-field': 'resources' }, [0, 1, 2, 3].map((n) => el('option', { value: String(n), ...(n === (g.resources ?? 0) ? { selected: '' } : {}) }, [S.groups.resources[n]]))) as HTMLSelectElement
  resources.addEventListener('change', () => { g.resources = Number(resources.value) as TwGroup['resources'] })
  const status = el('select', { class: 'field', 'data-group-field': 'status' }, [el('option', { value: '' }, ['']), ...STATUSES.map((k) => el('option', { value: k, ...(k === g.status ? { selected: '' } : {}) }, [S.groups.status[k]]))]) as HTMLSelectElement
  status.addEventListener('change', () => { if (status.value) g.status = status.value as TwGroup['status']; else delete g.status })
  const save = (): void => {
    if (!g.name?.trim()) { focus('[data-group-field="name"]'); return }
    const out: TwGroup = { ...g, name: g.name.trim(), updatedAt: Date.now() }
    for (const k of ['about', 'link'] as const) if (!out[k]?.trim()) delete out[k]
    const list = s.groups ?? []
    s.groups = isNew ? [...list, out] : list.map((x) => (x.id === out.id ? out : x))
    io.save(); draft = null; redraw()
  }
  return el('form', { class: 'grp-form', 'data-group-form': '', onsubmit: (e: Event) => { e.preventDefault(); save() } }, [
    text('name', S.groups.name, 80), text('about', S.groups.about, 200), text('link', S.groups.link, 200),
    field(S.groups.tags, el('div', {}, [chips(g.tags.map((t) => ({ label: t, attr: t, remove: () => { g.tags = g.tags.filter((x) => x !== t); redraw() } }))), tagBox.input, tagBox.hits])),
    field(S.groups.members, el('div', {}, [chips(g.members.map((id) => ({ label: s.people.find((p) => p.id === id)?.name ?? id, attr: id, remove: () => pick(id) }))), personBox.input, personBox.hits])),
    field(S.groups.resourcesLbl, resources), field(S.groups.statusLbl, status),
    el('div', { class: 'grp-acts' }, [
      el('button', { class: 'btn btn-electric btn-sm', type: 'submit', 'data-group-save': '' }, [S.groups.save]),
      el('button', { class: 'linkbtn', type: 'button', 'data-group-cancel': '', onclick: () => { draft = null; redraw() } }, [S.groups.cancel]),
    ]),
  ])
}

function focus(sel: string): void { setTimeout(() => (document.querySelector(sel) as HTMLElement | null)?.focus(), 0) }

export function groupsView(io: GroupsIo): HTMLElement {
  const root = el('div', { class: 'grp', 'data-groups': '' })
  const redraw = (): void => {
    const ranked = rankGroups(io.st())
    root.replaceChildren(
      el('p', { class: 'hint' }, [S.groups.privacy]),
      draft ? form(io, draft, redraw) : el('button', { class: 'linkbtn', 'data-group-add': '', onclick: () => { draft = { id: `g${Date.now().toString(36)}`, name: '', tags: [], members: [], updatedAt: Date.now() }; isNew = true; redraw() } }, [S.groups.add]),
      ...(ranked.length ? ranked.filter((r) => r.group.id !== (isNew ? '' : draft?.id)).map((r) => card(io, r, redraw)) : draft ? [] : [el('p', { class: 'hint', 'data-groups-none': '' }, [S.groups.none])]),
    )
  }
  redraw()
  return root
}
