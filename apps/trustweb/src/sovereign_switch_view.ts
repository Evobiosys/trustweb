// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): Settings > Sovereign Switch, a page with Back. Four sections, all folded but the first:
 * export everything, be forgotten on TrustWeb (a confirmation PAGE before anything is sent), be forgotten by other services
 * (a checklist), import from the services. DOM only; the logic is sovereign_switch.ts and forget.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { SERVICES_RTBF, type RtbfService } from './data/services_rtbf'
import { forgetStatus, forgetText, noteForgetSent, retractOwn, shareAgain } from './forget'
import type { AppState, Peer } from './model'
import { exportFiles, exportName, type Lang, mailtoFor, markService, nextToExport } from './sovereign_switch'
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

  function serviceRows(): (Node | null)[] {
    const s = d.state()
    const lang: Lang = s.sovereign?.lang ?? 'en'
    const account = el('input', { class: 'field', placeholder: T().accountPh, 'aria-label': T().accountPh, 'data-sov-account': '' }) as HTMLInputElement
    const fill = (): { name: string; account: string; date: string } => ({ name: s.me.displayName, account: account.value.trim() || T().accountPh, date: day(Date.now()) })
    const langBtn = (l: Lang, label: string): HTMLElement => el('button', {
      class: 'radio' + (lang === l ? ' on' : ''), 'aria-pressed': String(lang === l), 'data-sov-lang': l,
      onclick: () => { (s.sovereign ??= {}).lang = l; d.save(); refresh() },
    }, [label])
    const tick = (svc: RtbfService, what: 'export' | 'delete'): HTMLElement => {
      const at = s.sovereign?.services?.[svc.id]?.[what === 'export' ? 'exportAt' : 'deleteAt']
      const box = el('input', { type: 'checkbox', 'data-sov-tick': `${svc.id}:${what}` }) as HTMLInputElement
      box.checked = at !== undefined
      box.onchange = () => { markService(d.state(), svc.id, what, box.checked ? Date.now() : null); d.save(); refresh() }
      return el('label', { class: 'consent' }, [box, el('span', {}, [(what === 'export' ? T().exportAsked : T().deleteAsked) + (at ? ` ${day(at)}` : '')])])
    }
    const next = nextToExport(SERVICES_RTBF, s)
    return [
      el('button', {
        class: 'btn btn-electric', 'data-sov-start': '', disabled: !next,
        onclick: () => { const n = nextToExport(SERVICES_RTBF, d.state()); if (!n?.exportUrl) return; window.open(n.exportUrl, '_blank', 'noopener'); markService(d.state(), n.id, 'export', Date.now()); d.save(); refresh() },
      }, [next ? T().startSwitch(next.name) : T().switchDone]),
      info(T().startInfo),
      el('div', { class: 'msg-setup' }, [el('span', {}, [T().lang]), langBtn('en', 'English'), langBtn('de', 'Deutsch')]),
      account,
      ...SERVICES_RTBF.map((svc) => el('div', { class: 'sov-svc', 'data-sov-service': svc.id }, [
        el('b', {}, [svc.name]), svc.verified ? null : el('small', { class: 'meta', title: T().checkTitle }, [' ' + T().check]),
        el('div', { class: 'sov-links' }, [
          svc.exportUrl ? el('a', { href: svc.exportUrl, target: '_blank', rel: 'noopener' }, [T().exportLink]) : null,
          svc.deleteUrl ? el('a', { href: svc.deleteUrl, target: '_blank', rel: 'noopener' }, [T().deleteLink]) : null,
          el('a', { href: '#', 'data-sov-mail': svc.id, onclick: (e: Event) => { e.preventDefault(); location.href = mailtoFor(svc, d.state().sovereign?.lang ?? 'en', fill()) } }, [T().mailLink]),
        ]),
        svc.note ? el('p', { class: 'meta' }, [svc.note]) : null,
        tick(svc, 'export'), tick(svc, 'delete'),
      ])),
    ]
  }

  function body(): Node[] {
    return [
      section('export', T().exportTitle, [
        el('button', { class: 'btn btn-electric', 'data-sov-export': '', onclick: download }, [T().exportBtn]),
        el('p', { class: 'meta' }, [T().exportHint]),
        info(T().exportInfo),
      ], true),
      section('forget', T().forgetTitle, forgetRows()),
      section('services', T().servicesTitle, serviceRows()),
      section('import', T().importTitle, [el('p', { class: 'meta' }, [T().importLead]), ...d.importRows()]),
    ]
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
