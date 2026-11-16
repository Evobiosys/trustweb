// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-inapp-browser: UA detection, the link that reopens the pending connect, the remembered pending connect. */
import { inAppBrowser, androidIntentUrl, rememberPending, readPending, PENDING_KEY, PENDING_MAX_MS } from '../../src/inapp_browser.ts'
import { connectLinkOf } from '../../src/add_by_code.ts'
import { issueLink } from '../../src/connect_freshness.ts'
import { createIdentity } from '../../../demo/src/did.ts'
import { buildConnectLinkUrl } from '../../../demo/src/connect_link.ts'

const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IOS_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const ANDROID_TG = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Telegram-Android/10.14.5'
const IOS_TG = IOS_WEBVIEW + ' Telegram-iOS/10.14'

describe('inAppBrowser', () => {
  it('names the app by its UA marker, on iOS and on Android', () => {
    expect(inAppBrowser(IOS_TG)).toEqual({ app: 'Telegram', os: 'ios' })
    expect(inAppBrowser(ANDROID_TG)).toEqual({ app: 'Telegram', os: 'android' })
    expect(inAppBrowser(ANDROID_CHROME + ' Instagram 300.0 Android')?.app).toBe('Instagram')
    expect(inAppBrowser(IOS_WEBVIEW + ' [FBAN/FBIOS;FBAV/450.0]')?.app).toBe('Facebook')
    expect(inAppBrowser(ANDROID_CHROME + ' [FB_IAB/FB4A;FBAV/450.0]')?.app).toBe('Facebook')
    expect(inAppBrowser(IOS_WEBVIEW + ' WhatsApp/2.24')?.app).toBe('WhatsApp')
    expect(inAppBrowser(ANDROID_CHROME + ' LinkedInApp')?.app).toBe('LinkedIn')
  })
  it('an iPhone web view without the Safari token is an in-app browser even with no marker (Telegram on iOS sends none)', () => {
    expect(inAppBrowser(IOS_WEBVIEW)).toEqual({ app: '', os: 'ios' })
  })
  it('real browsers are none', () => {
    expect(inAppBrowser(IOS_SAFARI)).toBeNull()
    expect(inAppBrowser(IOS_CHROME)).toBeNull()
    expect(inAppBrowser(ANDROID_CHROME)).toBeNull()
    expect(inAppBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15')).toBeNull()
  })
  it('an installed iPhone app (standalone) is no in-app browser', () => {
    expect(inAppBrowser(IOS_WEBVIEW, true)).toBeNull()
  })
})

describe('the link that reopens the pending connect', () => {
  const ORIGIN = 'https://app.trustintheweb.org/'
  const DID = createIdentity(`${ORIGIN}relay`).did
  const long = issueLink(buildConnectLinkUrl(ORIGIN, DID, { id: 'p1p1p1p1p1p1', displayName: 'Ada' }), true, 1_800_000_000_000)
  it('the opened link, unchanged, parses to the same connect in the real browser (nothing but the link carries it)', () => {
    const url = new URL(long + '#via=SIGNAL')
    const first = connectLinkOf(url.search)
    const again = connectLinkOf(new URL(url.href).search)
    expect(first).not.toBeNull()
    expect(again).toEqual(first)
    expect(again?.from.displayName).toBe('Ada')
  })
  it('the Android intent carries the whole link and falls back to it', () => {
    const i = androidIntentUrl(long + '#via=SIGNAL')
    expect(i.startsWith('intent://app.trustintheweb.org/?connect=')).toBe(true)
    expect(i).toContain('scheme=https')
    expect(i).toContain('S.browser_fallback_url=' + encodeURIComponent(long + '#via=SIGNAL'))
    expect(i).toContain('#via=SIGNAL#Intent') // fragment stays on the intent path
  })
})

describe('the remembered pending connect', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) } }
  it('is kept and read back; an old one or junk reads as none', () => {
    const s = mem()
    rememberPending(s, { href: 'https://x.example/?connect=a&id=b', name: 'Ada' }, 1000)
    expect(readPending(s, 2000)).toEqual({ href: 'https://x.example/?connect=a&id=b', name: 'Ada', at: 1000 })
    expect(readPending(s, 1000 + PENDING_MAX_MS + 1)).toBeNull()
    s.setItem(PENDING_KEY, '{nope')
    expect(readPending(s, 2000)).toBeNull()
  })
  it('a second link replaces the first', () => {
    const s = mem()
    rememberPending(s, { href: 'https://x.example/?connect=a&id=b', name: 'Ada' }, 1)
    rememberPending(s, { href: 'https://x.example/?connect=c&id=d', name: 'Bo' }, 2)
    expect(readPending(s, 3)?.name).toBe('Bo')
  })
})
