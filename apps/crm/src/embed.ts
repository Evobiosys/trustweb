/**
 * The Curator as a tab of another app: its Svelte root inside a shadow root, so its global stylesheet (body, .tab, .btn ...) and
 * the host's cannot touch each other. Loaded lazily by the host (import('@web-curator')); the host record hooks are set before
 * the app's modules load, because the store reads the record when it is first imported.
 */
import { mount } from 'svelte'
import type { Ring } from '../../trustweb/src/model'
import { host } from './bridge'
import { RING_KEY, ringSyncValue } from './rings'
import type { Host } from './bridge'
import { asShadowCss } from './shadow_css'
import css from './styles.css?inline'

/** Applied after the page stylesheet, so its `.tabbar{position:fixed}` cannot pull the tab bar out of the sheet. The shell fills the host's screen; its tab bar sits at the bottom of that, the content scrolls above it. The header buttons (Timeline, ⋮) ride on the sheet's × row (the host puts the × at the top right), just left of it. */
const HOST_CSS = ':host{all:initial; display:block; height:100%}'
const EMBED_CSS = `.shell{height:100%; min-height:0; max-width:none; box-shadow:none}
main{overflow-y:auto; padding-bottom:12px}
.privacy{padding-bottom:8px}
.tabbar{position:static; transform:none; max-width:none}
.shell{position:relative}
.shell[data-tabbar] main{padding-bottom:12px}
.shell[data-tabbar] .privacy{padding-bottom:8px}
.tabbar[data-mode="hover"]{transform:none; max-height:80px; transition:max-height 180ms ease}
.tabbar[data-mode="hover"]:not(.shown){max-height:0; overflow:hidden; border-top-width:0}
.tabbar-hotzone{position:absolute}
.shell .top{position:relative; padding-top:4px}
.shell .top .top-btns{position:absolute; top:0; right:92px}`

function shadowTarget(el: HTMLElement): HTMLElement {
  const root = el.attachShadow({ mode: 'open' })
  const target = document.createElement('div')
  target.style.height = '100%'
  root.append(Object.assign(document.createElement('style'), { textContent: HOST_CSS + asShadowCss(css) + EMBED_CSS }), target)
  return target
}

export async function mountCurator(el: HTMLElement, lent: Omit<Host, 'root'>): Promise<void> {
  Object.assign(host, lent, { root: el })
  const { default: App } = await import('./app.svelte')
  mount(App, { target: shadowTarget(el) })
}

/** One person's page (the Curator tab's own, same component and CSS) in a fresh element of the host, read from the host's record as it is now. */
export async function mountCuratorPerson(el: HTMLElement, lent: Omit<Host, 'root'>, personId: string, onclose: () => void, embedded = false): Promise<void> {
  Object.assign(host, lent)
  const [{ default: Person }, { reloadRecord }] = await Promise.all([import('./person.svelte'), import('./state.svelte')])
  reloadRecord()
  const theme = (host.root ?? document.documentElement).dataset.theme
  if (theme) el.dataset.theme = theme
  mount(Person, { target: shadowTarget(el), props: { personId, onclose, embedded } })
}

/** A drag out of the Web view's rings: the same "hide in trustweb" as the Curator's own (Tana checkbox through the sync, local removal). */
export async function hideFromRings(lent: Omit<Host, 'root'>, personId: string): Promise<void> {
  Object.assign(host, lent)
  const [{ reloadRecord }, { hideFromTrustweb }] = await Promise.all([import('./state.svelte'), import('./sync.svelte')])
  reloadRecord()
  hideFromTrustweb(personId)
}

/** The Undo of that drag. */
export async function unhideFromRings(lent: Omit<Host, 'root'>, personId: string): Promise<void> {
  Object.assign(host, lent)
  const { unhideInTrustweb } = await import('./sync.svelte')
  unhideInTrustweb(personId)
}

/** A dot dropped on another ring in the Web view: the same Tana ring edit (queue, 2 s debounce, "ring approved") as one made in the Curator. */
export async function ringFromRings(lent: Omit<Host, 'root'>, personId: string, ring: Ring | 'unsorted'): Promise<void> {
  const value = ringSyncValue(ring)
  if (!value) return
  Object.assign(host, lent)
  const [{ reloadRecord }, { saveField }] = await Promise.all([import('./state.svelte'), import('./sync.svelte')])
  reloadRecord()
  saveField(personId, RING_KEY, value)
}

/** Back on the tab: read the host's record again (Web-view changes show up) and let it win over older ring edits. */
export async function refreshCurator(): Promise<void> {
  (await import('./state.svelte')).reloadRecord()
}

/** The host opens the Curator on the Desk (a wide browser tab's default): the face is this device's choice, saved like the chevron's. */
export async function showDesk(): Promise<void> {
  const [{ prefs, savePrefs }, { View }] = await Promise.all([import('./prefs.svelte'), import('./nav')])
  prefs.view = View.Desk
  savePrefs()
}
