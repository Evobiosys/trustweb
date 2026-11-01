// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): Settings > Sovereign Switch, a page with Back. Wave 28: it IMPORTS from other services. Sections
 * (sovereign_switch.ts pageSections): the services, the export-mail watcher, Other services, two-way sync (not built), the import
 * rows, and Advanced (folded): export my TrustWeb record, be forgotten on TrustWeb (a confirmation PAGE before anything is sent),
 * erasure requests to other services. DOM only; the logic is sovereign_switch.ts, export_watch.ts and forget.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { DEFAULT_ESTIMATE, SERVICES_RTBF, mainServices, otherServices, type RtbfService } from './data/services_rtbf'
import { startWatch, watchStep, type Watch, type WatchEvent } from './export_watch'
import { forgetStatus, forgetText, noteForgetSent, retractOwn, shareAgain } from './forget'
import type { AppState, Peer } from './model'
import { exportFiles, exportName, type Lang, mailtoFor, markService, nextToExport, pageSections } from './sovereign_switch'
import { S } from './strings'
import { zipStore } from './zip'

export interface SovereignDeps {
  state: () => AppState
  save: () => void
  page: (title: string, body: Node[], mark: string) => void
  toast: (msg: string) => void
  appUrl: string
  /** The phones that can be asked to forget: connected, not blocked. */
  peers: () => Peer[]
  send: (peer: Peer, text: string) => Promise<void>
  /** The existing Import rows (Settings). */
  importRows: () => HTMLElement[]
}

const T = (): typeof S.sov => S.sov
const info = (text: string): HTMLElement => el('details', { class: 'meta', 'data-sov-info': '' }, [el('summary', {}, [T().more]), el('p', {}, [text])])
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

function section(key: string, title: string, children: (Node | null)[], open = false): HTMLElement {
  const d = el('details', { class: 'settings-adv', 'data-sov-section': key }, [el('summary', { class: 'adv-toggle' }, [title]), ...children]) as HTMLDetailsElement
  d.open = open
  return d
}

export function createSovereignView(d: SovereignDeps): { open: () => void; refresh: () => void } {
  let root: HTMLElement | null = null
  let advancedOpen = false

  function download(): void {
    const now = Date.now()
    const blob = new Blob([zipStore(exportFiles(d.state(), now), new Date(now)) as BlobPart], { type: 'application/zip' })
    const a = el('a', { href: URL.createObjectURL(blob), download: exportName(now) }) as HTMLAnchorElement
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  function forgetRows(): (Node | null)[] {
    const s = d.state()
    const peers = d.peers()
    const status = { 'not-sent': T().stNotSent, sent: T().stSent, acked: T().stAcked }
    const asked = peers.filter((p) => forgetStatus(s, p.id) !== 'not-sent')
    const paused = s.inventory.some((i) => i.retractedAt !== undefined)
    return [
      el('button', { class: 'btn btn-ghost', 'data-sov-forget': '', disabled: !peers.length, onclick: confirmForget }, [T().forgetBtn]),
      el('p', { class: 'meta' }, [peers.length ? T().forgetHint(peers.length) : T().forgetNobody]),
      info(T().forgetInfo),
      asked.length ? el('ul', { class: 'sov-status', 'data-sov-status': '' }, asked.map((p) => el('li', { 'data-sov-peer': p.id }, [`${p.displayName}: ${status[forgetStatus(s, p.id)]}`]))) : null,
      paused ? el('button', { class: 'btn btn-ghost btn-sm', 'data-sov-share-again': '', onclick: () => { const n = shareAgain(d.state()); d.save(); d.toast(T().sharedAgain(n)); refresh() } }, [T().shareAgain]) : null,
    ]
  }

  /** The confirmation page: nothing is sent before this tap. */
  function confirmForget(): void {
    const peers = d.peers()
    const go = el('button', { class: 'btn btn-electric', 'data-sov-forget-go': '' }, [T().forgetGo(peers.length)]) as HTMLButtonElement
    go.onclick = async () => {
      go.disabled = true
      const s = d.state()
      const now = Date.now()
      retractOwn(s, now)
      d.save()
      const text = forgetText(d.appUrl, { op: 'forget', scope: 'all', ts: now })
      let sent = 0
      for (const p of peers) {
        try { await d.send(p, text); noteForgetSent(d.state(), p.id, now); sent++ } catch { /* stays "not sent yet"; tapping again retries */ }
      }
      d.save()
      d.toast(T().forgetSent(sent, peers.length))
      history.back()
      refresh()
    }
    d.page(T().forgetConfirmTitle, [
      el('p', {}, [T().forgetConfirmLead]),
      el('ul', {}, [el('li', {}, [T().forgetWhat1]), el('li', {}, [T().forgetWhat2]), el('li', {}, [T().forgetWhat3])]),
      go,
      el('button', { class: 'btn btn-ghost', 'data-sov-not-now': '', onclick: () => history.back() }, [T().notNow]),
    ], 'sovereign-forget')
  }

  /** One service of the import list: how long it takes, what to look out for (under the (i)), its export page, my tick. */
  function serviceCard(svc: RtbfService): HTMLElement {
    const s = d.state()
    const at = s.sovereign?.services?.[svc.id]?.exportAt
    const box = el('input', { type: 'checkbox', 'data-sov-tick': `${svc.id}:export` }) as HTMLInputElement
    box.checked = at !== undefined
    box.onchange = () => { markService(d.state(), svc.id, 'export', box.checked ? Date.now() : null); d.save(); refresh() }
    return el('div', { class: 'sov-svc', 'data-sov-service': svc.id }, [
      el('b', {}, [svc.name]), svc.verified ? null : el('small', { class: 'meta', title: T().checkTitle }, [' ' + T().check]),
      el('p', { class: 'meta', 'data-sov-estimate': svc.id }, [`${T().estimateLabel}: ${svc.estimate ?? DEFAULT_ESTIMATE}`]),
      svc.watchFor?.length ? el('details', { class: 'meta', 'data-sov-watchfor': svc.id }, [el('summary', {}, [T().watchFor]), el('ul', {}, svc.watchFor.map((w) => el('li', {}, [w])))]) : null,
      svc.note ? el('p', { class: 'meta' }, [svc.note]) : null,
      el('div', { class: 'sov-links' }, [svc.exportUrl ? el('a', { href: svc.exportUrl, target: '_blank', rel: 'noopener' }, [T().exportLink]) : null]),
      svc.exportUrl ? el('label', { class: 'consent' }, [box, el('span', {}, [T().exportAsked + (at ? ` ${day(at)}` : '')])]) : null,
    ])
  }

  function serviceRows(): (Node | null)[] {
    const next = nextToExport(mainServices(), d.state())
    return [
      el('button', {
        class: 'btn btn-electric', 'data-sov-start': '', disabled: !next,
        onclick: () => { const n = nextToExport(mainServices(), d.state()); if (!n?.exportUrl) return; window.open(n.exportUrl, '_blank', 'noopener'); markService(d.state(), n.id, 'export', Date.now()); d.save(); refresh() },
      }, [next ? T().startSwitch(next.name) : T().switchDone]),
      info(T().startInfo),
      ...mainServices().map(serviceCard),
      el('p', { class: 'meta', 'data-sov-google-note': '' }, [T().googleNote]),
    ]
  }

  /** The export-mail watcher. The mail connection is a stub (no mail route in the app yet): the owner taps when the mail arrived. */
  function watchRows(): (Node | null)[] {
    const s = d.state()
    const set = (id: string, w: Watch | null): void => {
      const all = ((s.sovereign ??= {}).watch ??= {})
      if (w) all[id] = w; else delete all[id]
      d.save(); refresh()
    }
    const step = (id: string, ev: WatchEvent): void => { const w = s.sovereign?.watch?.[id]; if (w) set(id, watchStep(w, ev, Date.now())) }
    const btn = (label: string, mark: string, onclick: () => void): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', [`data-sov-${mark}`]: '', onclick }, [label])
    const row = (svc: RtbfService): HTMLElement => {
      const w = s.sovereign?.watch?.[svc.id]
      const live = w ? watchStep(w, { type: 'tick' }, Date.now()) : undefined
      if (live && live.state !== w?.state) set(svc.id, live)
      return el('div', { class: 'sov-svc', 'data-sov-watch': svc.id }, [
        el('b', {}, [svc.name]),
        el('span', { class: 'meta', 'data-sov-watch-state': svc.id }, [' ' + (live ? T().watchState[live.state] : '')]),
        !live ? btn(T().watchStart, 'watch-start', () => set(svc.id, startWatch(Date.now()))) : null,
        live?.state === 'waiting' ? btn(T().watchArrived, 'watch-arrived', () => step(svc.id, { type: 'mail', mail: { from: '', subject: '', url: svc.exportUrl } })) : null,
        live?.state === 'link_seen' ? btn(T().watchImport, 'watch-import', () => step(svc.id, { type: 'import' })) : null,
        live?.state === 'importing' ? btn(T().watchImported, 'watch-imported', () => step(svc.id, { type: 'imported' })) : null,
        live?.state === 'expired' ? btn(T().watchAgain, 'watch-again', () => set(svc.id, startWatch(Date.now()))) : null,
        live && live.state !== 'done' && live.state !== 'expired' ? btn(T().watchStop, 'watch-stop', () => set(svc.id, null)) : null,
      ])
    }
    return [
      el('p', { class: 'meta' }, [T().watchLead]),
      el('details', { class: 'meta', 'data-sov-info': '' }, [el('summary', {}, [T().watchSees]), el('ul', {}, [T().watchSees1, T().watchSees2, T().watchSees3].map((x) => el('li', {}, [x]))), el('p', {}, [T().watchRevoke])]),
      el('button', { class: 'btn btn-ghost', 'data-sov-mail-connect': '', disabled: true }, [T().watchConnect]),
      el('p', { class: 'meta', 'data-sov-watch-stub': '' }, [T().watchStub]),
      ...mainServices().filter((x) => x.exportUrl).map(row),
    ]
  }

  /** Advanced: asking the services to erase me (request letters, links, ticks). */
  function erasureRows(): (Node | null)[] {
    const s = d.state()
    const lang: Lang = s.sovereign?.lang ?? 'en'
    const account = el('input', { class: 'field', placeholder: T().accountPh, 'aria-label': T().accountPh, 'data-sov-account': '' }) as HTMLInputElement
    const fill = (): { name: string; account: string; date: string } => ({ name: s.me.displayName, account: account.value.trim() || T().accountPh, date: day(Date.now()) })
    const langBtn = (l: Lang, label: string): HTMLElement => el('button', {
      class: 'radio' + (lang === l ? ' on' : ''), 'aria-pressed': String(lang === l), 'data-sov-lang': l,
      onclick: () => { (s.sovereign ??= {}).lang = l; d.save(); refresh() },
    }, [label])
    const tick = (svc: RtbfService): HTMLElement => {
      const at = s.sovereign?.services?.[svc.id]?.deleteAt
      const box = el('input', { type: 'checkbox', 'data-sov-tick': `${svc.id}:delete` }) as HTMLInputElement
      box.checked = at !== undefined
      box.onchange = () => { markService(d.state(), svc.id, 'delete', box.checked ? Date.now() : null); d.save(); refresh() }
      return el('label', { class: 'consent' }, [box, el('span', {}, [T().deleteAsked + (at ? ` ${day(at)}` : '')])])
    }
    return [
      el('div', { class: 'msg-setup' }, [el('span', {}, [T().lang]), langBtn('en', 'English'), langBtn('de', 'Deutsch')]),
      account,
      ...SERVICES_RTBF.map((svc) => el('div', { class: 'sov-svc', 'data-sov-erase': svc.id }, [
        el('b', {}, [svc.name]),
        el('div', { class: 'sov-links' }, [
          svc.deleteUrl ? el('a', { href: svc.deleteUrl, target: '_blank', rel: 'noopener' }, [T().deleteLink]) : null,
          el('a', { href: '#', 'data-sov-mail': svc.id, onclick: (e: Event) => { e.preventDefault(); location.href = mailtoFor(svc, d.state().sovereign?.lang ?? 'en', fill()) } }, [T().mailLink]),
        ]),
        tick(svc),
      ])),
    ]
  }

  function body(): Node[] {
    const parts: Record<string, () => Node | null> = {
      start: () => el('p', { class: 'meta', 'data-sov-lead': '' }, [T().lead]),
      services: () => section('services', T().servicesTitle, serviceRows(), true),
      watch: () => section('watch', T().watchTitle, watchRows()),
      other: () => section('other', T().otherTitle, otherServices().map(serviceCard)),
      sync: () => section('sync', T().syncTitle, [el('button', { class: 'btn btn-ghost', 'data-sov-sync': '', disabled: true }, [T().syncTitle]), el('p', { class: 'meta' }, [T().syncSoon])]),
      import: () => section('import', T().importTitle, [el('p', { class: 'meta' }, [T().importLead]), ...d.importRows()]),
      advanced: () => {
        const adv = section('advanced', T().advancedTitle, [
          el('p', { class: 'meta' }, [T().advancedLead]),
          ...(advancedOpen ? [
            section('export', T().exportTitle, [
              el('button', { class: 'btn btn-electric', 'data-sov-export': '', onclick: download }, [T().exportBtn]),
              el('p', { class: 'meta' }, [T().exportHint]),
              info(T().exportInfo),
            ]),
            section('forget', T().forgetTitle, forgetRows()),
            section('erasure', T().erasureTitle, erasureRows()),
          ] : []),
        ], advancedOpen)
        adv.addEventListener('toggle', () => { if ((adv as HTMLDetailsElement).open !== advancedOpen) { advancedOpen = (adv as HTMLDetailsElement).open; refresh() } })
        return adv
      },
    }
    return pageSections(advancedOpen).filter((k) => k in parts).map((k) => parts[k]()).filter((n): n is Node => n !== null)
  }

  function refresh(): void {
    if (!root?.isConnected) return
    const open = new Set([...root.querySelectorAll('details[data-sov-section]')].filter((x) => (x as HTMLDetailsElement).open).map((x) => (x as HTMLElement).dataset.sovSection))
    root.replaceChildren(...body())
    for (const x of root.querySelectorAll('details[data-sov-section]')) (x as HTMLDetailsElement).open = open.has((x as HTMLElement).dataset.sovSection)
  }

  return {
    open() {
      root = el('div', { 'data-sovereign-switch': '' }, body())
      d.page(T().title, [root], 'sovereign-switch')
    },
    refresh,
  }
}
