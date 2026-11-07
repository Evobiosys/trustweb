// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (shared-notes): the Notes section of a person card: new / pasted notes, blocks edited in place, notes under a block, Share, Pass on, Export. DOM only; rules in notes_outline.ts. */
import { el } from '../../demo/src/ui/dom'
import { chipInput } from './chip_input'
import type { Person } from './model'
import { annotate, canAnnotate, editBlock, forward, newNote, noteShareLink, provenanceLine, serializeOutline, type NoteBlock, type NoteBy, type NotePerm, type SharedNote } from './notes_outline'
import { suggest, type Candidate } from './share_page'
import { S } from './strings'

export interface SharedNotesHooks {
  me: NoteBy
  /** People (`person:<id>`) and tags (`tag:<id>`) the Share picker offers: the Web filter's candidates. */
  candidates: Candidate[]
  /** My connect link (no note in it yet). */
  connectLink: () => Promise<string>
  save: () => void
  toast: (msg: string) => void
}

/** Receiving side: keep the note a link carried on the sender's card; the same note id replaces the older copy. */
export function addReceivedNote(p: Person, note: SharedNote): void {
  p.sharedNotes = [...(p.sharedNotes ?? []).filter((n) => n.id !== note.id), note]
}

const when = (at: number): string => (new Date(at).toDateString() === new Date().toDateString() ? S.noteToday : new Date(at).toLocaleDateString())
const author = (b: NoteBlock, me: NoteBy): string => `${b.by.did === me.did ? S.noteYou : b.by.name}, ${when(b.at)}`

async function send(url: string, h: SharedNotesHooks): Promise<void> {
  if (typeof navigator.share === 'function') await navigator.share({ text: url }).catch(() => undefined)
  else await navigator.clipboard.writeText(url).then(() => h.toast(S.meetCopied))
}

/** The whole Notes section for one card; it redraws only itself. */
export function sharedNotesSection(p: Person, h: SharedNotesHooks): HTMLElement {
  const root = el('div', { class: 'shared-notes', 'data-notes-section': p.id })
  let form: 'new' | 'import' | null = null
  let openBlock = ''
  let sharing = ''
  const audience = new Map<string, string[]>()
  const notes = (): SharedNote[] => p.sharedNotes ?? []
  const change = (id: string, fn: (n: SharedNote) => SharedNote): void => {
    p.sharedNotes = notes().map((n) => (n.id === id ? fn(n) : n))
    h.save()
    draw()
  }

  const newForm = (): HTMLElement => {
    const title = el('input', { class: 'field', maxlength: '120', placeholder: S.noteTitlePh, 'aria-label': S.noteTitlePh, 'data-note-title': '' }) as HTMLInputElement
    const text = el('textarea', { class: 'field', rows: '6', placeholder: S.noteTextPh, 'aria-label': S.noteTextPh, 'data-note-text': '' }) as HTMLTextAreaElement
    return el('div', { class: 'note-form' }, [
      title, text,
      el('button', { class: 'btn btn-electric btn-sm', 'data-note-save': '', onclick: () => {
        const n = newNote({ title: title.value || S.noteUntitled, text: text.value, by: h.me, at: Date.now() })
        if (!n.blocks.length) return
        p.sharedNotes = [...notes(), n]
        form = null
        h.save()
        draw()
      } }, [S.noteSave]),
    ])
  }

  const blockRow = (n: SharedNote, b: NoteBlock): HTMLElement => {
    const mine = b.by.did === h.me.did
    const open = openBlock === `${n.id}/${b.id}`
    const edit = el('input', { class: 'field', maxlength: '500', value: b.text, 'aria-label': S.noteEdit, 'data-note-edit-input': b.id }) as HTMLInputElement
    const add = el('input', { class: 'field', maxlength: '500', placeholder: S.noteAddHere, 'aria-label': S.noteAddHere, 'data-note-input': b.id }) as HTMLInputElement
    const panel = open
      ? el('div', { class: 'note-edit' }, [
          mine ? el('div', {}, [edit, el('button', { class: 'btn btn-ghost btn-sm', 'data-note-edit-save': b.id, onclick: () => {
            if (!edit.value.trim()) return
            openBlock = ''
            change(n.id, (x) => editBlock(x, b.id, edit.value, h.me))
          } }, [S.noteSaveChange])]) : null,
          canAnnotate(n, h.me) ? el('div', {}, [add, el('button', { class: 'btn btn-electric btn-sm', 'data-note-annotate': b.id, onclick: () => {
            if (!add.value.trim()) return
            openBlock = ''
            change(n.id, (x) => annotate(x, b.id, add.value, h.me, Date.now()))
          } }, [S.noteAddHere])]) : null,
        ])
      : null
    return el('li', { class: b.annotation ? 'note-block note-annotation' : 'note-block', 'data-note-block': b.id }, [
      el('button', { class: 'note-text', 'data-note-tap': b.id, onclick: () => { openBlock = openBlock === `${n.id}/${b.id}` ? '' : `${n.id}/${b.id}`; draw() } }, [b.text]),
      b.annotation || b.by.did !== n.origin.by.did ? el('span', { class: 'meta note-by' }, [` ${author(b, h.me)}`]) : null,
      panel,
      b.children.length ? el('ul', {}, b.children.map((c) => blockRow(n, c))) : null,
    ])
  }

  const shareBox = (n: SharedNote): HTMLElement => {
    const chosen = audience.get(n.id) ?? []
    const label = (id: string): string => (id.startsWith('person:') ? '@' : '#') + (h.candidates.find((c) => c.id === id)?.label ?? id)
    const set = (ids: string[]): void => { audience.set(n.id, ids); draw(); setTimeout(() => root.querySelector<HTMLInputElement>('[data-note-audience-input]')?.focus(), 0) }
    const { input, hits } = chipInput({
      placeholder: S.shareChipPh, aria: S.notePassTo, attrs: { 'data-note-audience-input': n.id },
      hits: (text) => suggest(text, h.candidates, chosen).map((c) => ({ label: label(c.id), attrs: { 'data-note-audience-suggest': c.id }, pick: () => set([...chosen, c.id]) })),
    })
    const perm = el('select', { class: 'field', 'aria-label': S.notePerm, 'data-note-perm': n.id }, [
      el('option', { value: 'read' }, [S.notePermRead]), el('option', { value: 'annotate' }, [S.notePermAnnotate]),
    ]) as HTMLSelectElement
    return el('div', { class: 'note-share' }, [
      el('div', { class: 'chips', 'data-note-audience': n.id }, chosen.map((id) => el('button', {
        class: 'chip on', 'data-note-audience-chip': id, 'aria-label': S.shareChipRemove(label(id)), onclick: () => set(chosen.filter((x) => x !== id)),
      }, [label(id) + ' ×']))),
      input, hits, perm,
      el('button', { class: 'btn btn-electric btn-sm', 'data-note-link': n.id, onclick: () => {
        const to = chosen.length ? chosen.map(label).join(', ') : p.name
        void h.connectLink().then((base) => send(noteShareLink(base, forward(n, to, h.me, Date.now(), perm.value as NotePerm)), h))
      } }, [S.noteMakeLink]),
    ])
  }

  const noteView = (n: SharedNote): HTMLElement => el('div', { class: 'note', 'data-note': n.id }, [
    el('b', {}, [n.title]),
    el('p', { class: 'meta', 'data-note-provenance': n.id }, [provenanceLine(n, h.me)]),
    el('ul', { class: 'note-blocks' }, n.blocks.map((b) => blockRow(n, b))),
    el('div', { class: 'note-actions' }, [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-note-share': n.id, onclick: () => { sharing = sharing === n.id ? '' : n.id; draw() } }, [S.noteShare]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-note-export': n.id, onclick: () => void navigator.clipboard.writeText(serializeOutline(n.blocks)).then(() => h.toast(S.noteExported)) }, [S.noteExport]),
    ]),
    sharing === n.id ? shareBox(n) : null,
  ])

  function draw(): void {
    root.replaceChildren(
      el('b', {}, [S.notesTitle]),
      ...notes().map(noteView),
      el('div', { class: 'note-actions' }, [
        el('button', { class: 'btn btn-ghost btn-sm', 'data-note-new': '', onclick: () => { form = form === 'new' ? null : 'new'; draw() } }, [S.noteNew]),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-note-import': '', onclick: () => { form = form === 'import' ? null : 'import'; draw() } }, [S.noteImport]),
      ]),
      ...(form ? [newForm()] : []),
    )
  }
  draw()
  return root
}
