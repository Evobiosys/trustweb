/** Wave 19 desk-fork (Jakob 2026-10-23): Dex = vanilla Desk, TrustWeb Desk = our fork (no Reminders/Keep in touch, Home = Web); sidebar groups; Getting started dismiss. */
import { describe, expect, it } from 'vitest'
import { deskPages, deskStartPage, isDesk, shownGroups, startShown, viewOf } from '../../src/desk'
import { DeskPage, View } from '../../src/nav'
import { S } from '../../src/strings'
import { viewNotifier } from '../../src/view_notify'
import { viewChoices, viewLabel } from '../../src/view_pick'

const files = import.meta.glob(['../../src/*.svelte'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const src = (f: string): string => files[`../../src/${f}`] ?? ''
const noop = (): void => {}

describe('the view enum', () => {
  it('a saved desk from before is the TrustWeb Desk; dex is Dex; anything else Classic', () => {
    expect(viewOf('desk')).toBe(View.Desk)
    expect(viewOf('dex')).toBe(View.Dex)
    expect(viewOf('x')).toBe(View.Classic)
  })
  it('both Desks are a Desk face', () => {
    expect([View.Dex, View.Desk, View.Classic, View.TrustWeb].map(isDesk)).toEqual([true, true, false, false])
  })
  it('four choices inside TrustWeb, in order, one naming', () => {
    expect(viewChoices({ showPhoneVersion: noop })).toEqual([View.Dex, View.Desk, View.Classic, View.TrustWeb])
    expect(viewChoices({ showPhoneVersion: noop }).map(viewLabel)).toEqual(['Dex', 'TrustWeb Desk', 'Contacts', 'TrustWeb'])
    expect(S.views).toMatchObject({ dexInfo: 'Dex-inspired', deskInfo: 'Our take on Dex' })
  })
  it('the host hears desk for either Desk', () => {
    const seen: string[] = []
    const notify = viewNotifier((f) => seen.push(f))
    for (const v of [View.Dex, View.Desk, View.Classic, View.Desk]) notify(v)
    expect(seen).toEqual(['desk', 'classic', 'desk'])
  })
})

describe('sidebar per variant', () => {
  it('Dex: every page as it is', () => {
    expect(deskPages(View.Dex).map((p) => p.page)).toEqual([DeskPage.Home, DeskPage.Web, DeskPage.Reminders, DeskPage.Contacts, DeskPage.KeepInTouch, DeskPage.Timeline, DeskPage.Map])
  })
  it('TrustWeb Desk: Home is the Web page with the rings icon; no Reminders, no Keep in touch', () => {
    const pages = deskPages(View.Desk)
    expect(pages.map((p) => p.page)).toEqual([DeskPage.Web, DeskPage.Contacts, DeskPage.Timeline, DeskPage.Map])
    expect(pages[0]).toMatchObject({ icon: 'web', label: S.desk.nav.home })
  })
  it('the bell only where Reminders are listed', () => expect(src('desk_topbar.svelte')).toContain('{#if reminders}'))
})

describe('deskStartPage', () => {
  it('TrustWeb Desk always opens on the Web page', () => {
    expect(deskStartPage(View.Desk, 0, false)).toBe(DeskPage.Web)
    expect(deskStartPage(View.Desk, 3, true)).toBe(DeskPage.Web)
  })
  it('Dex as before', () => {
    expect(deskStartPage(View.Dex, 3, true)).toBe(DeskPage.Web)
    expect(deskStartPage(View.Dex, 0, true)).toBe(DeskPage.Home)
  })
})

describe('sidebar groups', () => {
  it('a group with nobody in it is not listed', () => {
    expect(shownGroups([{ count: 9, id: 'family' }, { count: 0, id: 'matrix' }])).toEqual([{ count: 9, id: 'family' }])
  })
  it('Groups is a disclosure, folded by default, remembered', () => {
    expect(src('desk_sidebar.svelte')).toMatch(/aria-expanded=\{!prefs\.sidebarGroupsFolded\}/)
  })
})

describe('Getting started', () => {
  it('shows while steps remain and it was not dismissed', () => {
    const steps = [{ done: true }, { done: false }]
    expect(startShown(steps, false)).toBe(true)
    expect(startShown(steps, true)).toBe(false)
    expect(startShown([{ done: true }], false)).toBe(false)
  })
  it('an × dismisses it; Settings brings it back', () => {
    expect(src('desk_start.svelte')).toContain('data-action="dismiss-start"')
    expect(src('settings.svelte')).toContain('data-action="show-start"')
  })
  it('the map card has an × (data-hint-dismiss); Settings > Advanced "Show hints again" brings it back', () => {
    expect(src('desk.svelte')).toContain('data-hint-dismiss')
    expect(src('desk.svelte')).toContain('prefs.mapCardDismissed')
    expect(src('settings.svelte')).toContain('data-hints-reset')
    expect(src('settings.svelte')).toContain('mapCardDismissed = false')
  })
})
