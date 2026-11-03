// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (whatsapp-window): where WhatsApp Web opens beside TrustWeb, what is remembered, reuse and blocked popups. Pure. */
import { WA_NAME, WA_URL, WA_KEY, besideGeometry, featuresString, loadGeometry, saveGeometry, createWindowOpener } from '../../src/ext/whatsapp/window.ts'

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m } }
const host = { screenX: 100, screenY: 40, outerWidth: 900, outerHeight: 700 }

describe('whatsapp window', () => {
  it('opens right of TrustWeb with the same top and height', () => {
    expect(besideGeometry(host)).toEqual({ left: 1000, top: 40, width: 700, height: 700 })
  })
  it('feature string carries the geometry', () => {
    expect(featuresString({ left: 1, top: 2, width: 3, height: 4 })).toBe('popup=yes,left=1,top=2,width=3,height=4')
  })
  it('geometry round-trips through uiWhatsappWindow and rejects junk', () => {
    const s = store()
    expect(loadGeometry(s)).toBeNull()
    saveGeometry(s, { left: 5, top: 6, width: 700, height: 600 })
    expect(WA_KEY).toBe('uiWhatsappWindow')
    expect(loadGeometry(s)).toEqual({ left: 5, top: 6, width: 700, height: 600 })
    s.setItem(WA_KEY, '{"left":"x"}')
    expect(loadGeometry(s)).toBeNull()
    s.setItem(WA_KEY, 'nope')
    expect(loadGeometry(s)).toBeNull()
  })
  it('first open uses the named window and remembers where; the second click reuses it', () => {
    const s = store()
    const w = { closed: false, focus: vi.fn(), location: { href: '' } }
    const open = vi.fn(() => w)
    const o = createWindowOpener({ open, host: () => host, store: s })
    expect(o.open()).toBe('opened')
    expect(open).toHaveBeenCalledWith(WA_URL, WA_NAME, 'popup=yes,left=1000,top=40,width=700,height=700')
    expect(loadGeometry(s)).toEqual({ left: 1000, top: 40, width: 700, height: 700 })
    expect(o.open()).toBe('reused')
    expect(open).toHaveBeenCalledTimes(1)
    expect(w.focus).toHaveBeenCalled()
  })
  it('a person link goes into the same window', () => {
    const w = { closed: false, focus: vi.fn(), location: { href: '' } }
    const o = createWindowOpener({ open: () => w, host: () => host, store: store() })
    o.open()
    expect(o.open('https://wa.me/4366012345')).toBe('reused')
    expect(w.location.href).toBe('https://wa.me/4366012345')
  })
  it('a closed window opens again at the remembered place', () => {
    const s = store()
    saveGeometry(s, { left: 7, top: 8, width: 500, height: 600 })
    const w = { closed: true, focus() {}, location: { href: '' } }
    const open = vi.fn(() => w)
    const o = createWindowOpener({ open, host: () => host, store: s })
    o.open()
    o.open('https://wa.me/1')
    expect(open).toHaveBeenLastCalledWith('https://wa.me/1', WA_NAME, 'popup=yes,left=7,top=8,width=500,height=600')
  })
  it('a blocked popup says so', () => {
    const o = createWindowOpener({ open: () => null, host: () => host, store: store() })
    expect(o.open()).toBe('blocked')
  })
})
