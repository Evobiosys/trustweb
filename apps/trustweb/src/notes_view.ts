// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 (shared-notes): the Notes view of the eye menu, an outliner over every note of every person. DOM only; the tree and its edits are notes_outline.ts. */
import { el } from '../../demo/src/ui/dom'
import type { Person } from './model'
import { addSibling, canAnnotate, editBlock, indentBlock, outdentBlock, outlineRows, pruneEmpty, rowNeighbour, type NoteBy, type OutlineRow, type SharedNote } from './notes_outline'
import { S } from './strings'

export interface NotesViewHooks { people: () => Person[]; me: NoteBy; save: () => void }

/** Tab / Shift-Tab indent, Enter a new sibling, arrows move between rows (Left folds, Right unfolds); the grey end of a line says where it came from. */
export function notesOutlineView(h: NotesViewHooks): HTMLElement {
  const root = el('div', { class: 'notes-outline', 'data-notes-view': '' })
  const collapsed = new Set<string>()
  let redrawing = false
  const noteOf = (r: OutlineRow): { p: Person; n: SharedNote } | null => {
    const p = h.people().find((x) => x.id === r.personId)
    const n = p?.sharedNotes?.find((x) => x.id === r.noteId)
    return p && n ? { p, n } : null
  }
  const focus = (key: string): void => root.querySelector<HTMLElement>(`[data-outline-row="${CSS.escape(key)}"]`)?.focus()
  const change = (r: OutlineRow, fn: (n: SharedNote) => SharedNote, focusKey = r.key): void => {
    const hit = noteOf(r)
    if (!hit) return
    hit.p.sharedNotes = hit.p.sharedNotes?.map((x) => (x.id === hit.n.id ? fn(x) : x))
    h.save()
    draw()
    focus(focusKey)
  }
  const commit = (r: OutlineRow, text: string): void => {
    const hit = noteOf(r)
    const b = hit && r.blockId ? text.trim() : ''
    if (!hit || !b || b === r.text) return
    try { hit.p.sharedNotes = hit.p.sharedNotes?.map((x) => (x.id === hit.n.id ? editBlock(x, r.blockId ?? '', b, h.me) : x)); h.save() } catch { /* not theirs to change */ }
  }
  const key = (r: OutlineRow, e: KeyboardEvent, rows: OutlineRow[]): void => {
    const field = e.target instanceof HTMLInputElement ? e.target : null
    const id = r.blockId ?? ''
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focus(rowNeighbour(rows, r.key, e.key === 'ArrowDown' ? 1 : -1)); return }
    if (e.key === 'ArrowLeft' && r.hasKids && r.open && (!field || field.selectionStart === 0)) { collapsed.add(r.key); e.preventDefault(); draw(); focus(r.key); return }
    if (e.key === 'ArrowRight' && r.hasKids && !r.open) { collapsed.delete(r.key); e.preventDefault(); draw(); focus(r.key); return }
    if (e.key === 'Enter' && !field) { e.preventDefault(); if (collapsed.has(r.key)) collapsed.delete(r.key); else collapsed.add(r.key); draw(); focus(r.key); return }
    if (r.kind !== 'block') return
    if (e.key === 'Tab') {
      e.preventDefault()
      commit(r, field?.value ?? '')
      change(r, (n) => ({ ...n, blocks: (e.shiftKey ? outdentBlock : indentBlock)(n.blocks, id, h.me) }))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(r, field?.value ?? '')
      const fresh = { id: '' }
      change(r, (n) => {
        if (!canAnnotate(n, h.me)) return n
        const out = addSibling(n.blocks, id, h.me, Date.now(), n.origin.by.did !== h.me.did)
        fresh.id = out.id
        return { ...n, blocks: out.blocks }
      }, r.key)
      if (fresh.id) focus(`b:${r.personId}/${r.noteId}/${fresh.id}`)
    }
  }
  const rowEl = (r: OutlineRow, rows: OutlineRow[]): HTMLElement => {
    const toggle = r.hasKids
      ? el('button', { class: 'outline-toggle', 'aria-label': r.text, 'aria-expanded': String(r.open), 'data-outline-toggle': r.key, tabindex: '-1', onclick: () => { if (r.open) collapsed.add(r.key); else collapsed.delete(r.key); draw() } }, [r.open ? '▾' : '▸'])
      : el('span', { class: 'outline-toggle' }, ['•'])
    const attrs = { 'data-outline-row': r.key, onkeydown: (e: Event) => key(r, e as KeyboardEvent, rows) }
    const text = r.kind === 'block'
      ? el('input', {
        class: 'field outline-text', value: r.text, maxlength: '500', 'aria-label': S.noteEdit, ...attrs,
        ...(r.mine ? {} : { readonly: '' }),
        onblur: (e: Event) => {
          const v = (e.target as HTMLInputElement).value
          if (redrawing) return
          if (!v.trim()) { change(r, (n) => ({ ...n, blocks: pruneEmpty(n.blocks) }), r.key); return }
          commit(r, v)
        },
      })
      : el('button', { class: 'outline-text outline-' + r.kind, ...attrs }, [r.text])
    return el('div', { class: 'outline-row', role: 'treeitem', 'aria-level': String(r.depth + 1), style: `padding-left:${r.depth * 16}px` }, [
      toggle, text, r.meta ? el('span', { class: 'meta outline-meta' }, [r.meta]) : null,
    ])
  }
  function draw(): void {
    redrawing = true
    const rows = outlineRows(h.people(), h.me, collapsed)
    root.replaceChildren(...(rows.length ? rows.map((r) => rowEl(r, rows)) : [el('p', { class: 'meta', 'data-notes-empty': '' }, [S.notesViewEmpty])]))
    redrawing = false
  }
  draw()
  return root
}
