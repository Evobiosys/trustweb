// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Dev-only (wave 30, P2/P5): the taps that bring the app from where it is to the screen or view a catalogue row lives on (its `context`),
 * done before the row's own steps by the Walk card, the ? pointer and the walker; and the feature flags a row can carry ("flag").
 * navPlan, navNote, readFlag and flagSteps are pure; appScreen, appView and runNav read and click the DOM.
 * Tabs are [data-go="<screen>"] (main.ts tabButton), Web's views sit in the eye menu (.view-menu-btn, then .view-opt[data-view]) or as a
 * pinned [data-view-pin], Settings is the header gear [data-settings-gear].
 */
import { S } from './strings'

export interface NavTap { selector: string; label: string; /** Skip this tap when this matches (a pinned view makes the eye unnecessary). */ skipIf?: string }
/** `path` names where the row lives ("Web > Map"), '' when no navigation applies; `reason` says why a context gave no plan. */
export interface NavPlan { taps: NavTap[]; path: string; reason?: string }

type Target = { screen: 'web'; view: 'rings' | 'map' | 'network' } | { screen: 'people' | 'chat' | 'events' | 'inventory' | 'settings' } | { screen: 'panel' }
const TARGETS: Record<string, Target> = {
  web: { screen: 'web', view: 'rings' }, trustzones: { screen: 'web', view: 'rings' }, map: { screen: 'web', view: 'map' }, network: { screen: 'web', view: 'network' },
  people: { screen: 'people' }, chat: { screen: 'chat' }, events: { screen: 'events' }, inventory: { screen: 'inventory' }, settings: { screen: 'settings' }, panel: { screen: 'panel' },
}

const tab = (screen: string): NavTap => ({ selector: `[data-go="${screen}"]`, label: S.tabLabel[screen] })
const pick = (view: string): NavTap[] => [
  { selector: '.view-menu-btn', label: S.viewMenuAria, skipIf: `[data-view-pin="${view}"]` },
  { selector: `[data-view-pin="${view}"], .view-opt[data-view="${view}"]`, label: S.viewNames[view] },
]

/** The taps from `currentScreen` (and, on Web, `currentView`) to the row's `context` ("web", "map", "TrustWeb-Settings", any case). */
export function navPlan(context: string | undefined, currentScreen: string, currentView?: string): NavPlan {
  if (!context?.trim()) return { taps: [], path: '', reason: 'no context on this row' }
  const t = TARGETS[context.trim().toLowerCase().replace(/^trustweb-/, '')] as Target | undefined
  if (!t) return { taps: [], path: '', reason: `"${context}" is not a known view` }
  if (t.screen === 'panel') return { taps: [], path: '' }
  if (t.screen === 'settings') return { taps: currentScreen === 'settings' ? [] : [{ selector: '[data-settings-gear]', label: S.invSettings }], path: S.invSettings }
  if (t.screen === 'chat' || t.screen === 'events' || t.screen === 'inventory') return { taps: currentScreen === t.screen ? [] : [tab(t.screen)], path: S.tabLabel[t.screen] }
  const view = 'view' in t ? t.view : 'people'
  const path = view === 'rings' ? S.tabLabel.web : `${S.tabLabel.web} > ${S.viewNames[view]}`
  if (t.screen === 'people' ? currentScreen === 'people' : currentScreen === 'web' && currentView === view) return { taps: [], path }
  // People carries the same eye; from any other screen the Web tab comes first, and the view is chosen even so (the Web opens on the last one chosen).
  return { taps: [...(currentScreen === 'web' || currentScreen === 'people' ? [] : [tab('web')]), ...pick(view)], path }
}

/** The step card's first line when a navigation tap is missing on this build. */
export const navNote = (plan: NavPlan): string => plan.path ? S.walkNavigateFirst(plan.path) : ''

/** A feature flag is on from the URL (?<name>=1) or from the panel switch (localStorage twp-flag-<name> = '1'). */
export function readFlag(name: string, search: string, storage: Pick<Storage, 'getItem'> | null): boolean {
  if (new URLSearchParams(search).get(name) === '1') return true
  try { return storage?.getItem('twp-flag-' + name) === '1' } catch { return false }
}

/** A flagged row's steps start with the panel switch while the flag is off; once it is on that step is done. */
export function flagSteps(f: { title: string; flag?: string; steps?: string[] }, on: boolean): string[] {
  const steps = f.steps ?? []
  if (!f.flag) return steps
  const sel = `[data-flag-on="${f.flag}"]`
  const rest = steps.filter((s) => !s.endsWith(' @ ' + sel) && !s.endsWith(` @ [data-flag-switch="${f.flag}"]`))
  return on ? rest : [`tap ${S.flagOn(f.title)} @ ${sel}`, ...rest]
}

/** The screen on show: the open Settings sheet, else the class main.ts puts on its screen host ("screen on <screen>"). */
export function appScreen(): string {
  if (document.querySelector('.sheet[data-kind="settings"]:not([inert])')) return 'settings'
  return document.querySelector('.screen.on')?.classList[2] ?? ''
}

/** Web's view on show (network_view .net, map_view .map-svg, else the rings). */
export function appView(): string {
  return document.querySelector('.net[data-view="network"]') ? 'network' : document.querySelector('.map-svg') ? 'map' : 'rings'
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The first visible match of `selector` within `ms`, else null. */
export async function waitVisible(selector: string, ms: number): Promise<HTMLElement | null> {
  for (const end = Date.now() + ms; ; await sleep(100)) {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => e.getClientRects().length > 0)
    if (el || Date.now() > end) return el ?? null
  }
}

/** Do `plan`'s taps with `tap` (false = its element did not show up); true when all were done. */
export async function runNav(plan: NavPlan, tap: (t: NavTap) => Promise<boolean>): Promise<boolean> {
  for (const t of plan.taps) {
    if (t.skipIf && document.querySelector(t.skipIf)) continue
    if (!(await tap(t))) return false
  }
  return true
}

/** The ? pointer's navigation: at once, no glide (it is the way there, not something the reviewer must learn). */
export const quickTap = async (t: NavTap): Promise<boolean> => {
  const el = await waitVisible(t.selector, 1500)
  if (!el) return false
  el.click()
  await sleep(300)
  return true
}
