// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: the Obsidian vault page (opened from the Import page). Pick the folder (directory input; the File System Access API
 * where the browser has it, so Sync again needs no new pick), see what changed, review the people on the existing Curate page; and, if the
 * owner switched it on, run complete ingestion with their own AI. DOM only; every rule is in the pure obsidian_*.ts files.
 */
import { el } from '../../../../demo/src/ui/dom'
import { randomId } from '../../../../demo/src/crypto'
import { curatePage } from '../../import_curate_view'
import { commitPlan } from '../../services_import'
import type { ServicesHooks } from '../../services_view'
import { S } from '../../strings'
import { alphaSub } from '../../alpha_heading'
import { workerScanner } from './obsidian_client'
import { openVaultStore } from './obsidian_cache'
import { MODULE_ID, parseObsidian } from './obsidian_data'
import { ingestTarget, makeAsk } from './obsidian_endpoint'
import { fromInput, walkHandle } from './obsidian_files'
import type { DirHandleLike, FileLike, VaultFile, VaultFiles } from './obsidian_files'
import { BATCH_DEFAULTS, planBatches, toContacts } from './obsidian_ingest'
import type { ExtractedPerson } from './obsidian_ingest'
import { buildContacts } from './obsidian_people'
import { ingestOptIn } from './obsidian_prefs'
import { createIngest } from './obsidian_run'
import type { IngestProgress } from './obsidian_run'
import { syncVault } from './obsidian_scan'
import { planVault } from './obsidian_stage'
import type { ServicePlan } from '../../services_import'
import { targetLine } from './obsidian_settings'

const T = S.obsidian
const u = { style: 'text-decoration:underline;cursor:pointer' }
const some = <N>(xs: readonly (N | null)[]): N[] => xs.filter((x): x is N => x !== null)

interface PickerWindow { showDirectoryPicker?: (o: { id: string; mode: 'read' }) => Promise<DirHandleLike> }
interface PermHandle extends DirHandleLike { requestPermission?: (o: { mode: 'read' }) => Promise<'granted' | 'denied' | 'prompt'> }
interface Run { people: ExtractedPerson[]; donePaths: string[] }

const eta = (ms: number | null): string => {
  if (ms === null) return ''
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 90 ? T.eta.s(s) : s < 5400 ? T.eta.m(Math.round(s / 60)) : T.eta.h(Math.round(s / 3600))
}

export function openObsidian(h: ServicesHooks): void {
  const store = openVaultStore(h.state().me.id)
  const ui = {
    files: [] as VaultFile[], vault: parseObsidian(h.state().extData?.[MODULE_ID]).vault ?? '',
    reading: null as { done: number; total: number } | null, error: '',
    sync: null as null | { plan: ServicePlan; notes: number; people: number; diff: { added: number; changed: number; removed: number; same: number }; skipped: VaultFiles['skipped']; failed: number },
    handle: null as PermHandle | null,
    ingest: null as null | ReturnType<typeof createIngest>, progress: null as IngestProgress | null, paused: false,
    run: null as Run | null, finished: '' as '' | 'done' | 'stopped' | 'error', failedAi: 0,
  }
  const syncBox = el('div', { 'data-obs-sync': '' })
  const ingestBox = el('div', { 'data-obs-ingest': '' })
  const root = el('div', { 'data-obsidian-page': '' }, [
    el('p', { class: 'cur-head' }, [alphaSub()]),
    el('p', { class: 'meta' }, [T.pageLead]),
    syncBox, ingestBox,
  ])

  // ---- pick and sync ----
  const input = el('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true, 'data-obs-dir': '' }) as HTMLInputElement
  input.addEventListener('change', () => {
    const list = Array.from(input.files ?? []) as unknown as FileLike[]
    input.value = ''
    if (list.length) void sync(fromInput(list))
  })
  const picker = (window as unknown as PickerWindow).showDirectoryPicker

  async function sync(v: VaultFiles): Promise<void> {
    ui.error = ''; ui.sync = null
    if (!v.files.length) { ui.error = T.noNotes; drawSync(); return }
    ui.files = v.files
    ui.reading = { done: 0, total: v.files.length }
    drawSync()
    try {
      const r = await syncVault(v.files, store, workerScanner, (done, total) => { ui.reading = { done, total }; drawSync() })
      const s = h.state()
      if (v.vault) ui.vault = v.vault
      s.extData = { ...s.extData, [MODULE_ID]: { vault: ui.vault, syncedAt: Date.now() } }
      h.save()
      const built = buildContacts(r.notes)
      ui.sync = { plan: planVault(s, built.contacts, { me: s.me.displayName, now: Date.now() }), notes: built.notes, people: built.contacts.length, diff: r.diff, skipped: v.skipped, failed: r.failed.length }
    } catch { ui.error = T.noNotes }
    ui.reading = null
    drawSync(); drawIngest()
  }

  async function pickFolder(): Promise<void> {
    if (!picker) { input.click(); return }
    try {
      const handle = await picker.call(window, { id: 'trustweb-obsidian', mode: 'read' })
      ui.handle = handle
      await store.setMeta('handle', handle).catch(() => undefined)
      await sync(await walkHandle(handle))
    } catch (e) { if ((e as Error).name !== 'AbortError') input.click() }
  }

  async function syncAgain(): Promise<void> {
    const handle = ui.handle
    if (!handle) return
    if ((await handle.requestPermission?.({ mode: 'read' }).catch(() => 'denied')) === 'denied') { ui.error = T.resyncDenied; drawSync(); return }
    await sync(await walkHandle(handle))
  }

  function review(): void {
    const s = ui.sync
    if (!s) return
    commitPlan(h.state(), s.plan, randomId(8), Date.now())
    h.save()
    ui.sync = null
    drawSync()
    curatePage(h)
  }

  function drawSync(): void {
    const s = ui.sync
    const rows = s ? s.plan.diff.added + s.plan.diff.changed : 0
    syncBox.replaceChildren(...some([
      el('div', { class: 'cur-bar' }, some([
        el('button', { class: 'btn btn-electric', 'data-obs-pick': '', disabled: ui.reading !== null, onclick: () => void pickFolder() }, [T.pick]),
        ui.handle && ui.vault ? el('button', { class: 'btn btn-ghost', 'data-obs-resync': '', disabled: ui.reading !== null, ...u, onclick: () => void syncAgain() }, [T.resync(ui.vault)]) : null,
      ])),
      input,
      el('p', { class: 'meta' }, [ui.handle ? T.resyncHint : T.pickHint]),
      ui.reading ? el('div', { 'data-obs-reading': `${ui.reading.done}/${ui.reading.total}` }, [
        el('progress', { max: String(ui.reading.total), value: String(ui.reading.done), style: 'width:100%' }),
        el('p', { class: 'meta' }, [T.reading(ui.reading.done, ui.reading.total)]),
      ]) : null,
      ui.error ? el('p', { class: 'warn', 'data-obs-error': '' }, [ui.error]) : null,
      s ? el('div', { 'data-obs-summary': `${s.notes}/${s.people}/${rows}` }, some([
        el('p', {}, [T.sumRead(s.notes, s.diff.added, s.diff.changed, s.diff.removed, s.diff.same)]),
        el('p', { class: 'meta' }, [T.sumPeople(s.people)]),
        s.skipped.tooBig || s.skipped.tooMany ? el('p', { class: 'meta' }, [T.sumSkipped(s.skipped.tooBig, s.skipped.tooMany)]) : null,
        s.failed ? el('p', { class: 'warn' }, [T.sumFailed(s.failed)]) : null,
        rows ? el('button', { class: 'btn btn-electric', 'data-obs-review': String(rows), onclick: review }, [T.review(rows)]) : el('p', { class: 'meta', 'data-obs-nothing-new': '' }, [T.nothingNew]),
      ])) : null,
    ]))
  }

  // ---- complete ingestion (opt-in, own endpoint only) ----
  function startIngest(resume: Run | null): void {
    const ai = h.state().advanced?.ai
    const ask = makeAsk(ai)
    if (!ask) return
    const byPath = new Map(ui.files.map((f) => [f.path, f]))
    const batches = planBatches(ui.files.map((f) => ({ path: f.path, chars: f.file.size })), { skip: new Set(resume?.donePaths ?? []) })
    ui.finished = ''; ui.progress = null; ui.paused = false; ui.failedAi = 0
    const ctl = createIngest({
      batches, ask, resume: resume ?? undefined,
      load: async (path) => { try { return (await byPath.get(path)!.file.text()).slice(0, BATCH_DEFAULTS.perNote) } catch { return null } },
      onProgress: (p) => { ui.progress = p; drawIngest() },
      onBatch: (snap) => { ui.run = snap; void store.setMeta('run', snap).catch(() => undefined) },
    })
    ui.ingest = ctl
    drawIngest()
    void ctl.run().then((r) => {
      ui.ingest = null
      ui.run = { people: r.people, donePaths: r.donePaths }
      ui.failedAi = r.failed.length
      ui.finished = r.status === 'stopped' ? 'stopped' : 'done'
      void store.setMeta('run', ui.run).catch(() => undefined)
      drawIngest()
    }, () => { ui.ingest = null; ui.finished = 'error'; drawIngest() })
  }

  function reviewAi(): void {
    const people = ui.run?.people ?? []
    if (!people.length) return
    const s = h.state()
    const now = Date.now()
    commitPlan(s, planVault(s, toContacts(people), { me: s.me.displayName, now, ai: true }), randomId(8), now)
    h.save()
    ui.run = null; ui.finished = ''
    void store.setMeta('run', undefined).catch(() => undefined)
    drawIngest()
    curatePage(h)
  }

  function drawIngest(): void {
    if (!ingestOptIn()) { ingestBox.replaceChildren(el('h4', { class: 'eyebrow' }, [T.ingestTitle]), el('p', { class: 'meta', 'data-obs-ingest-off': '' }, [T.ingestOff])); return }
    const ai = h.state().advanced?.ai
    const target = ingestTarget(ai)
    const batches = planBatches(ui.files.map((f) => ({ path: f.path, chars: f.file.size })))
    const earlier = ui.run
    const p = ui.progress
    ingestBox.replaceChildren(...some([
      el('h4', { class: 'eyebrow' }, [T.ingestTitle]),
      el('p', { class: 'meta' }, [T.ingestLead]),
      el('p', { class: 'meta', 'data-obs-target': '' }, [targetLine(ai)]),
      target.ok && !ui.files.length ? el('p', { class: 'meta' }, [T.ingestNeedPick]) : null,
      target.ok && ui.files.length && !ui.ingest ? el('p', { class: 'meta' }, [T.ingestPlan(ui.files.length, batches.length)]) : null,
      target.ok && ui.files.length && !ui.ingest ? el('div', { class: 'cur-bar' }, some([
        earlier?.donePaths.length ? el('span', { class: 'meta' }, [T.ingestEarlier(earlier.donePaths.length)]) : null,
        earlier?.donePaths.length ? el('button', { class: 'btn btn-electric', 'data-obs-continue': '', onclick: () => startIngest(earlier) }, [T.ingestContinue]) : null,
        el('button', { class: earlier?.donePaths.length ? 'btn btn-ghost' : 'btn btn-electric', 'data-obs-run': '', ...(earlier?.donePaths.length ? u : {}), onclick: () => { ui.run = null; startIngest(null) } }, [earlier?.donePaths.length ? T.ingestRestart : T.ingestRun]),
      ])) : null,
      ui.ingest ? el('div', { 'data-obs-ai-progress': String(p?.pct ?? 0) }, some([
        el('progress', { max: '100', value: String(p?.pct ?? 0), style: 'width:100%' }),
        el('p', { class: 'meta', 'data-obs-ai-pct': '' }, [ui.paused ? T.ingestPaused : T.ingestProgress(p?.pct ?? 0, eta(p?.etaMs ?? null))]),
        el('div', { class: 'cur-bar' }, [
          el('button', { class: 'btn btn-ghost btn-sm', 'data-obs-ai-pause': '', ...u, onclick: () => { if (ui.paused) { ui.ingest?.resume(); ui.paused = false } else { ui.ingest?.pause(); ui.paused = true } drawIngest() } }, [ui.paused ? T.ingestResume : T.ingestPause]),
          el('button', { class: 'btn btn-ghost btn-sm', 'data-obs-ai-stop': '', ...u, onclick: () => { ui.ingest?.stop(); ui.paused = false } }, [T.ingestStop]),
        ]),
      ])) : null,
      ui.finished === 'error' ? el('p', { class: 'warn' }, [T.ingestError]) : null,
      !ui.ingest && ui.finished && ui.finished !== 'error' ? el('p', { 'data-obs-ai-result': String(earlier?.people.length ?? 0) }, [ui.finished === 'stopped' ? T.ingestStopped(earlier?.people.length ?? 0) : earlier?.people.length ? T.ingestDone(earlier.people.length, ui.failedAi) : T.ingestNothing]) : null,
      !ui.ingest && earlier?.people.length ? el('button', { class: 'btn btn-electric', 'data-obs-ai-review': String(earlier.people.length), onclick: reviewAi }, [T.ingestReview(earlier.people.length)]) : null,
    ]))
  }

  drawSync(); drawIngest()
  void store.getMeta<PermHandle>('handle').then((hd) => { if (hd) { ui.handle = hd; drawSync() } }).catch(() => undefined)
  void store.getMeta<Run>('run').then((r) => { if (r?.donePaths?.length || r?.people?.length) { ui.run = r; drawIngest() } }).catch(() => undefined)
  h.pages.open(T.title, [root], 'import-obsidian')
}
