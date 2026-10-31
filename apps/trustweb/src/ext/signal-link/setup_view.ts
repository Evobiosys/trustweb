// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Signal / Molly setup (wave 27): ONE page, one step at a time (back up, link, import, place people). DOM only; the logic is proposals.ts / companion.ts. */
import { el } from '../../../../demo/src/ui/dom'
import { renderQr } from '../../../../demo/src/ui/qr'
import { RINGS, type Ring } from '../../model'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { loadPairing, createClient, type CompanionConv } from './companion'
import { acceptProposal, proposals, stripWords, type Proposal } from './proposals'

const STEPS = 4

/** Every explanation sits under a collapsed details control. */
const info = (text: string): HTMLElement => el('details', { class: 'meta', 'data-sl-info': '' }, [el('summary', {}, [S.sigInfo]), el('p', {}, [text])])

/** The words per number, kept in this closure only: never written to the record, gone when the page is closed. */
export type WordsByNumber = Map<string, [string, number][]>

export function openSetup(h: ExtHooks, words: WordsByNumber): void {
  let step = 0
  let haveBackup = false
  let linked = false
  let timer: ReturnType<typeof setInterval> | undefined
  const root = el('div', { class: 'sl-setup', 'data-sl-setup': '' })
  const stop = (): void => { if (timer) { clearInterval(timer); timer = undefined } }
  const client = () => { const p = loadPairing(localStorage); return p ? createClient(p) : null }
  const footer = (next: HTMLElement | null): HTMLElement => el('div', { class: 'row' }, [
    next,
    el('button', { class: 'btn btn-ghost btn-sm', 'data-sl-notnow': '', onclick: () => history.back() }, [S.sigNotNow]),
  ])
  const head = (title: string): HTMLElement[] => [el('small', { class: 'meta' }, [S.sigStep(step + 1, STEPS)]), el('h3', {}, [title])]
  const go = (n: number): void => { stop(); step = n; draw() }

  function backupStep(): Node[] {
    const msg = el('p', { class: 'meta', role: 'status', 'data-sl-backup-msg': '' })
    const box = el('input', { type: 'checkbox', 'data-sl-have-backup': '' }) as HTMLInputElement
    const next = el('button', { class: 'btn btn-electric', 'data-sl-next': '', disabled: true, onclick: () => go(1) }, [S.sigNext])
    box.checked = haveBackup
    if (haveBackup) next.removeAttribute('disabled')
    box.addEventListener('change', () => { haveBackup = box.checked; if (haveBackup) next.removeAttribute('disabled'); else next.setAttribute('disabled', '') })
    const run = el('button', { class: 'btn btn-ghost', 'data-sl-backup': '', onclick: () => {
      run.setAttribute('disabled', '')
      void h.backupNow().then((ok) => { msg.textContent = ok ? S.sigBackupDone : S.sigBackupNone; run.removeAttribute('disabled') }, () => { msg.textContent = S.sigBackupFailed; run.removeAttribute('disabled') })
    } }, [S.sigBackupTrustweb])
    return [...head(S.sigBackupTitle), run, msg, el('p', {}, [S.sigBackupSignal]),
      el('label', { class: 'consent' }, [box, el('span', {}, [S.sigHaveBackup])]), info(S.sigBackupInfo), footer(next)]
  }

  function linkStep(): Node[] {
    const status = el('p', { class: 'meta', role: 'status', 'data-sl-link-status': '' })
    const qr = el('div', { class: 'qr', 'data-sl-qr': '' })
    const next = el('button', { class: 'btn btn-electric', 'data-sl-next': '', disabled: !linked, onclick: () => go(2) }, [S.sigNext])
    const poll = async (): Promise<void> => {
      const st = await client()?.status()
      if (!st) { status.textContent = S.sigNoCompanion; return }
      if (st.link === 'linked' || st.account) { linked = true; status.textContent = S.sigLinked; next.removeAttribute('disabled'); stop() }
      else if (st.link === 'failed') { status.textContent = S.sigLinkFailed(st.error ?? ''); stop() }
      else if (st.link === 'waiting') status.textContent = S.sigWaiting
    }
    const show = el('button', { class: 'btn btn-electric', 'data-sl-show-qr': '', onclick: () => {
      void client()?.link().then(async (r) => {
        if (!r) { status.textContent = S.sigNoCompanion; return }
        await renderQr(qr, r.uri)
        status.textContent = S.sigWaiting
        stop(); timer = setInterval(() => { void poll() }, 2000)
      })
    } }, [S.sigShowQr])
    const check = el('button', { class: 'btn btn-ghost btn-sm', 'data-sl-check': '', onclick: () => { void poll() } }, [S.sigCheck])
    void poll()
    return [...head(S.sigLinkTitle), el('p', {}, [S.sigLinkLead]), show, check, qr, status, info(S.sigLinkInfo), footer(next)]
  }

  function importStep(): Node[] {
    const status = el('p', { class: 'meta', role: 'status', 'data-sl-import-status': '' })
    const next = el('button', { class: 'btn btn-electric', 'data-sl-next': '', disabled: true, onclick: () => go(3) }, [S.sigNext])
    if (h.state().signalImport) next.removeAttribute('disabled')
    const run = el('button', { class: 'btn btn-electric', 'data-sl-import': '', onclick: () => {
      run.setAttribute('disabled', '')
      void client()?.import().then((r) => {
        run.removeAttribute('disabled')
        const convs = r?.conversations ?? []
        if (!convs.length) { status.textContent = S.sigImportNone; return }
        words.clear()
        for (const c of convs as CompanionConv[]) if (c.words?.length) words.set(c.e164, c.words.slice(0, 8))
        h.state().signalImport = { at: Date.now(), conversations: stripWords(convs) }
        h.save()
        status.textContent = S.sigImported(convs.length)
        next.removeAttribute('disabled')
      })
    } }, [S.sigImportGo])
    return [...head(S.sigImportTitle), el('p', {}, [S.sigImportLead]), run, status, info(S.sigImportInfo), footer(next)]
  }

  function zonesStep(): Node[] {
    const imp = h.state().signalImport
    const list = el('div', { class: 'sl-rows', 'data-sl-rows': '' })
    const rows = proposals(imp?.conversations ?? [], h.state().people, Date.now())
    const row = (p: Proposal): HTMLElement => {
      const r = el('div', { class: 'prow', 'data-sl-row': p.e164 })
      const place = (ring: Ring): void => {
        acceptProposal(h.state(), p, ring, h.newId, Date.now())
        h.save()
        r.replaceChildren(el('b', {}, [p.name]), el('span', { class: 'meta', 'data-sl-placed': '' }, [' ' + S.sigDone(S.ringLabel[ring])]))
      }
      const picker = el('select', { class: 'field', 'aria-label': S.sigChange, 'data-sl-ring': '' }, RINGS.map((x) => el('option', { value: x, ...(x === p.ring ? { selected: '' } : {}) }, [S.ringLabel[x]]))) as HTMLSelectElement
      picker.hidden = true
      picker.addEventListener('change', () => place(picker.value as Ring))
      const w = words.get(p.e164)
      r.append(
        el('div', { class: 'who' }, [el('b', {}, [p.name]), el('small', { class: 'meta' }, [' ' + (p.personId ? S.sigHere + ' · ' : '') + S.ringLabel[p.ring]])]),
        ...(w?.length ? [el('small', { class: 'meta', 'data-sl-words': '' }, [S.sigWords + ': ' + w.slice(0, 5).map(([x]) => x).join(', ')])] : []),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn btn-electric btn-sm', 'data-sl-accept': '', onclick: () => place(p.ring) }, [S.sigAccept]),
          el('button', { class: 'btn btn-ghost btn-sm', 'data-sl-change': '', onclick: () => { picker.hidden = !picker.hidden } }, [S.sigChange]),
          el('button', { class: 'btn btn-ghost btn-sm', 'data-sl-leave': '', onclick: () => r.replaceChildren(el('span', { class: 'meta' }, [p.name + ' · ' + S.sigLeft])) }, [S.sigLeave]),
          picker,
        ]),
      )
      return r
    }
    list.append(...rows.map(row))
    const done = el('button', { class: 'btn btn-electric', 'data-sl-finish': '', onclick: () => { h.redraw(); history.back() } }, [S.sigFinish])
    return [...head(S.sigZonesTitle), el('p', {}, [S.sigZonesLead]), info(S.sigZonesInfo), list, footer(done)]
  }

  function draw(): void {
    const body = [backupStep, linkStep, importStep, zonesStep][step]()
    root.replaceChildren(...body, el('details', { class: 'meta', 'data-sl-privacy': '' }, [el('summary', {}, [S.sigPrivacyTitle]), el('p', {}, [S.sigPrivacy])]))
  }
  draw()
  window.addEventListener('popstate', stop, { once: true })
  h.page(S.sigTitle, [root], 'signal-link-setup')
}
