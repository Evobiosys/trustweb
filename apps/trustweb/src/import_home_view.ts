// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 (import-curate): the one Import page. Three kinds apart: Contacts (several export files at once), the Resources file
 * (trustweb-inventory-import.json) and Tana; then the earlier imports with Undo (several at once, also after review). Every kind reports
 * its result in a box at the top of THIS page, so the dialog stays inside the overlay the owner is looking at. DOM only; the rules are in
 * services_import.ts, import_curate.ts and inventory_import.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import { curatorHiddenIds } from './curator'
import { curatePage } from './import_curate_view'
import { previewUndo, undoBatches } from './import_curate'
import { applyImport, editedItems, IMPORT_MAX_BYTES, IMPORT_MAX_ITEMS, ImportProblem, parseImportFile, planImport, undoImport } from './inventory_import'
import type { ImportPlan } from './inventory_import'
import { Provenance, ProvenanceState } from './model'
import { markBatchReviewed, provenanceState } from './provenance'
import { pendingProposals } from './services_import'
import { refreshServices, servicesGroup } from './services_view'
import type { ServicesHooks } from './services_view'
import { setSourceHidden, sourceCount, sourceHidden } from './sources'
import { S } from './strings'
import { unsortedCount } from './unsorted_count'

const T = S.imp39
const u = { style: 'text-decoration:underline;cursor:pointer' }
const some = <N>(xs: readonly (N | null)[]): N[] => xs.filter((x): x is N => x !== null)

function problemText(p: ImportProblem): string {
  switch (p) {
    case ImportProblem.NotJson: return S.impNotJson
    case ImportProblem.WrongFormat: return S.impWrongFormat
    case ImportProblem.WrongVersion: return S.impWrongVersion
    case ImportProblem.TooBig: return S.impTooBig
    case ImportProblem.Empty: return S.impEmpty
  }
}

/** The Import page. Opens above Settings as a page with Back; its state lives for as long as the page. */
export function openImportHome(base: ServicesHooks): void {
  let doneText = ''
  let review: (() => void) | undefined
  let pending: { plan: ImportPlan } | { problem: ImportProblem } | null = null
  const checked = new Set<string>()
  let alsoEdits = false
  const doneBox = el('div', { 'data-import-done': '' })
  const root = el('div', { 'data-import-home': '' })

  const h: ServicesHooks = { ...base, done: (text, run) => { doneText = text; review = run; draw() } }
  const announce = (text: string): void => { h.toast(text); h.done?.(text) }

  function doneView(): HTMLElement | null {
    if (!doneText) return null
    return el('div', { class: 'conn-row cur-done', role: 'status', 'data-import-done-text': '' }, [
      el('div', { style: 'flex:1' }, [el('b', {}, [T.doneTitle]), el('p', { class: 'meta' }, [doneText])]),
      review ? el('button', { class: 'btn btn-electric btn-sm', 'data-import-done-review': '', onclick: () => review?.() }, [T.doneReview]) : null,
      el('button', { class: 'btn btn-ghost btn-sm', 'data-import-done-ok': '', onclick: () => { doneText = ''; review = undefined; draw() } }, [T.doneOk]),
    ])
  }

  // ---- Resources file ----
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-import-file': '1' }) as HTMLInputElement
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    if (f.size > IMPORT_MAX_BYTES) { pending = { problem: ImportProblem.TooBig }; draw(); return }
    void f.text().then((raw) => {
      const parsed = parseImportFile(raw)
      pending = typeof parsed === 'string' ? { problem: parsed } : { plan: planImport(h.state(), parsed) }
      draw()
    }, () => { pending = { problem: ImportProblem.NotJson }; draw() })
  })
  function resources(): HTMLElement[] {
    const p = pending
    return some([
      el('h4', { class: 'eyebrow' }, [T.resourcesTitle]), file,
      el('button', { class: 'btn btn-ghost', 'data-import-open': '1', onclick: () => file.click() }, [S.impButton]),
      el('p', { class: 'meta' }, [S.impHint]),
      p && 'problem' in p ? el('p', { class: 'warn', 'data-import-problem': p.problem }, [problemText(p.problem)]) : null,
      p && 'plan' in p ? el('div', { 'data-import-plan': '' }, some([
        el('p', { class: 'meta', 'data-import-summary': `${p.plan.add.length}/${p.plan.already}` }, [S.impSummary(p.plan.add.length, p.plan.already, p.plan.exportedOn)]),
        p.plan.unreadable ? el('p', { class: 'meta' }, [S.impUnreadable(p.plan.unreadable)]) : null,
        p.plan.leftOut ? el('p', { class: 'warn' }, [S.impLeftOut(p.plan.leftOut, IMPORT_MAX_ITEMS)]) : null,
        p.plan.allowedInAdvance ? el('p', { class: 'meta' }, [S.impAllowed(p.plan.allowedInAdvance)]) : null,
        el('p', { class: 'meta' }, [S.impHow]),
        p.plan.add.length ? el('button', { class: 'btn btn-electric', 'data-import-apply': '1', onclick: () => {
          applyImport(h.state(), p.plan, Date.now(), () => randomId(8))
          h.save(); h.changed(); pending = null
          announce(S.imp39.doneResources(p.plan.add.length, p.plan.already))
        } }, [S.impAdd(p.plan.add.length)]) : null,
        el('button', { class: 'btn btn-ghost', 'data-import-cancel': '', onclick: () => { pending = null; draw() } }, [p.plan.add.length ? S.impCancel : S.close]),
      ])) : null,
    ])
  }

  // ---- Tana ----
  function tana(): HTMLElement[] {
    const s = h.state()
    const n = sourceCount(s, Provenance.Tana)
    const c = unsortedCount(s, curatorHiddenIds())
    const left = Object.entries(c.tanaLeftOut).filter(([, k]) => k > 0)
    return some([
      el('h4', { class: 'eyebrow' }, [T.tanaTitle]),
      el('p', { class: 'meta' }, [T.tanaLead]),
      n.people || n.lines ? el('p', { class: 'meta', 'data-import-tana': `${c.tana}/${c.tanaUnsorted}` }, [T.tanaCount(c.tana, c.tanaUnsorted)]) : null,
      ...left.map(([why, k]) => el('p', { class: 'warn', 'data-import-tana-left': why }, [T.tanaLeftOut(k, T.tanaWhy[why])])),
      sourceHidden(s, Provenance.Tana) ? el('button', { class: 'btn btn-ghost btn-sm', 'data-import-tana-show': '', ...u, onclick: () => { setSourceHidden(s, Provenance.Tana, false); h.save(); h.changed(); draw() } }, [T.tanaShow]) : null,
      c.tanaUnsorted ? el('p', { class: 'meta' }, [T.tanaCap]) : null,
    ])
  }

  // ---- Earlier imports (contacts and resources), Undo several ----
  function earlier(): HTMLElement[] {
    const s = h.state()
    const contacts = s.serviceImports ?? []
    const resourceBatches = Array.isArray(s.imports) ? s.imports.filter((b) => b && typeof b.id === 'string') : []
    if (!contacts.length && !resourceBatches.length) return [el('h4', { class: 'eyebrow' }, [T.listTitle]), el('p', { class: 'meta', 'data-import-list-none': '' }, [T.listNone])]
    const unreviewed = (batchId: string): number => {
      const ids = new Set(resourceBatches.find((b) => b.id === batchId)?.items.map((x) => x.itemId) ?? [])
      return s.inventory.filter((i) => ids.has(i.id) && provenanceState(i.source) === ProvenanceState.Unreviewed).length
    }
    const when = (at: number): string => new Date(at).toLocaleDateString()
    const edits = new Map<string, { personId: string; name: string }[]>()
    for (const b of contacts) edits.set(b.id, previewUndo(s, [b.id]).edited)
    const resEdits = new Map(resourceBatches.map((b) => [b.id, editedItems(s, b.id)]))
    const undoOne = (ids: string[], res: string[]): void => {
      const n = ids.length + res.length
      if (!n || !confirm(T.listConfirm(n))) return
      const r = undoBatches(s, ids, { undoEdits: alsoEdits })
      let removed = 0
      let kept = 0
      for (const id of res) { const x = undoImport(s, id, { undoEdits: alsoEdits }); removed += x.removed; kept += x.kept }
      for (const id of [...ids, ...res]) checked.delete(id)
      h.save(); h.changed()
      announce([ids.length ? S.svcUndone(r.archived, r.restored, r.kept) : '', res.length ? S.impUndone(removed, kept) : ''].filter(Boolean).join(' '))
    }
    const edited = (list: readonly { name: string }[]): HTMLElement | null => list.length ? el('div', { class: 'cur-edited', 'data-import-edited': String(list.length) }, [
      el('p', { class: 'meta' }, [T.listEdited(list.length)]),
      el('p', {}, list.slice(0, 8).map((x) => el('mark', { class: 'cur-edited-name' }, [x.name + ' '])).concat(list.length > 8 ? [el('mark', {}, [`+${list.length - 8}`])] : [])),
    ]) : null
    const pick = (id: string): HTMLElement => el('input', { type: 'checkbox', 'data-import-pick': id, ...(checked.has(id) ? { checked: '' } : {}), 'aria-label': id, onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) checked.add(id); else checked.delete(id); draw() } })
    const rows = [
      ...contacts.map((b) => {
        const note = el('textarea', { class: 'field', rows: '2', 'data-import-note': b.id, 'aria-label': T.listNote }, [b.note ?? '']) as HTMLTextAreaElement
        return el('div', { class: 'conn-row', style: 'flex-direction:column;align-items:stretch;gap:6px', 'data-import-row': b.id }, some([
          el('label', { style: 'display:flex;gap:8px;align-items:center' }, [pick(b.id), el('span', {}, [T.listContacts(when(b.at), b.rows.length, b.tag ?? '')])]),
          edited(edits.get(b.id) ?? []),
          b.note !== undefined || !b.counts.whatsapp ? el('label', { class: 'grp-field' }, [el('span', { class: 'chips-lbl' }, [T.listNote]), note]) : null,
          el('div', { class: 'cur-bar' }, some([
            b.note !== undefined || !b.counts.whatsapp ? el('button', { class: 'btn btn-ghost btn-sm', 'data-import-note-save': b.id, onclick: () => { b.note = note.value.trim(); h.save(); h.toast(T.listNoteSaved) } }, [T.listNoteSave]) : null,
            pendingProposals(s, Date.now()).some((x) => x.batchId === b.id) ? el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-curate': b.id, ...u, onclick: () => curatePage(h) }, [S.svcCurate(pendingProposals(s, Date.now()).filter((x) => x.batchId === b.id).length)]) : null,
            el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-undo': b.id, onclick: () => undoOne([b.id], []) }, [T.listUndo]),
          ])),
        ]))
      }),
      ...resourceBatches.map((b) => el('div', { class: 'conn-row', style: 'flex-direction:column;align-items:stretch;gap:6px', 'data-import-row': b.id }, some([
        el('label', { style: 'display:flex;gap:8px;align-items:center' }, [pick(b.id), el('span', {}, [T.listResources(when(b.at), b.items.length)])]),
        edited((resEdits.get(b.id) ?? []).map((id) => ({ name: s.inventory.find((i) => i.id === id)?.text.slice(0, 40) ?? id }))),
        el('div', { class: 'cur-bar' }, some([
          unreviewed(b.id) ? el('button', { class: 'btn btn-ghost btn-sm', 'data-import-reviewed': b.id, onclick: () => { const n = markBatchReviewed(h.state(), b.id, Date.now()); h.save(); h.changed(); announce(S.impReviewedAll(n)) } }, [S.impReviewAll]) : null,
          el('button', { class: 'btn btn-ghost btn-sm', 'data-import-undo': b.id, onclick: () => undoOne([], [b.id]) }, [T.listUndo]),
        ])),
      ]))),
    ]
    const ids = [...checked].filter((id) => contacts.some((b) => b.id === id))
    const res = [...checked].filter((id) => resourceBatches.some((b) => b.id === id))
    return some([
      el('h4', { class: 'eyebrow' }, [T.listTitle]),
      ...rows,
      el('label', { class: 'meta cur-also' }, [el('input', { type: 'checkbox', 'data-import-also-edits': '', ...(alsoEdits ? { checked: '' } : {}), onchange: (e: Event) => { alsoEdits = (e.target as HTMLInputElement).checked; draw() } }), ' ', T.listAlsoEdits]),
      ids.length + res.length ? el('button', { class: 'btn btn-electric', 'data-import-undo-selected': String(ids.length + res.length), onclick: () => undoOne(ids, res) }, [T.listUndoSelected(ids.length + res.length)]) : null,
    ])
  }

  function draw(): void {
    refreshServices()
    doneBox.replaceChildren(...some([doneView()]))
    root.replaceChildren(
      el('p', { class: 'cur-head' }, [el('sub', { class: 'alpha-label', 'data-alpha': '' }, [S.alphaLabel])]),
      el('p', { class: 'meta' }, [T.lead]),
      doneBox,
      ...contactsSection(),
      ...resources(),
      ...tana(),
      ...earlier(),
    )
  }
  // The Contacts picker keeps its own state in services_view.ts (it survives a redraw of Settings); it redraws itself.
  const contactNodes = servicesGroup(h)
  const contactsSection = (): Node[] => contactNodes
  draw()
  base.pages.open(T.title, [root], 'import-services')
}
