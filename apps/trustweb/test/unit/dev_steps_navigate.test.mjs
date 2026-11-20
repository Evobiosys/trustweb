// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// @vitest-environment jsdom
/** Wave 45 walkthrough-navigate: the ? step card goes to the row's view by itself when a step's target is not on this screen. */
import { createSteps } from '../../src/dev_steps.ts'

const flush = (ms = 700) => new Promise((r) => setTimeout(r, ms))
const page = (screen) => {
  if (!document.getElementById('app')) document.body.appendChild(Object.assign(document.createElement('div'), { id: 'app' }))
  document.getElementById('app').innerHTML = screen === 'web'
    ? '<div class="screen on web"></div><button data-go="chat">Chat</button>'
    : '<div class="screen on chat"><i class="target"></i></div><button data-go="chat">Chat</button>'
  document.querySelector('[data-go="chat"]').addEventListener('click', () => page('chat'))
}

describe('? steps navigate', () => {
  beforeEach(() => {
    Element.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [{}] : [] }
    Element.prototype.scrollIntoView = () => {}
    page('web')
  })

  it('Next to a step whose target lives on another screen taps the tab first, then rings the target (no "navigate first" note)', async () => {
    const rung = []
    const pointer = { set: (s) => { rung.push(s); return !!(s && document.querySelector(s)) }, update() {} }
    const steps = createSteps(pointer, () => {})
    await steps.open(['look', 'the thing @ .target'], 'chat')
    await flush()
    page('web')   // the reviewer wandered off
    ;[...document.querySelectorAll('.twp-step button')].find((b) => b.textContent === 'Next').click()
    await flush()
    expect(document.querySelector('.screen.on.chat')).not.toBeNull()
    expect(rung.at(-1)).toBe('.target')
    expect(document.querySelector('.twp-step').textContent).not.toMatch(/navigate to/)
    steps.close()
  })
})
