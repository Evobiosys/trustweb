// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Settings > "From other services" and its Curate page (wave 27). The rules are in services_import.ts: a summary before anything is
 * written, nothing in the web before Accept, nothing sent anywhere. DOM only. The Curate page is a page with Back, not an overlay.
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import type { AppState, ServiceRow } from './model'
import { autoMap, CSV_FIELDS } from '../../crm/src/import/generic_csv'
import type { CsvField } from '../../crm/src/import/generic_csv'
import type { ImportedContact } from '../../crm/src/import/types'
import { exportEntry, googleGroup, googleOn } from './contacts_sync_view'
import { COMING_SOURCES, VERIFIED_SOURCES } from './import_sources'
import { failRun, finishRun, IDLE_RUN, startRun, tickRun } from './import_run'
import type { Run } from './import_run'
import type { Pages } from './page_view'
import { commitPlan, countsLine, pendingProposals } from './services_import'
import { planFrom } from './import_pipeline'
import type { ServiceFile, ServicePlan } from './services_import'
import { curatePage } from './import_curate_view'
import { openImportHome } from './import_home_view'
import { S } from './strings'
import type { Actions } from './actions'

export interface ServicesHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  /** After people were added or taken away: the web redraws. */
  changed: () => void
  pages: Pages
  /** Wave 39: the Import page shows the result of an import inside itself (the dialog stays in the overlay the owner is looking at). */
  done?: (text: string, review?: () => void) => void
  /** The existing "Your AI" entry; wave 40: given the row, the assistant looks that person up (a stub button on the Curate page opens it). */
  openAi?: (row?: ServiceRow) => void
  /** Wave 40 ai-edit-chat: the Curate page's steps go through the action registry when the host has one. */
  actions?: Actions
}

const FILE_MAX_BYTES = 20 * 1024 * 1024
const info = (text: string): HTMLElement =>
  el('details', { class: 'meta', 'data-svc-info': '' }, [el('summary', { style: 'text-decoration:underline;cursor:pointer;display:inline' }, [S.svcInfoMark]), el('p', { class: 'meta' }, [text])])

/** The pick in progress lives here, not in the section: the Settings sheet redraws now and then and must not lose the summary. */
let plan: ServicePlan | null = null
let files: ServiceFile[] = []
let me = ''
let dayFirst: boolean | undefined
let notRecognised = 0
let run: Run = IDLE_RUN

/** Rebuilds the open import box (set by servicesGroup), so contacts that arrive later (Connect Google) show in the summary. */
let redraw: (() => void) | null = null

/** Connect Google came back with contacts: they join the same summary as a file (wave 33). */
export function offerContacts(h: ServicesHooks, contacts: ImportedContact[], name = 'Google contacts'): void {
  files = [{ name, text: '', contacts }]
  dayFirst = undefined
  plan = planFrom(h.state(), files, { me: me || h.state().me.displayName, now: Date.now() })
  notRecognised = 0
  run = IDLE_RUN
  if (redraw && document.querySelector('[data-import-services]')?.isConnected) redraw()
  else openServicesImport(h)
}

/** The open Contacts box draws itself again (its counts, e.g. "Curate (n)", read the record). */
export function refreshServices(): void { redraw?.() }

export function servicesGroup(h: ServicesHooks): HTMLElement[] {
  const box = el('div', { 'data-import-services': '1' })
  me ||= h.state().me.displayName

  const replan = (): void => { plan = planFrom(h.state(), files, { me, now: Date.now(), dayFirst }) }
  const input = el('input', { type: 'file', multiple: true, accept: '.txt,.csv,.vcf,.json,text/*', hidden: true, 'data-svc-file': '1' }) as HTMLInputElement
  const pick = (list: File[]): void => {
    run = startRun(Date.now())
    draw()
    void Promise.all(list.filter((f) => f.size <= FILE_MAX_BYTES).map(async (f) => ({ name: f.name, text: await f.text() }))).then((read) => {
      files = read
      dayFirst = undefined
      replan()
      notRecognised = plan!.files.filter((f) => !f.source).length
      run = finishRun(run)
      draw()
    }).catch(() => { run = failRun(run, S.svcReadFailed); draw() })
  }
  input.addEventListener('change', () => {
    const list = [...(input.files ?? [])]
    input.value = ''
    pick(list)
  })
  // While a pass runs the box checks the clock itself: it never waits for a manual refresh.
  const timer = setInterval(() => {
    if (!box.isConnected) { clearInterval(timer); return }
    const next = tickRun(run, Date.now())
    if (next !== run) { run = failRun(run, S.svcTimedOut); draw() }
  }, 1000)

  /** Generic CSV: one picker per column, guessed from the header; a fixed pick replans at once. */
  function columns(p: ServicePlan): HTMLElement[] {
    return p.files.flatMap((f, i) => (f.headers && f.mapping ? [el('details', { class: 'meta', open: true, 'data-svc-columns': f.name }, [
      el('summary', { style: 'text-decoration:underline;cursor:pointer;display:inline' }, [`${f.name}: ${S.svcColumns}`]),
      ...f.headers.map((hd, c) => el('label', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0' }, [
        el('span', { style: 'min-width:0;overflow-wrap:anywhere' }, [hd || `#${c + 1}`]),
        el('select', { style: 'max-width:100%', 'aria-label': hd, 'data-svc-column': String(c), onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value
          const next = [...(files[i].mapping ?? autoMap(f.headers!))]
          next[c] = (v || null) as CsvField | null
          files = files.map((x, j) => (j === i ? { ...x, mapping: next } : x))
          replan()
          draw()
        } }, [el('option', { value: '', selected: f.mapping![c] === null }, [S.svcColumnIgnore]), ...CSV_FIELDS.map((k) => el('option', { value: k, selected: f.mapping![c] === k }, [S.svcColumnFields[k]]))]),
      ])),
    ])] : []))
  }

  function summary(p: ServicePlan): HTMLElement {
    const n = p.rows.length
    const d = p.diff
    const parts: (HTMLElement | null)[] = [
      el('p', { class: 'meta' }, [S.svcSummary(countsLine(p.counts), p.groups, n)]),
      (h.state().serviceImports ?? []).length ? el('p', { class: 'meta', 'data-svc-diff': `${d.added}/${d.changed}/${d.unchanged}` }, [S.svcDiff(d.added, d.changed, d.unchanged)]) : null,
      notRecognised ? el('p', { class: 'warn' }, [S.svcNotRecognised(notRecognised)]) : null,
      ...columns(p),
      p.counts.whatsapp ? el('label', { class: 'meta' }, [S.svcMeLabel + ' ', el('input', { class: 'field', value: me, 'data-svc-me': '1', onchange: (e: Event) => { me = (e.target as HTMLInputElement).value.trim(); replan(); draw() } })]) : null,
      p.ambiguous ? el('p', { class: 'meta' }, [S.svcAmbiguous, ' ', el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-monthfirst': '1', onclick: () => { dayFirst = false; replan(); draw() } }, [S.svcMonthFirst])]) : null,
      n ? el('button', { class: 'btn btn-electric', 'data-svc-yes': '1', onclick: () => yes(p) }, [S.svcYes(n)]) : null,
      el('button', { class: 'btn btn-ghost', 'data-svc-notnow': '1', onclick: () => { plan = null; files = []; draw() } }, [S.svcNotNow]),
    ]
    return el('div', { 'data-svc-summary': `${n}` }, parts.filter((x): x is HTMLElement => x !== null))
  }

  function yes(p: ServicePlan): void {
    commitPlan(h.state(), p, randomId(8), Date.now())
    h.save()
    plan = null
    files = []
    draw()
    h.done?.(S.imp39.doneStaged(p.rows.length), () => curatePage(h))
    curatePage(h)
  }

  function draw(): void {
    const last = h.state().serviceImports?.[0]
    const waiting = pendingProposals(h.state(), Date.now()).length
    box.replaceChildren(...[
      el('h4', { class: 'eyebrow' }, [S.svcGroup]),
      input,
      el('button', { class: 'btn btn-ghost', 'data-svc-open': '1', onclick: () => input.click() }, [S.svcButton]),
      el('p', { class: 'meta' }, [S.svcHint, ' ', info(S.svcInfo)]),
      el('p', { class: 'meta', 'data-import-sources': '' }, [S.svcVerified(VERIFIED_SOURCES.map((x) => x.label)), ' ', S.svcComing(COMING_SOURCES.map((x) => x.label))]),
      run.phase === 'reading' ? el('p', { class: 'meta', role: 'status', 'data-svc-reading': '1' }, [S.svcReading]) : null,
      run.phase === 'failed' ? el('p', { class: 'warn', 'data-svc-failed': '1' }, [run.error ?? S.svcReadFailed, ' ', el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-retry': '1', onclick: () => input.click() }, [S.svcRetry])]) : null,
      plan && run.phase !== 'reading' ? summary(plan) : null,
      last ? el('div', { class: 'conn-row', 'data-svc-last': last.id }, [
        el('span', {}, [S.svcLast(new Date(last.at).toLocaleDateString(), last.rows.length)]),
        waiting ? el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-curate': '1', onclick: () => curatePage(h) }, [S.svcCurate(waiting)]) : null,
      ].filter((x): x is HTMLElement => x !== null)) : null,
    ].filter((x): x is HTMLElement => x !== null))
  }
  redraw = draw
  draw()
  return [box, ...(googleOn() ? [googleGroup((contacts) => offerContacts(h, contacts), h.toast)] : []), exportEntry({ state: h.state, toast: h.toast, pages: h.pages })]
}

/** The one way in from Contacts, Settings and "Import everything": the Import page (import_home_view.ts); its Contacts section is servicesGroup above. */
export function openServicesImport(h: ServicesHooks): void {
  openImportHome(h)
}

export { curatePage }
