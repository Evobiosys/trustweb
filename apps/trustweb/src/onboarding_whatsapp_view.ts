// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Trust Hub onboarding from a WhatsApp export (wave 30): the empty-web card, the import page and the "Import running" notice. DOM only;
 * the rules are in onboarding_place.ts and services_import.ts. The pass lives at module level, so leaving the page does not stop it.
 */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import type { AppState } from './model'
import { failRun, finishRun, IDLE_RUN, startRun } from './import_run'
import type { Run } from './import_run'
import { exportSteps, isZip, placeAll, resultOf, showOnboarding } from './onboarding_place'
import { VERIFIED_SOURCES } from './import_sources'
import { readZip } from './zip_read'
import { namesSource, phoneMessageCount, unnamedPeople, withNames } from './phone_export'
import type { Pages } from './page_view'
import { commitPlan, planServices } from './services_import'
import type { ServiceFile, ServicePlan } from './services_import'
import { S } from './strings'

export interface OnboardingHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  /** After people were added: the web redraws. */
  changed: () => void
  pages: Pages
  /** Settings > Import: the page that lists every path we verify. */
  more: () => void
  /** The element the "Import running" notice sits in (the phone frame). */
  host: HTMLElement
}

const FILE_MAX_BYTES = 20 * 1024 * 1024
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const chatsOf = (p: ServicePlan): number => p.files.filter((f) => f.source === 'whatsapp').length
const lines = (text: string): number => { let n = 0; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++; return n }

let dismissed = false
let run: Run = IDLE_RUN
let files: ServiceFile[] = []
let plan: ServicePlan | null = null
let me = ''
let messages = 0
let pct = 0
let message = ''
let naming: string | null = null
let placed: { placed: number; close: number } | null = null
/** Redraws whatever shows the pass (the page and the notice). */
const listeners = new Set<() => void>()
const emit = (): void => { for (const f of [...listeners]) f() }

/** The empty-web card: one primary button and a muted Not now (for this session). Null when it should not show. */
export function onboardingCard(h: OnboardingHooks, _redraw: () => void): HTMLElement | null {
  if (!showOnboarding(h.state(), dismissed)) return null
  // Wave 32: no card on its own, only the link; the owner opens the import page.
  return el('p', { class: 'meta', style: 'text-align:center', 'data-onboard-card': '' }, [
    ...VERIFIED_SOURCES.filter((x) => x.id === 'whatsapp').map((x) => el('button', { class: 'btn btn-ghost btn-sm', style: 'text-decoration:underline', 'data-onboard-source': x.id, 'data-onboard-whatsapp': '', 'data-wa-import': '', onclick: () => openOnboarding(h) }, [S.onbImportFrom(x.label)])),
    ' ',
    // Wave 33: contact files (Google, phone, Dex, any CSV) have no chat evidence to place from; they go to the Curate page of Settings > Import.
    el('button', { class: 'btn btn-ghost btn-sm', style: 'text-decoration:underline', 'data-onboard-contacts': '', onclick: () => h.more() }, [S.onbImportContacts]),
  ])
}

async function start(h: OnboardingHooks, list: File[]): Promise<void> {
  placed = null
  plan = null
  messages = 0
  pct = 0
  message = ''
  const picked = list.filter((f) => f.size <= FILE_MAX_BYTES)
  if (!picked.length) { run = IDLE_RUN; message = S.onbNothing; emit(); return }
  run = startRun(Date.now())
  emit()
  try {
    files = []
    let done = 0
    const add = (name: string, text: string): void => { files.push({ name, text }); messages += text.trimStart().startsWith('{') ? phoneMessageCount(text) : lines(text) }
    for (const f of picked) {
      if (!isZip(f.name)) add(f.name, await f.text())
      else {
        try {
          const dec = new TextDecoder()
          for (const e of await readZip(new Uint8Array(await f.arrayBuffer()))) if (/\.txt$/i.test(e.name)) add(e.name.split('/').pop() ?? e.name, dec.decode(e.data))
        } catch { message = S.onbZip }
      }
      pct = Math.round((++done / (picked.length + 1)) * 100)
      emit()
      await tick()
    }
    me ||= h.state().me.displayName
    plan = planServices(h.state(), files, { me, now: Date.now() })
    pct = 100
    if (!plan.counts.whatsapp) { message = message || S.onbNothing; plan = null; run = IDLE_RUN } else { message = ''; run = finishRun(run) }
  } catch {
    run = failRun(run, S.svcReadFailed)
  }
  emit()
}

/** The owner names a person the phone file knows by number only: the file text changes, the plan is made again (same evidence, same ring guess). */
function nameOne(h: OnboardingHooks, jid: string, name: string): void {
  files = files.map((f) => ({ ...f, text: withNames(f.text, { [jid]: name }) }))
  naming = null
  plan = planServices(h.state(), files, { me, now: Date.now() })
  emit()
}

function place(h: OnboardingHooks): void {
  if (!plan) return
  commitPlan(h.state(), plan, randomId(8), Date.now())
  placed = placeAll(h.state(), Date.now(), () => randomId(8))
  plan = null
  files = []
  run = IDLE_RUN
  h.save()
  h.changed()
  h.toast(S.onbPlaced(placed.placed, placed.close))
  emit()
}

const phoneFile = (fs: ServiceFile[]): ServiceFile | undefined => fs.find((f) => namesSource(f.text) !== null)
const namesLine = (fs: ServiceFile[]): HTMLElement => {
  const src = phoneFile(fs) ? namesSource(phoneFile(fs)!.text) : null
  return el('p', { class: 'meta', 'data-wa-names-source': src ?? 'unknown' }, [src === 'phone_contacts' ? S.onbNamesPhone : src === 'numbers_only' ? S.onbNamesNumbers : S.onbNamesHint])
}
/** People known by number only: the number stands in for the name, a pencil lets the owner name them. */
function unnamed(h: OnboardingHooks): HTMLElement[] {
  const f = phoneFile(files)
  return (f ? unnamedPeople(f.text) : []).map((u) => el('p', { class: 'meta', 'data-wa-unnamed': u.jid }, [
    naming === u.jid
      ? el('input', { class: 'field', 'aria-label': S.onbNameField(u.phone), placeholder: S.onbNameField(u.phone), 'data-wa-name-input': '', onchange: (e: Event) => nameOne(h, u.jid, (e.target as HTMLInputElement).value) })
      : `+${u.phone} `,
    el('button', { class: 'btn btn-ghost btn-sm', style: 'text-decoration:underline', 'aria-label': S.onbNameThem, title: S.onbNameThem, 'data-wa-name': '', onclick: () => { naming = u.jid; emit() } }, ['✎']),
  ]))
}

/** The import page: steps, file pick, progress, result. */
export function openOnboarding(h: OnboardingHooks): void {
  const steps = { android: S.onbStepsAndroid, iphone: S.onbStepsIphone, desktop: S.onbStepsDesktop }[exportSteps(navigator.userAgent)]
  const input = el('input', { type: 'file', multiple: true, accept: '.txt,.zip,text/*', hidden: true, 'data-onboard-file': '' }) as HTMLInputElement
  input.addEventListener('change', () => { const list = [...(input.files ?? [])]; input.value = ''; void start(h, list) })
  // Wave 31: the JSON of the phone tool (trustweb-ops/phone) goes through the same start().
  const phone = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-onboard-phone-file': '' }) as HTMLInputElement
  phone.addEventListener('change', () => { const list = [...(phone.files ?? [])]; phone.value = ''; void start(h, list) })
  me ||= h.state().me.displayName
  const box = el('div', { 'data-onboard-page': '' })
  const draw = (): void => {
    if (!box.isConnected && box.dataset.drawn) { listeners.delete(draw); return }
    box.dataset.drawn = '1'
    const r = plan ? resultOf(plan.rows, chatsOf(plan)) : null
    const parts: (HTMLElement | null)[] = [
      el('p', { class: 'meta' }, [S.onbIntro]),
      el('ol', { class: 'meta', 'data-onboard-steps': '' }, steps.map((t) => el('li', {}, [t]))),
      el('label', { class: 'meta' }, [S.onbMeLabel + ' ', el('input', { class: 'field', value: me, 'data-onboard-me': '', onchange: (e: Event) => { me = (e.target as HTMLInputElement).value.trim(); if (plan) { plan = planServices(h.state(), files, { me, now: Date.now() }); emit() } } })]),
      input,
      phone,
      run.phase !== 'reading' && !r && !placed ? el('button', { class: 'btn btn-electric', style: 'text-decoration:underline', 'data-onboard-choose': '', onclick: () => input.click() }, [S.onbChoose]) : null,
      run.phase !== 'reading' && !r && !placed ? el('p', { class: 'meta' }, [el('button', { class: 'btn btn-ghost btn-sm', style: 'text-decoration:underline', 'data-wa-import-phone': '', onclick: () => phone.click() }, [S.onbPhone]), ' ', S.onbPhoneHint]) : null,
      namesLine(files),
      message ? el('p', { class: 'warn', 'data-onboard-message': '' }, [message]) : null,
      run.phase === 'reading' ? el('p', { class: 'meta', role: 'status', 'data-onboard-reading': String(pct) }, [S.onbReading(messages)]) : null,
      run.phase === 'failed' ? el('p', { class: 'warn', 'data-onboard-failed': '' }, [run.error ?? S.svcReadFailed, ' ', el('button', { class: 'btn btn-ghost btn-sm', style: 'text-decoration:underline', onclick: () => input.click() }, [S.svcRetry])]) : null,
      r ? el('div', { 'data-onboard-result': String(r.total) }, [
        el('p', {}, [S.onbResult(r.total, r.both, r.wroteOnly, r.groupOnly, r.chats)]),
        ...unnamed(h),
        ...(r.total ? [el('button', { class: 'btn btn-electric', style: 'text-decoration:underline', 'data-onboard-place': '', onclick: () => place(h) }, [S.onbPlace])] : []),
      ]) : null,
      placed ? el('p', { 'data-onboard-placed': String(placed.placed) }, [S.onbPlaced(placed.placed, placed.close)]) : null,
    ]
    box.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null))
  }
  listeners.add(draw)
  draw()
  h.pages.open(S.onbTitle, [box], 'onboarding-whatsapp')
}

/** The small notice at the bottom while a pass runs or waits for the owner's tap; it brings them back to the page. */
export function mountOnboardingNotice(h: OnboardingHooks): void {
  const note = el('button', { class: 'btn btn-ghost btn-sm', style: 'position:absolute;left:50%;transform:translateX(-50%);bottom:72px;z-index:30;text-decoration:underline;max-width:90%', hidden: true, 'data-onboard-notice': '', onclick: () => openOnboarding(h) })
  h.host.append(note)
  const draw = (): void => {
    const live = run.phase === 'reading' || (run.phase === 'ready' && !!plan)
    note.hidden = !live
    const r = plan ? resultOf(plan.rows, chatsOf(plan)) : null
    note.textContent = run.phase === 'reading' ? S.onbRunning(pct) : r ? S.onbResult(r.total, r.both, r.wroteOnly, r.groupOnly, r.chats) : ''
  }
  listeners.add(draw)
  draw()
}
