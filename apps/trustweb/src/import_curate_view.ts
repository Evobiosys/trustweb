// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 (import-curate): the Curate page of an import (tags as pills, filter, useful rows first, multi-select with bulk steps before Accept,
 * advanced notes per row) and the dedupe page (pairs side by side, Merge / Keep both). DOM only; every rule is in import_curate.ts.
 * Nothing reaches the record before Accept (I9); the page opens as a page with Back, never an overlay.
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import { chipInput } from './chip_input'
import { defineSystemTag, loadColourTags, saveColourTags } from './colour_tags'
import {
  acceptAllAsAcquaintances, acceptRows, bulkAddLabels, bulkAppendNote, bulkConnect, bulkRemoveLabels, bulkSetRing, bulkUnconnect, defineLabelTags, dupePairs, editRow, filterByTag, hasHistory, keepBoth, mergePair,
  contactOf, isUnnamed, rowTags, setRingByTag, sortPending, tagCounts,
} from './import_curate'
import type { DupePair } from './import_curate'
import { Ring } from './model'
import type { AppState, ServiceRow } from './model'
import type { Pages } from './page_view'
import { bulkAccept, decide, pendingProposals } from './services_import'
import type { Pending } from './services_import'
import { S } from './strings'
import { bulkAcceptable } from './zone_proposals'
import { alphaSub } from './alpha_heading'
import type { Actions } from './actions'
import { obsidianLink } from './ext/obsidian/obsidian_card'

export interface CurateHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  /** After people were added or taken away: the web redraws. */
  changed: () => void
  pages: Pages
  /** The existing "Your AI" entry; wave 40: given the row, the assistant looks that person up. */
  openAi?: (row?: ServiceRow) => void
  /** Wave 40 ai-edit-chat: Accept, Leave, Change and adding a tag go through the action registry (undoable, seen by the assistant). */
  actions?: Actions
}

/** The zones the owner may move a person to on the Curate page (the proposal itself never goes above Friend). */
const CHANGE_RINGS: readonly Ring[] = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]
const PAGE = 50
const T = S.cur39
const u = { style: 'text-decoration:underline;cursor:pointer' }

const some = <N>(xs: readonly (N | null)[]): N[] => xs.filter((x): x is N => x !== null)

const ringSelect = (value: Ring, attrs: Record<string, string>, label: string = S.svcChange): HTMLSelectElement =>
  el('select', { class: 'field', style: 'max-width:100%', 'aria-label': label, ...attrs }, CHANGE_RINGS.map((r) => el('option', { value: r, ...(r === value ? { selected: '' } : {}) }, [S.ringLabel[r]]))) as HTMLSelectElement

/** Tag chips (× takes one away) and a typeahead input that adds a known label or creates one: the multi-tag box of the Tools filters (chip_input.ts, tag_create.ts) on labels. */
function tagBox(o: { title: string; known: readonly string[]; selected: readonly string[]; onAdd: (label: string) => void; onRemove: (label: string) => void; attr: string }): HTMLElement {
  const { input, hits } = chipInput({
    placeholder: T.tagPh, aria: o.title, attrs: { [`data-cur-tag-input`]: o.attr },
    hits: (text) => {
      const q = text.replace(/^#/, '').trim()
      if (!q) return []
      const low = q.toLowerCase()
      const found = o.known.filter((l) => !o.selected.includes(l) && l.toLowerCase().includes(low)).slice(0, 5)
      const exact = [...o.known, ...o.selected].some((l) => l.toLowerCase() === low)
      return [
        ...found.map((l) => ({ label: `#${l}`, attrs: { 'data-cur-tag-suggest': l }, pick: () => o.onAdd(l) })),
        ...(exact ? [] : [{ label: S.filterCreateTag(q), attrs: { 'data-cur-tag-create': q }, pick: () => o.onAdd(q) }]),
      ]
    },
  })
  return el('div', { class: 'zone-chip-row', 'data-cur-tagbox': o.attr }, [
    el('b', {}, [o.title]),
    el('div', { class: 'chips' }, o.selected.map((l) => el('button', { class: 'chip on', 'data-cur-tag-chip': l, 'aria-label': S.shareChipRemove(l), onclick: () => o.onRemove(l) }, [`#${l} ×`]))),
    input, hits,
  ])
}

/** "Connected with": chips of people (@) and tags (#) the person is connected with without being a member; an input that suggests existing people and tags. */
function connectBox(h: CurateHooks, o: { chips: readonly string[]; onAdd: (chip: string) => void; onRemove: (chip: string) => void; attr: string }): HTMLElement {
  const s = h.state()
  const definedTags = loadColourTags().map((t) => ({ id: t.id, label: t.label ?? t.id }))
  const label = (chip: string): string => (chip.startsWith('person:') ? `@${s.people.find((p) => p.id === chip.slice(7))?.name ?? chip.slice(7)}` : `#${definedTags.find((d) => d.id === chip.slice(4))?.label ?? chip.slice(4)}`)
  const { input, hits } = chipInput({
    placeholder: T.connectedPh, aria: T.connected, attrs: { 'data-cur-connected-input': o.attr },
    hits: (q) => {
      const text = q.trim()
      if (!text) return []
      const low = text.replace(/^[@#]/, '').toLowerCase()
      const folks = text.startsWith('#') ? [] : s.people.filter((p) => p.ring !== Ring.None && !o.chips.includes(`person:${p.id}`) && p.name.toLowerCase().includes(low)).slice(0, 5).map((p) => ({ label: `@${p.name}`, attrs: { 'data-cur-connect-person': p.id }, pick: () => o.onAdd(`person:${p.id}`) }))
      const tags = text.startsWith('@') ? [] : definedTags.filter((d) => !o.chips.includes(`tag:${d.id}`) && d.label.toLowerCase().includes(low)).slice(0, 5).map((d) => ({ label: `#${d.label}`, attrs: { 'data-cur-connect-tag': d.id }, pick: () => o.onAdd(`tag:${d.id}`) }))
      return [...folks, ...tags]
    },
  })
  return el('div', { class: 'zone-chip-row', 'data-cur-connectbox': o.attr }, [
    el('b', {}, [T.connected]),
    el('div', { class: 'chips' }, o.chips.map((c) => el('button', { class: 'chip on', 'data-cur-connected-chip': c, 'aria-label': S.shareChipRemove(label(c)), onclick: () => o.onRemove(c) }, [`${label(c)} ×`]))),
    input, hits,
    el('p', { class: 'meta' }, [T.connectedHint]),
  ])
}

/** Writes the tag definitions the rows need (a label -> a colour tag, the import's system tag) and returns the label -> id map decide() uses. */
export function ensureTags(h: Pick<CurateHooks, 'state'>, rows: readonly { batchId: string; row: ServiceRow }[]): (label: string) => string {
  const { tags, tagOf, created } = defineLabelTags(loadColourTags(), rows.flatMap((x) => rowTags(x.row)))
  if (created.length) saveColourTags(tags)
  for (const id of new Set(rows.map((x) => (h.state().serviceImports ?? []).find((b) => b.id === x.batchId)?.tag).filter((t): t is string => Boolean(t)))) defineSystemTag(id)
  return tagOf
}

const rowContact = (r: ServiceRow): HTMLElement => el('span', { class: 'meta cur-contact', 'data-cur-contact': '' }, [r.emails?.length || r.phones?.length ? S.imp39.contactLine((r.emails ?? []).join(', '), (r.phones ?? []).join(', ')) : T.noContact])

/** The Curate page: one row per proposal; Accept / Change / Leave per row, bulk steps for the selected rows. */
export function curatePage(h: CurateHooks): void {
  const ui = { tag: null as string | null, sel: new Set<string>(), limit: PAGE, unnamedOpen: false, unnamedLimit: PAGE, open: new Set<string>(), ring: Ring.Acquaintance, byTag: '', byTagRing: Ring.Friend, note: '' }
  const top = el('div', { 'data-cur-top-bar': '' })
  const bulk = el('div', { 'data-cur-bulk': '' })
  const list = el('div', { 'data-svc-list': '1' })
  const foot = el('div', { 'data-cur-foot': '' })

  const accepted = (n: number): void => { h.save(); h.changed(); h.toast(T.accepted(n)) }
  const rowsOf = (keys: ReadonlySet<string>, all: readonly Pending[]): ServiceRow[] => all.filter((x) => keys.has(x.row.key)).map((x) => x.row)

  const draw = (): void => {
    const now = Date.now()
    const all = pendingProposals(h.state(), now)
    for (const k of [...ui.sel]) if (!all.some((x) => x.row.key === k)) ui.sel.delete(k)
    const filtered = filterByTag(all, ui.tag)
    const { useful, unnamed } = sortPending(filtered)
    const shownRows = [...useful, ...(ui.unnamedOpen ? unnamed : [])]
    const tags = tagCounts(all)
    const acq = all.filter((x) => bulkAcceptable(x.proposal) && !isUnnamed(x.row))
    const free = acq.length
    const anyHistory = all.some((x) => hasHistory(x.row))
    const selRows = rowsOf(ui.sel, all)
    const picked = (label: string): void => { ui.tag = ui.tag === label ? null : label; ui.limit = PAGE; draw() }

    top.replaceChildren(...some([
      el('p', { class: 'cur-head' }, [alphaSub()]),
      all.length ? el('p', { class: 'meta', 'data-cur-count': String(filtered.length) }, [T.shown(filtered.length, all.length)]) : null,
      ...(all.length ? [
        el('div', { class: 'cur-bar' }, [
          el('label', { class: 'meta' }, [T.filter + ' ', el('select', { class: 'field', 'data-cur-filter': '', 'aria-label': T.filter, onchange: (e: Event) => { ui.tag = (e.target as HTMLSelectElement).value || null; ui.limit = PAGE; draw() } }, [
            el('option', { value: '' }, [T.allTags]), ...tags.map((t) => el('option', { value: t.label, ...(t.label === ui.tag ? { selected: '' } : {}) }, [`${t.label} (${t.count})`])),
          ])]),
          bulkDupes(all),
        ]),
        el('div', { class: 'cur-bar' }, [
          free ? el('button', { class: 'btn btn-electric', 'data-svc-bulk': String(free), onclick: () => { const n = acceptAllAsAcquaintances(h.state(), Date.now(), () => randomId(8), ensureTags(h, acq)); accepted(n); draw() } }, [T.acceptAcq(free)]) : null,
          anyHistory ? el('button', { class: 'btn btn-ghost', 'data-svc-bulk-flags': '', onclick: () => { const n = bulkAccept(h.state(), Date.now(), () => randomId(8), ensureTags(h, all.filter((x) => bulkAcceptable(x.proposal)))); accepted(n); draw() } }, [S.svcAcceptAll(all.filter((x) => bulkAcceptable(x.proposal)).length)]) : null,
        ]),
        el('p', { class: 'meta' }, [T.acceptAcqHint]),
        el('div', { class: 'cur-bar' }, [
          el('label', { class: 'meta' }, [el('input', { type: 'checkbox', 'data-cur-select-all': '', ...(shownRows.length && shownRows.every((x) => ui.sel.has(x.row.key)) ? { checked: '' } : {}), onchange: (e: Event) => { for (const x of shownRows) { if ((e.target as HTMLInputElement).checked) ui.sel.add(x.row.key); else ui.sel.delete(x.row.key) } draw() } }), ' ', T.selectAll(shownRows.length)]),
          el('label', { class: 'meta' }, [T.selectByTag + ' ', el('select', { class: 'field', 'data-cur-select-tag': '', 'aria-label': T.selectByTag, onchange: (e: Event) => { const l = (e.target as HTMLSelectElement).value; if (l) for (const x of filterByTag(all, l)) ui.sel.add(x.row.key); draw() } }, [
            el('option', { value: '' }, ['']), ...tags.map((t) => el('option', { value: t.label }, [`${t.label} (${t.count})`])),
          ])]),
          ui.sel.size ? el('button', { class: 'btn btn-ghost btn-sm', 'data-cur-select-none': '', onclick: () => { ui.sel.clear(); draw() } }, [T.selectNone]) : null,
        ]),
        byTagPanel(all, tags),
      ] : []),
    ]))
    bulk.replaceChildren(...(selRows.length ? [bulkPanel(selRows, all, tags.map((t) => t.label))] : []))
    list.replaceChildren(...(all.length ? [
      ...useful.slice(0, ui.limit).map((x) => rowView(x, picked)),
      useful.length > ui.limit ? el('button', { class: 'btn btn-ghost', 'data-cur-more': '', onclick: () => { ui.limit += PAGE; draw() } }, [T.more(Math.min(PAGE, useful.length - ui.limit))]) : null,
      unnamed.length ? el('div', { class: 'cur-unnamed', 'data-cur-unnamed': String(unnamed.length) }, [
        el('button', { class: 'btn btn-ghost', 'aria-expanded': String(ui.unnamedOpen), 'data-cur-unnamed-toggle': '', ...u, onclick: () => { ui.unnamedOpen = !ui.unnamedOpen; draw() } }, [`${ui.unnamedOpen ? '▾' : '▸'} ${T.unnamed(unnamed.length)}`]),
        el('p', { class: 'meta' }, [T.unnamedHint]),
        ...(ui.unnamedOpen ? [
          ...unnamed.slice(0, ui.unnamedLimit).map((x) => rowView(x, picked)),
          unnamed.length > ui.unnamedLimit ? el('button', { class: 'btn btn-ghost', 'data-cur-unnamed-more': '', onclick: () => { ui.unnamedLimit += PAGE; draw() } }, [T.more(Math.min(PAGE, unnamed.length - ui.unnamedLimit))]) : null,
        ] : []),
      ]) : null,
    ] : [el('p', { class: 'meta', 'data-svc-empty': '1' }, [S.svcCurateEmpty])]).filter((n): n is HTMLElement => n !== null))
    foot.replaceChildren(...(shownRows.length > 10 ? [el('button', { class: 'btn btn-ghost', 'data-cur-scroll-top': '', ...u, onclick: () => (list.closest('.page-layer') ?? top.closest('.page-layer'))?.scrollTo({ top: 0, behavior: 'smooth' }) }, [`↑ ${T.top}`])] : []))
  }

  /** The dedupe entry: its count is worked out when the page opens, not on every redraw. */
  function bulkDupes(all: readonly Pending[]): HTMLElement | null {
    const flagged = all.filter((x) => x.proposal.flags.includes('possible-duplicate') && !isUnnamed(x.row)).length
    return flagged ? el('button', { class: 'btn btn-ghost btn-sm', 'data-cur-dupes': String(flagged), ...u, onclick: () => dedupePage(h, draw) }, [T.dupes(flagged)]) : null
  }

  /** "By tag to ring": every pending row with the tag gets the ring (before Accept). */
  function byTagPanel(all: readonly Pending[], tags: { label: string; count: number }[]): HTMLElement {
    const pick = el('select', { class: 'field', 'data-cur-bytag': '', 'aria-label': T.byTagRing }, [el('option', { value: '' }, ['']), ...tags.map((t) => el('option', { value: t.label, ...(t.label === ui.byTag ? { selected: '' } : {}) }, [`${t.label} (${t.count})`]))]) as HTMLSelectElement
    const ring = ringSelect(ui.byTagRing, { 'data-cur-bytag-ring': '' }, T.setRing)
    return el('details', { class: 'meta', 'data-cur-bytag-bar': '' }, [
      el('summary', { style: 'text-decoration:underline;cursor:pointer;display:inline' }, [T.byTagRing]),
      el('div', { class: 'cur-bar' }, [
        pick, ring,
        el('button', { class: 'btn btn-ghost btn-sm', 'data-cur-bytag-apply': '', onclick: () => { if (!pick.value) return; ui.byTag = pick.value; ui.byTagRing = ring.value as Ring; const n = setRingByTag(all, pick.value, ui.byTagRing); h.save(); h.toast(T.applied(n)); draw() } }, [T.apply]),
      ]),
    ])
  }

  /** Steps for the selected rows, all before Accept. */
  function bulkPanel(rows: readonly ServiceRow[], all: readonly Pending[], known: readonly string[]): HTMLElement {
    const union = [...new Set(rows.flatMap(rowTags))]
    const note = el('input', { class: 'field', 'data-cur-bulk-note': '', placeholder: T.notePh, 'aria-label': T.note, value: ui.note }) as HTMLInputElement
    note.addEventListener('input', () => { ui.note = note.value })
    const ring = ringSelect(ui.ring, { 'data-cur-bulk-ring': '' }, T.setRing)
    const after = (n: number): void => { h.save(); h.toast(T.applied(n)); draw() }
    return el('section', { class: 'cur-bulk-panel', 'data-cur-bulk-panel': String(rows.length) }, [
      el('b', {}, [`${T.bulkTitle}: ${T.selected(rows.length)}`]),
      tagBox({ title: T.addTags, known, selected: union, attr: 'bulk', onAdd: (l) => after(bulkAddLabels(rows, [l])), onRemove: (l) => after(bulkRemoveLabels(rows, [l])) }),
      connectBox(h, { chips: [...new Set(rows.flatMap((r) => r.connected ?? []))], attr: 'bulk', onAdd: (c) => after(bulkConnect(rows, [c])), onRemove: (c) => after(bulkUnconnect(rows, [c])) }),
      el('div', { class: 'cur-bar' }, [ring, el('button', { class: 'btn btn-ghost btn-sm', 'data-cur-bulk-ring-set': '', onclick: () => after(bulkSetRing(rows, ring.value as Ring)) }, [T.setRing])]),
      el('div', { class: 'cur-bar' }, [note, el('button', { class: 'btn btn-ghost btn-sm', 'data-cur-bulk-note-add': '', onclick: () => { const n = bulkAppendNote(rows, note.value); ui.note = ''; after(n) } }, [T.noteAdd])]),
      el('button', { class: 'btn btn-electric', 'data-cur-accept-selected': '', onclick: () => {
        const keys = new Set(ui.sel)
        const n = acceptRows(h.state(), keys, Date.now(), () => randomId(8), ensureTags(h, all.filter((x) => keys.has(x.row.key))))
        ui.sel.clear(); accepted(n); draw()
      } }, [T.acceptSelected(rows.length)]),
    ])
  }

  function rowView(x: Pending, pickTag: (label: string) => void): HTMLElement {
    const { batchId, row, proposal: p } = x
    const act = (choice: Parameters<typeof decide>[3]): void => {
      if (h.actions) {
        if (choice.do === 'change') h.actions.do('row-set-ring', { row: row.key, ring: choice.ring })
        h.actions.do(choice.do === 'leave' ? 'leave-row' : 'accept-row', { row: row.key })
      } else decide(h.state(), batchId, row.key, choice, Date.now(), () => randomId(8), ensureTags(h, [x]))
      h.save()
      if (choice.do !== 'leave') { h.changed(); h.toast(S.svcAccepted(row.name)) }
      draw()
    }
    const ring = ringSelect(row.ring ?? p.ring, { 'data-svc-ring': row.key })
    const history = hasHistory(row)
    const tags = rowTags(row)
    return el('div', { class: 'conn-row cur-row', style: 'flex-direction:column;align-items:stretch;gap:6px', 'data-svc-row': row.key }, [
      el('label', { class: 'cur-name' }, [el('input', { type: 'checkbox', 'data-cur-check': row.key, ...(ui.sel.has(row.key) ? { checked: '' } : {}), 'aria-label': row.name, onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) ui.sel.add(row.key); else ui.sel.delete(row.key); draw() } }), el('b', {}, [row.name])]),
      rowContact(row),
      row.ai ? el('span', { class: 'chip cur-ai', 'data-cur-ai-chip': '' }, [S.obsidian.aiChip]) : null,
      obsidianLink(h.state(), row.obsidianNote ?? (row.ai ? row.file : undefined)),
      tags.length ? el('div', { class: 'chips cur-pills', 'data-cur-pills': '' }, tags.map((l) => el('button', { class: 'chip cur-pill' + (l === ui.tag ? ' on' : ''), 'data-cur-pill': l, ...u, onclick: () => pickTag(l) }, [`#${l}`]))) : null,
      el('span', { class: 'meta' }, history ? [`${S.ringLabel[row.ring ?? p.ring]} · ${S.svcScore(p.score)} · `, el('i', {}, [S.svcInferred])] : [`${S.ringLabel[row.ring ?? p.ring]} · `, el('i', { 'data-cur-nohistory': '' }, [T.noHistory])]),
      ...(history ? [el('details', { class: 'meta' }, [
        el('summary', { style: 'text-decoration:underline;cursor:pointer;display:inline' }, [S.svcInfoMark]),
        el('p', { class: 'meta' }, [S.svcTerms(p.terms.freq, p.terms.recency, p.terms.reciprocity, p.n365)]),
      ])] : []),
      ...p.flags.map((f) => el('p', { class: 'warn' }, [f === 'one-way' ? S.svcFlagOneWay : S.svcFlagDupe])),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' }, [
        el('button', { class: 'btn btn-electric btn-sm', 'data-svc-accept': row.key, onclick: () => act({ do: 'accept' }) }, [S.svcAccept]),
        ring,
        el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-change': row.key, onclick: () => act({ do: 'change', ring: ring.value as Ring }) }, [S.svcChange]),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-leave': row.key, onclick: () => act({ do: 'leave' }) }, [S.svcLeave]),
      ]),
      advanced(row, p.ring, tagCounts(pendingProposals(h.state(), Date.now())).map((t) => t.label)),
    ].filter((n): n is HTMLElement => n !== null))
  }

  /** Every field of the row (the note is a field too), its tags and what it is connected with. Tags and connections apply at once; the text fields on Save. */
  function advanced(row: ServiceRow, proposed: Ring, known: readonly string[]): HTMLElement {
    const text = (tag: 'input' | 'textarea', attr: string, label: string, value: string, rows?: number): { box: HTMLElement; read: () => string } => {
      const node = el(tag, { class: 'field', 'data-cur-field': attr, ...(tag === 'textarea' ? { rows: String(rows ?? 2) } : { value }), 'aria-label': label }, tag === 'textarea' ? [value] : []) as HTMLInputElement | HTMLTextAreaElement
      return { box: el('label', { class: 'grp-field' }, [el('span', { class: 'chips-lbl' }, [label]), node]), read: () => node.value }
    }
    const name = text('input', 'name', T.name, row.name)
    const emails = text('textarea', 'emails', T.emails, (row.emails ?? []).join('\n'))
    const phones = text('textarea', 'phones', T.phones, (row.phones ?? []).join('\n'))
    const note = text('textarea', 'note', T.noteField, row.note ?? '', 3)
    const start = row.ring ?? proposed
    const ring = ringSelect(start, { 'data-cur-field': 'ring' }, T.ring)
    const lines = (v: string): string[] => v.split(/\r?\n|;/)
    const collect = (): void => editRow(row, { name: name.read(), emails: lines(emails.read()), phones: lines(phones.read()), note: note.read(), ...(ring.value === start ? {} : { ring: ring.value as Ring }) })
    const keep = (fn: () => void): void => { collect(); fn(); h.save(); ui.open.add(row.key); draw() }
    return el('details', { class: 'meta cur-adv', 'data-cur-advanced': row.key, ...(ui.open.has(row.key) ? { open: '' } : {}), ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) ui.open.add(row.key); else ui.open.delete(row.key) } }, [
      el('summary', { style: 'text-decoration:underline;cursor:pointer;display:inline' }, [T.notes]),
      name.box, emails.box, phones.box,
      tagBox({ title: T.tags, known, selected: rowTags(row), attr: row.key, onAdd: (l) => keep(() => (h.actions ? h.actions.do('row-add-tag', { row: row.key, tag: l }) : bulkAddLabels([row], [l]))), onRemove: (l) => keep(() => bulkRemoveLabels([row], [l])) }),
      el('label', { class: 'grp-field' }, [el('span', { class: 'chips-lbl' }, [T.ring]), ring]),
      note.box,
      connectBox(h, { chips: row.connected ?? [], attr: row.key, onAdd: (c) => keep(() => editRow(row, { connected: [...(row.connected ?? []), c] })), onRemove: (c) => keep(() => editRow(row, { connected: (row.connected ?? []).filter((x) => x !== c) })) }),
      el('div', { class: 'cur-bar' }, [
        el('button', { class: 'btn btn-electric btn-sm', 'data-cur-save': row.key, onclick: () => { collect(); h.save(); h.toast(T.saved); ui.open.add(row.key); draw() } }, [T.saveRow]),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-cur-ai': row.key, title: T.aiHint, ...u, onclick: () => h.openAi?.(row) }, [T.aiMore]),
      ]),
    ])
  }

  draw()
  h.pages.open(S.svcCuratePage, [top, bulk, list, foot], 'import-curate')
  // Wave 40: a change the assistant makes (or undoes) shows here at once; the page stops listening once it is closed.
  const off = h.actions?.onChange(() => { if (list.isConnected) draw(); else off?.() })
}

/** One side of a pair: what the owner needs to tell two people apart. */
function side(title: string, name: string, row: ServiceRow | undefined, extra: string[]): HTMLElement {
  return el('div', { class: 'cur-side' }, [
    el('small', { class: 'meta' }, [title]),
    el('b', {}, [name]),
    row ? rowContact(row) : el('span', { class: 'meta cur-contact' }, [extra[0] || T.noContact]),
    el('span', { class: 'meta' }, [(row ? rowTags(row) : []).map((l) => `#${l}`).join(' ') || '']),
  ])
}

/** The dedupe page (like Google's Merge & fix): candidate pairs side by side; Merge folds them, Keep both clears the flag. `after` redraws the Curate page below. */
export function dedupePage(h: CurateHooks, after: () => void): void {
  const list = el('div', { 'data-cur-dupe-list': '' })
  let shownCount = 30
  const draw = (): void => {
    const pairs = dupePairs(h.state(), pendingProposals(h.state(), Date.now()))
    const act = (pair: DupePair, how: 'merge' | 'keep'): void => {
      if (how === 'merge') {
        const tagOf = ensureTags(h, [{ batchId: pair.a.batchId, row: pair.a.row }])
        mergePair(h.state(), pair, Date.now(), () => randomId(8), tagOf)
        h.save()
        if (pair.b.person) h.changed()
      } else { keepBoth(h.state(), pair); h.save() }
      draw(); after()
    }
    list.replaceChildren(
      el('p', { class: 'cur-head' }, [alphaSub()]),
      el('p', { class: 'meta' }, [T.dupesLead]),
      ...(pairs.length ? [
        ...pairs.slice(0, shownCount).map((pair) => el('div', { class: 'conn-row cur-pair', style: 'flex-direction:column;align-items:stretch;gap:6px', 'data-cur-pair': pair.a.row.key }, [
          el('div', { class: 'cur-sides' }, [
            side(T.sideThis, pair.a.row.name, pair.a.row, []),
            pair.b.person
              ? side(T.sideHave, pair.b.person.name, undefined, [S.imp39.contactLine(contactOf(pair.b.person).email, contactOf(pair.b.person).phone)])
              : side(T.sideAlso, pair.b.row!.name, pair.b.row, []),
          ]),
          el('div', { class: 'cur-bar' }, [
            el('button', { class: 'btn btn-electric btn-sm', 'data-cur-merge': pair.a.row.key, onclick: () => act(pair, 'merge') }, [T.merge]),
            el('button', { class: 'btn btn-ghost btn-sm', 'data-cur-keep-both': pair.a.row.key, onclick: () => act(pair, 'keep') }, [T.keepBoth]),
          ]),
        ])),
        pairs.length > shownCount ? el('button', { class: 'btn btn-ghost', onclick: () => { shownCount += 30; draw() } }, [T.more(Math.min(30, pairs.length - shownCount))]) : el('span'),
      ] : [el('p', { class: 'meta', 'data-cur-dupes-none': '' }, [T.dupesNone])]),
    )
  }
  draw()
  h.pages.open(T.dupesTitle, [list], 'import-dupes')
}
