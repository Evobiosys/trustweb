// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-inapp-browser: the top banner of an in-app browser that holds a connect link not yet in the real web (inapp_browser.ts).
 * iOS cannot be sent to Safari by a page: copy the link (share sheet where there is one) and say how. Android opens an intent.
 * A record already held by this web view is offered as a file (never lost, never sent anywhere).
 */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'
import { androidIntentUrl, inAppBrowser, readPending, rememberPending } from './inapp_browser'
import type { InApp } from './inapp_browser'
import { connectLinkOf } from './add_by_code'

export interface InAppBannerDeps {
  host: InApp
  href: string
  name: string
  /** The raw stored record when this web view already holds one, else null. */
  recordText: string | null
  copy: (text: string) => Promise<void>
  share?: (url: string) => Promise<void>
  save: (fileName: string, text: string) => void
  say: (msg: string) => void
}

export function inAppBanner(d: InAppBannerDeps): HTMLElement {
  const note = el('div', { class: 'inapp-note', 'data-inapp-note': '' }, [S.w44inapp.note])
  const actions: HTMLElement[] = []
  if (d.host.os === 'android') {
    actions.push(el('a', { class: 'btn btn-electric btn-sm', href: androidIntentUrl(d.href), 'data-inapp-open': '' }, [S.w44inapp.openAndroid]))
  } else {
    const copy = (): void => { void d.copy(d.href).then(() => d.say(S.w44inapp.copied)) }
    actions.push(el('button', { class: 'btn btn-electric btn-sm', 'data-inapp-copy': '', onclick: copy }, [S.w44inapp.copyIos]))
    if (d.share) actions.push(el('button', { class: 'btn btn-ghost btn-sm', 'data-inapp-share': '', onclick: () => { void d.share?.(d.href).catch(copy) } }, [S.w44inapp.shareIos]))
    note.append(el('div', { class: 'meta', 'data-inapp-how': '' }, [S.w44inapp.iosHow]))
  }
  if (d.recordText) {
    const text = d.recordText
    actions.push(el('button', { class: 'btn btn-ghost btn-sm', 'data-inapp-export': '', title: S.w44inapp.exportHint, onclick: () => { d.save(S.w44inapp.fileName, text); d.say(S.w44inapp.exported) } }, [S.w44inapp.export]))
  }
  return el('div', { class: 'inapp-banner', role: 'status', 'data-inapp-banner': '' }, [
    el('b', {}, [S.w44inapp.banner(d.name)]),
    note,
    el('div', { class: 'notice-actions' }, actions),
  ])
}

export interface MountDeps {
  ua: string
  standalone: boolean
  /** The address as opened (before the startup clean) and its query. */
  href: string
  search: string
  /** Solo demo phones are no one's real record. */
  solo: boolean
  recordKey: string
  now: number
}

/** Boot hook: in an in-app browser, a connect link (or one remembered from an earlier open) puts the banner on the page. Returns whether it showed. */
export function mountInAppBanner(m: MountDeps): boolean {
  const host = inAppBrowser(m.ua, m.standalone)
  if (!host || m.solo) return false
  const link = connectLinkOf(m.search)
  if (link) rememberPending(localStorage, { href: m.href, name: link.from.displayName }, m.now)
  const pending = link ? { href: m.href, name: link.from.displayName } : readPending(localStorage, m.now)
  if (!pending) return false
  const banner = inAppBanner({
    host, href: pending.href, name: pending.name, recordText: localStorage.getItem(m.recordKey),
    copy: (t) => navigator.clipboard.writeText(t),
    share: typeof navigator.share === 'function' ? (url) => navigator.share({ url }) : undefined,
    save: (fileName, text) => {
      const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: fileName })
      document.body.append(a); a.click(); a.remove()
    },
    say: (msg) => { banner.querySelector('[data-inapp-note]')?.setAttribute('title', msg); toastLine(banner, msg) },
  })
  document.body.dataset.inapp = '1'
  document.body.prepend(banner)
  document.documentElement.style.setProperty('--inapp-h', `${banner.offsetHeight}px`)
  return true
}

/** The confirmation sits in the banner itself: a toast would hide under it. */
function toastLine(banner: HTMLElement, msg: string): void {
  let line = banner.querySelector('[data-inapp-said]')
  if (!line) { line = el('div', { class: 'meta', role: 'status', 'data-inapp-said': '' }); banner.append(line) }
  line.textContent = msg
}
