// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Settings > "From other services" and its Curate page (wave 27). The rules are in services_import.ts: a summary before anything is
 * written, nothing in the web before Accept, nothing sent anywhere. DOM only. The Curate page is a page with Back, not an overlay.
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import { Ring } from './model'
import type { AppState } from './model'
import type { Pages } from './page_view'
import { bulkAccept, commitPlan, countsLine, decide, pendingProposals, planServices, undoBatch } from './services_import'
import type { ServiceFile, ServicePlan } from './services_import'
import { S } from './strings'
import { bulkAcceptable } from './zone_proposals'

export interface ServicesHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  /** After people were added or taken away: the web redraws. */
  changed: () => void
  pages: Pages
}

const FILE_MAX_BYTES = 20 * 1024 * 1024
/** The zones the owner may move a person to on the Curate page (the proposal itself never goes above Friend). */
const CHANGE_RINGS: readonly Ring[] = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending]
const info = (text: string): HTMLElement =>
  el('details', { class: 'meta', 'data-svc-info': '' }, [el('summary', { style: 'text-decoration:underline;cursor:pointer;display:inline' }, [S.svcInfoMark]), el('p', { class: 'meta' }, [text])])

/** The pick in progress lives here, not in the section: the Settings sheet redraws now and then and must not lose the summary. */
let plan: ServicePlan | null = null
let files: ServiceFile[] = []
let me = ''
let dayFirst: boolean | undefined
let notRecognised = 0

export function servicesGroup(h: ServicesHooks): HTMLElement[] {
  const box = el('div', { 'data-import-services': '1' })
  me ||= h.state().me.displayName

  const replan = (): void => { plan = planServices(h.state(), files, { me, now: Date.now(), dayFirst }) }
  const input = el('input', { type: 'file', multiple: true, accept: '.txt,.csv,.vcf,.json,text/*', hidden: true, 'data-svc-file': '1' }) as HTMLInputElement
  input.addEventListener('change', () => {
    const list = [...(input.files ?? [])]
    input.value = ''
    void Promise.all(list.filter((f) => f.size <= FILE_MAX_BYTES).map(async (f) => ({ name: f.name, text: await f.text() }))).then((read) => {
      files = read
      dayFirst = undefined
      replan()
      notRecognised = plan!.files.filter((f) => !f.source).length
      draw()
    }, () => h.toast(S.impNotJson))
  })

  function summary(p: ServicePlan): HTMLElement {
    const n = p.rows.length
    const d = p.diff
    const parts: (HTMLElement | null)[] = [
      el('p', { class: 'meta' }, [S.svcSummary(countsLine(p.counts), p.groups, n)]),
      (h.state().serviceImports ?? []).length ? el('p', { class: 'meta', 'data-svc-diff': `${d.added}/${d.changed}/${d.unchanged}` }, [S.svcDiff(d.added, d.changed, d.unchanged)]) : null,
      notRecognised ? el('p', { class: 'warn' }, [S.svcNotRecognised(notRecognised)]) : null,
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
    curatePage(h)
  }

  function undo(batchId: string): void {
    if (!confirm(S.svcUndoConfirm)) return
    const r = undoBatch(h.state(), batchId)
    h.save()
    h.changed()
    h.toast(S.svcUndone(r.archived, r.restored, r.kept))
    draw()
  }

  function draw(): void {
    const last = h.state().serviceImports?.[0]
    const waiting = pendingProposals(h.state(), Date.now()).length
    box.replaceChildren(...[
      el('h4', { class: 'eyebrow' }, [S.svcGroup]),
      input,
      el('button', { class: 'btn btn-ghost', 'data-svc-open': '1', onclick: () => input.click() }, [S.svcButton]),
      el('p', { class: 'meta' }, [S.svcHint, ' ', info(S.svcInfo)]),
      plan ? summary(plan) : null,
      last ? el('div', { class: 'conn-row', 'data-svc-last': last.id }, [
        el('span', {}, [S.svcLast(new Date(last.at).toLocaleDateString(), last.rows.length)]),
        waiting ? el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-curate': '1', onclick: () => curatePage(h) }, [S.svcCurate(waiting)]) : null,
        el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-undo': last.id, onclick: () => undo(last.id) }, [S.svcUndo]),
      ].filter((x): x is HTMLElement => x !== null)) : null,
    ].filter((x): x is HTMLElement => x !== null))
  }
  draw()
  return [box]
}

/** The Curate page: one row per proposal, Accept / Change / Leave; bulk accept only for rows with no flag. */
export function curatePage(h: ServicesHooks): void {
  const list = el('div', { 'data-svc-list': '1' })
  const bulk = el('div')
  const draw = (): void => {
    const now = Date.now()
    const rows = pendingProposals(h.state(), now)
    const free = rows.filter((x) => bulkAcceptable(x.proposal)).length
    bulk.replaceChildren(...(free ? [el('button', { class: 'btn btn-electric', 'data-svc-bulk': String(free), onclick: () => { bulkAccept(h.state(), Date.now(), () => randomId(8)); h.save(); h.changed(); draw() } }, [S.svcAcceptAll(free)])] : []))
    list.replaceChildren(...(rows.length ? rows.map(({ batchId, row, proposal: p }) => {
      const act = (choice: Parameters<typeof decide>[3]): void => {
        decide(h.state(), batchId, row.key, choice, Date.now(), () => randomId(8))
        h.save()
        if (choice.do !== 'leave') { h.changed(); h.toast(S.svcAccepted(row.name)) }
        draw()
      }
      const pick = el('select', { style: 'max-width:100%', 'aria-label': S.svcChange, 'data-svc-ring': row.key }, CHANGE_RINGS.map((r) => el('option', { value: r, selected: r === p.ring }, [S.ringLabel[r]]))) as HTMLSelectElement
      return el('div', { class: 'conn-row', style: 'flex-direction:column;align-items:stretch;gap:6px', 'data-svc-row': row.key }, [
        el('b', {}, [row.name]),
        el('span', { class: 'meta' }, [`${S.ringLabel[p.ring]} · ${S.svcScore(p.score)} · `, el('i', {}, [S.svcInferred])]),
        el('details', { class: 'meta' }, [
          el('summary', { style: 'text-decoration:underline;cursor:pointer;display:inline' }, [S.svcInfoMark]),
          el('p', { class: 'meta' }, [S.svcTerms(p.terms.freq, p.terms.recency, p.terms.reciprocity, p.n365)]),
          ...p.flags.map((f) => el('p', { class: 'warn' }, [f === 'one-way' ? S.svcFlagOneWay : S.svcFlagDupe])),
        ]),
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' }, [
          el('button', { class: 'btn btn-electric btn-sm', 'data-svc-accept': row.key, onclick: () => act({ do: 'accept' }) }, [S.svcAccept]),
          pick,
          el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-change': row.key, onclick: () => act({ do: 'change', ring: pick.value as Ring }) }, [S.svcChange]),
          el('button', { class: 'btn btn-ghost btn-sm', 'data-svc-leave': row.key, onclick: () => act({ do: 'leave' }) }, [S.svcLeave]),
        ]),
      ])
    }) : [el('p', { class: 'meta', 'data-svc-empty': '1' }, [S.svcCurateEmpty])]))
  }
  draw()
  h.pages.open(S.svcCuratePage, [bulk, list], 'import-curate')
}
