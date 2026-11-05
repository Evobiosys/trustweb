// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (whatsapp-desktop): WhatsApp Web as a named tab of the same window, reuse, close, split via the review extension. Pure. */
import { WA_NAME, WA_URL, createWindowOpener, loadBeside, saveBeside } from '../../src/ext/whatsapp/window.ts'

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m } }
const tab = () => ({ closed: false, focus: vi.fn(), close: vi.fn(), location: { href: '' } })
const deps = (o) => ({ open: () => tab(), ext: () => false, split: vi.fn(), beside: () => true, ...o })

describe('whatsapp tab', () => {
  it('opens the named target with no feature string; the second click reuses and focuses it', () => {
    const t = tab(); const open = vi.fn(() => t)
    const o = createWindowOpener(deps({ open }))
    expect(o.open()).toBe('opened')
    expect(open).toHaveBeenCalledWith(WA_URL, WA_NAME)
    expect(WA_NAME).toBe('tw-whatsapp')
    expect(o.isOpen()).toBe(true)
    expect(o.open()).toBe('reused')
    expect(open).toHaveBeenCalledTimes(1)
    expect(t.focus).toHaveBeenCalled()
  })
  it('a link goes into the same tab; a closed tab opens again', () => {
    const t = tab(); const open = vi.fn(() => t)
    const o = createWindowOpener(deps({ open }))
    o.open()
    expect(o.open('https://web.whatsapp.com/send?phone=1')).toBe('reused')
    expect(t.location.href).toBe('https://web.whatsapp.com/send?phone=1')
    t.closed = true
    expect(o.isOpen()).toBe(false)
    o.open('https://wa.me/1')
    expect(open).toHaveBeenLastCalledWith('https://wa.me/1', WA_NAME)
  })
  it('a blocked tab says so', () => {
    expect(createWindowOpener(deps({ open: () => null })).open()).toBe('blocked')
  })
  it('close closes only the remembered open handle', () => {
    const t = tab()
    const o = createWindowOpener(deps({ open: () => t }))
    o.close()
    expect(t.close).not.toHaveBeenCalled()
    o.open(); o.close()
    expect(t.close).toHaveBeenCalledTimes(1)
    const gone = tab(); gone.closed = true
    const o2 = createWindowOpener(deps({ open: () => gone }))
    o2.open(); o2.close()
    expect(gone.close).not.toHaveBeenCalled()
  })
  it('with the review extension and Side by side on, the page asks the extension instead of window.open', () => {
    const open = vi.fn(); const split = vi.fn()
    const o = createWindowOpener(deps({ open, split, ext: () => true }))
    expect(o.open()).toBe('opened')
    expect(split).toHaveBeenCalledWith(WA_URL)
    expect(open).not.toHaveBeenCalled()
    expect(o.isOpen()).toBe(true)
    expect(o.open('https://web.whatsapp.com/send?phone=1')).toBe('reused')
    expect(split).toHaveBeenLastCalledWith('https://web.whatsapp.com/send?phone=1')
  })
  it('Side by side off: the extension is not used', () => {
    const open = vi.fn(() => tab()); const split = vi.fn()
    createWindowOpener(deps({ open, split, ext: () => true, beside: () => false })).open()
    expect(split).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalled()
  })
  it('Side by side defaults on and is remembered', () => {
    const s = store()
    expect(loadBeside(s)).toBe(true)
    saveBeside(s, false)
    expect(loadBeside(s)).toBe(false)
    saveBeside(s, true)
    expect(loadBeside(s)).toBe(true)
  })
})
