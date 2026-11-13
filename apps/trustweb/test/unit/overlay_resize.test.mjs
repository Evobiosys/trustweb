// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 web-zoom-dots (H3): the resize maths read the zoom scale at every use, not the one captured when the card opened. */
import { makeResizable } from '../../src/overlay_resize.ts'

const node = (extra = {}) => ({ style: {}, className: '', listeners: {}, children: [], setAttribute() {}, appendChild(c) { this.children.push(c) }, addEventListener(t, f) { this.listeners[t] = f }, removeEventListener() {}, setPointerCapture() {}, ...extra })
describe('makeResizable scale getter', () => {
  it('re-reads the scale on every drag step', () => {
    globalThis.document = { createElement: () => node(), createTextNode: (t) => ({ t }), documentElement: { clientWidth: 2000 } }
    globalThis.window = { innerHeight: 2000 }
    let scale = 1
    const card = node({ offsetWidth: 200, offsetHeight: 120, getBoundingClientRect: () => ({ left: 0, top: 0 }) })
    const store = { getItem: () => null, setItem() {} }
    makeResizable(card, 'friend', () => scale, store)
    const grip = card.children[0]
    grip.listeners.pointerdown({ preventDefault() {}, stopPropagation() {}, pointerId: 1, clientX: 0, clientY: 0 })
    grip.listeners.pointermove({ clientX: 40, clientY: 0 })
    expect(card.style.width).toBe('240px')
    scale = 2   // the user zoomed in mid-drag: 40 screen px are now 20 layout px
    grip.listeners.pointermove({ clientX: 40, clientY: 0 })
    expect(card.style.width).toBe('220px')
  })
})
