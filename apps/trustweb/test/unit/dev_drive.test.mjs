// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31: Walk drives: what the walker does for a step (tap it, navigate first, or point at the bottom bar), and Next/Back. */
import { stepMove, homeButton, driveNext, walkList } from '../../src/dev_drive.ts'
import { navPlan } from '../../src/dev_navigate.ts'

describe('stepMove', () => {
  it('a step without a selector waits for Next on the card', () => {
    expect(stepMove({ text: 'look', selector: null }, false, false, navPlan('chat', 'chat'), 'chat')).toEqual({ kind: 'card' })
  })

  it('a visible target is ringed and tapped', () => {
    expect(stepMove({ text: 'tap ⓘ', selector: '[data-map-credit-toggle]' }, true, false, navPlan('map', 'web', 'map'), 'map')).toEqual({ kind: 'tap', selector: '[data-map-credit-toggle]' })
  })

  it('a missing target on another screen: navigate to the row\'s view first (Web tab, eye, Map)', () => {
    const plan = navPlan('map', 'chat')
    const m = stepMove({ text: 'tap ⓘ', selector: '[data-map-credit-toggle]' }, false, false, plan, 'map')
    expect(m.kind).toBe('nav')
    expect(m.taps.map((t) => t.selector)).toEqual(['[data-go="web"]', '.view-menu-btn', '[data-view-pin="map"], .view-opt[data-view="map"]'])
  })

  it('still missing after the navigation: the ring goes to the bottom-bar button and the card says where to go', () => {
    const plan = navPlan('map', 'chat')
    expect(stepMove({ text: 'tap ⓘ', selector: '[data-map-credit-toggle]' }, false, true, plan, 'map')).toEqual({ kind: 'missing', ring: '[data-go="web"]', note: 'navigate to Web > Map first' })
  })

  it('missing although on the right screen already: the ring goes to the row\'s own tab', () => {
    expect(stepMove({ text: 'x', selector: '.gone' }, false, false, navPlan('chat', 'chat'), 'chat')).toEqual({ kind: 'missing', ring: '[data-go="chat"]', note: 'navigate to Chat first' })
  })

  it('a row without a known view: no ring, the card names the missing step', () => {
    expect(stepMove({ text: 'tap the bell', selector: '.bell' }, false, false, navPlan('Desk > Map', 'web', 'rings'), 'Desk > Map')).toEqual({ kind: 'missing', ring: null, note: 'not on this screen: tap the bell' })
  })
})

describe('homeButton', () => {
  it('names the bottom-bar button of the row\'s screen', () => {
    expect(homeButton('map')).toBe('[data-go="web"]')
    expect(homeButton('people')).toBe('[data-go="web"]')
    expect(homeButton('TrustWeb-Chat')).toBe('[data-go="chat"]')
    expect(homeButton('settings')).toBe('[data-settings-gear]')
    expect(homeButton('panel')).toBe(null)
    expect(homeButton('sentence')).toBe(null)
  })
})

describe('driveNext', () => {
  const s = { at: 0, auto: true }
  it('a done step moves on, never past the end', () => {
    expect(driveNext(s, 'done', 3)).toEqual({ at: 1, auto: true })
    expect(driveNext({ at: 3, auto: true }, 'done', 3)).toEqual({ at: 3, auto: true })
  })
  it('Next does the current step now and goes on driving', () => {
    expect(driveNext({ at: 1, auto: false }, 'next', 3)).toEqual({ at: 1, auto: true })
  })
  it('Back goes one step back and pauses, so Next does it again', () => {
    expect(driveNext({ at: 2, auto: true }, 'back', 3)).toEqual({ at: 1, auto: false })
    expect(driveNext({ at: 0, auto: true }, 'back', 3)).toEqual({ at: 0, auto: false })
  })
  it('a stuck step pauses the drive', () => {
    expect(driveNext({ at: 1, auto: true }, 'stuck', 3)).toEqual({ at: 1, auto: false })
  })
})

describe('walkList', () => {
  it('ends on the feature itself (pointed at, not tapped) unless the last step points at it already', () => {
    expect(walkList(['tap Chat @ [data-go="chat"]'], 'Chat title', '.hdr h2')).toEqual(['tap Chat @ [data-go="chat"]', 'Chat title @ .hdr h2'])
    expect(walkList(['tap ⓘ @ [data-map-credit-toggle]'], 'Credit', '[data-map-credit-toggle]')).toEqual(['tap ⓘ @ [data-map-credit-toggle]'])
    expect(walkList(['look @ .hdr h2'], 'Chat title', '.hdr h2')).toEqual(['look @ .hdr h2'])
    expect(walkList(['a @ .x'], 'T')).toEqual(['a @ .x', 'T'])
  })
})
