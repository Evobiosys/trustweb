/**
 * Settings > Inventory: "Import inventory file" and "Undo import" on screen
 * (wave 1733 round B, amendment A4). The rules are in inventory_import.ts:
 * a summary first, nothing written before the yes, nothing sent anywhere.
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import { applyImport, IMPORT_MAX_BYTES, IMPORT_MAX_ITEMS, ImportProblem, lastImport, parseImportFile, planImport, undoImport } from './inventory_import'
import { markBatchReviewed, provenanceState } from './provenance'
import { ProvenanceState } from './model'
import type { ImportPlan } from './inventory_import'
import type { AppState } from './model'
import { S } from './strings'

export interface ImportViewHooks {
  state: () => AppState
  save: () => void
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  /** After an import or an undo: the screens that list the inventory redraw. */
  changed: () => void
  /** Back to Settings (where the import lives). */
  settings: () => void
}

function problemText(p: ImportProblem): string {
  switch (p) {
    case ImportProblem.NotJson: return S.impNotJson
    case ImportProblem.WrongFormat: return S.impWrongFormat
    case ImportProblem.WrongVersion: return S.impWrongVersion
    case ImportProblem.TooBig: return S.impTooBig
    case ImportProblem.Empty: return S.impEmpty
  }
}

/** The Settings group: the import button (a file picker), and the last import with its undo. */
export function importGroup(h: ImportViewHooks): HTMLElement[] {
  const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-import-file': '1' }) as HTMLInputElement
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (file.size > IMPORT_MAX_BYTES) { h.toast(S.impTooBig); return }
    void file.text().then((raw) => summary(h, raw), () => h.toast(S.impNotJson))
  })
  const last = lastImport(h.state())
  const nodes: (HTMLElement | null)[] = [
    el('h4', { class: 'eyebrow' }, [S.impGroup]),
    input,
    el('button', { class: 'btn btn-ghost', 'data-import-open': '1', onclick: () => input.click() }, [S.impButton]),
    el('p', { class: 'meta' }, [S.impHint]),
    last ? el('div', { class: 'conn-row', 'data-import-last': last.id }, [
      el('span', {}, [S.impLast(new Date(last.at).toLocaleDateString(), last.items.length)]),
      unreviewedIn(h, last.id) ? el('button', { class: 'btn btn-ghost btn-sm', 'data-import-reviewed': last.id, onclick: () => reviewAll(h, last.id) }, [S.impReviewAll]) : null,
      el('button', { class: 'btn btn-ghost btn-sm', 'data-import-undo': last.id, onclick: () => undo(h, last.id) }, [S.impUndo]),
    ]) : null,
  ]
  return nodes.filter((n): n is HTMLElement => n !== null)
}

/** The summary before anything is written. */
function summary(h: ImportViewHooks, raw: string): void {
  const parsed = parseImportFile(raw)
  if (typeof parsed === 'string') {
    h.openSheet([el('h3', {}, [S.impTitle]), el('p', { class: 'warn', 'data-import-problem': parsed }, [problemText(parsed)]), el('button', { class: 'btn btn-ghost', onclick: h.settings }, [S.close])])
    return
  }
  const plan = planImport(h.state(), parsed)
  h.openSheet([
    el('h3', {}, [S.impTitle]),
    el('p', { class: 'meta', 'data-import-summary': `${plan.add.length}/${plan.already}` }, [S.impSummary(plan.add.length, plan.already, plan.exportedOn)]),
    plan.unreadable ? el('p', { class: 'meta' }, [S.impUnreadable(plan.unreadable)]) : null,
    plan.leftOut ? el('p', { class: 'warn', 'data-import-left-out': String(plan.leftOut) }, [S.impLeftOut(plan.leftOut, IMPORT_MAX_ITEMS)]) : null,
    plan.allowedInAdvance ? el('p', { class: 'meta' }, [S.impAllowed(plan.allowedInAdvance)]) : null,
    el('p', { class: 'meta' }, [S.impHow]),
    plan.add.length
      ? el('button', { class: 'btn btn-electric', 'data-import-apply': '1', onclick: () => apply(h, plan) }, [S.impAdd(plan.add.length)])
      : null,
    el('button', { class: 'btn btn-ghost', onclick: h.settings }, [plan.add.length ? S.impCancel : S.close]),
  ])
}

function apply(h: ImportViewHooks, plan: ImportPlan): void {
  applyImport(h.state(), plan, Date.now(), () => randomId(8))
  h.save()
  h.closeSheet()
  h.changed()
  h.toast(S.impDone(plan.add.length, plan.already))
}

/** How many of an import's lines still say "unreviewed". */
function unreviewedIn(h: ImportViewHooks, batchId: string): number {
  const s = h.state()
  const ids = new Set((s.imports ?? []).find((b) => b?.id === batchId)?.items.map((x) => x.itemId) ?? [])
  return s.inventory.filter((i) => ids.has(i.id) && provenanceState(i.source) === ProvenanceState.Unreviewed).length
}

/** "Mark all reviewed" (wave 2, B4): the whole import kept as the person's own. Undo import still removes the unchanged lines. */
function reviewAll(h: ImportViewHooks, batchId: string): void {
  const n = markBatchReviewed(h.state(), batchId, Date.now())
  h.save()
  h.changed()
  h.toast(S.impReviewedAll(n))
  h.settings()
}

function undo(h: ImportViewHooks, batchId: string): void {
  if (!confirm(S.impUndoConfirm)) return
  const r = undoImport(h.state(), batchId)
  h.save()
  h.changed()
  h.toast(S.impUndone(r.removed, r.kept))
  h.settings()
}
