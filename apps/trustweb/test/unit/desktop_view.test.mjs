/** Wave 18: which face a device opens on (src/desktop_view.ts): the Desk on a wide browser tab unless the device chose the phone version. */
import { readFileSync } from 'node:fs'
import { UI_VIEWS, UiView, desktopView, wideAllowed } from '../../src/desktop_view.ts'
import { S } from '../../src/strings.ts'

describe('desktopView', () => {
  it('absent choice on a wide browser tab -> desk', () => expect(desktopView(null, true, false, false)).toBe('desk'))
  it("stored 'desk' -> desk", () => expect(desktopView('desk', true, false, false)).toBe('desk'))
  it("stored 'phone' -> phone", () => expect(desktopView('phone', true, false, false)).toBe('phone'))
  it('garbage stored value reads as absent', () => expect(desktopView('x', true, false, false)).toBe('desk'))
  it('embedded frame -> phone', () => expect(desktopView(null, true, true, false)).toBe('phone'))
  it('installed app -> phone', () => expect(desktopView('desk', true, false, true)).toBe('phone'))
  it('narrow viewport -> phone', () => expect(desktopView('desk', false, false, false)).toBe('phone'))
})

describe('wideAllowed', () => {
  it('choice desk on a wide browser tab -> allowed', () => expect(wideAllowed('desk', true, false, false)).toBe(true))
  it('absent choice -> allowed', () => expect(wideAllowed(null, true, false, false)).toBe(true))
  it("choice 'phone' -> the sheet stays in the phone", () => expect(wideAllowed('phone', true, false, false)).toBe(false))
  it('embedded or installed or narrow -> not allowed', () => {
    expect(wideAllowed('desk', true, true, false)).toBe(false)
    expect(wideAllowed('desk', true, false, true)).toBe(false)
    expect(wideAllowed('desk', false, false, false)).toBe(false)
  })
})

/** Wave 19 (Jakob 2026-10-23): Settings > View, the three views; the bottom-left pill only under Settings > View. */

describe('views', () => {
  it('Dex, Classic, TrustWeb, in that order, one naming', () => {
    expect(UI_VIEWS).toEqual([UiView.Dex, UiView.Classic, UiView.TrustWeb])
    expect(UI_VIEWS.map((v) => S.views[v])).toEqual(['Dex', 'Classic', 'TrustWeb'])
  })
  it('the phone Settings has the View row; the bottom-left desk pill is never shown', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    expect(main).toMatch(/const DESK_PILL_SHOWN = false/)
    expect(main).toMatch(/settingsSheet[\s\S]*viewRow\(\)/)
  })
})
