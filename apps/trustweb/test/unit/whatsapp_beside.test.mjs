// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (whatsapp-desktop): the split-view hint only on desktop Chromium; the desktop deep link only while the tab is open. Pure. */
import { isDesktopChromium, waDesktopLink } from '../../src/ext/whatsapp/window.ts'

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

describe('isDesktopChromium', () => {
  it('uaData: Chromium brand and not mobile', () => {
    expect(isDesktopChromium({ mobile: false, brands: [{ brand: 'Chromium' }] }, CHROME)).toBe(true)
    expect(isDesktopChromium({ mobile: true, brands: [{ brand: 'Chromium' }] }, ANDROID)).toBe(false)
    expect(isDesktopChromium({ mobile: false, brands: [{ brand: 'Not A Brand' }] }, SAFARI)).toBe(false)
  })
  it('without uaData: the user agent decides', () => {
    expect(isDesktopChromium(undefined, CHROME)).toBe(true)
    expect(isDesktopChromium(undefined, SAFARI)).toBe(false)
    expect(isDesktopChromium(undefined, FIREFOX)).toBe(false)
    expect(isDesktopChromium(undefined, ANDROID)).toBe(false)
  })
})

describe('waDesktopLink', () => {
  const wa = 'https://wa.me/436601234567?text=Hi%20Ann!%20Link%3A%20https%3A%2F%2Fx%23a%3D1'
  it('tab open: the same chat on WhatsApp Web, number and text kept', () => {
    const u = new URL(waDesktopLink(wa, true))
    expect(u.origin + u.pathname).toBe('https://web.whatsapp.com/send')
    expect(u.searchParams.get('phone')).toBe('436601234567')
    expect(u.searchParams.get('text')).toBe('Hi Ann! Link: https://x#a=1')
  })
  it('no text: only the phone', () => {
    expect(waDesktopLink('https://wa.me/436601234567', true)).toBe('https://web.whatsapp.com/send?phone=436601234567')
  })
  it('tab not open: wa.me unchanged', () => {
    expect(waDesktopLink(wa, false)).toBe(wa)
  })
  it('links that carry no number stay as they are', () => {
    expect(waDesktopLink('https://wa.me/qr/ABC123', true)).toBe('https://wa.me/qr/ABC123')
    expect(waDesktopLink('https://example.org/', true)).toBe('https://example.org/')
  })
})
