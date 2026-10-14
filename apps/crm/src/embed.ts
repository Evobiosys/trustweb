/**
 * The Curator as a tab of another app: its Svelte root inside a shadow root, so its global stylesheet (body, .tab, .btn ...) and
 * the host's cannot touch each other. Loaded lazily by the host (import('@web-curator')); the host record hooks are set before
 * the app's modules load, because the store reads the record when it is first imported.
 */
import { mount } from 'svelte'
import { host } from './bridge'
import type { Host } from './bridge'
import css from './styles.css?inline'

/** The stylesheet was written for a page; in a shadow root :root, html and body become the host element. */
const asShadowCss = (text: string): string => text
  .replace(/:root:not\(\[data-theme="light"\]\)/g, ':host(:not([data-theme="light"]))')
  .replace(/:root\b/g, ':host')
  .replace(/^(html|body)\b/gm, ':host')

/** Applied after the page stylesheet, so its `.tabbar{position:fixed}` cannot pull the tab bar out of the sheet. The shell fills the host's screen; its tab bar sits at the bottom of that, the content scrolls above it. The gear rides on the sheet's × row (the host puts the × at the top right), just left of it. */
const HOST_CSS = ':host{all:initial; display:block; height:100%}'
const EMBED_CSS = `.shell{height:100%; min-height:0; max-width:none; box-shadow:none}
main{overflow-y:auto; padding-bottom:12px}
.privacy{padding-bottom:8px}
.tabbar{position:static; transform:none; max-width:none}
.shell .top{position:relative; padding-top:4px}
.shell .top .gear{position:absolute; top:0; right:92px}`

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
export async function mountCuratorPerson(el: HTMLElement, lent: Omit<Host, 'root'>, personId: string, onclose: () => void): Promise<void> {
  Object.assign(host, lent)
  const [{ default: Person }, { reloadRecord }] = await Promise.all([import('./person.svelte'), import('./state.svelte')])
  reloadRecord()
  const theme = (host.root ?? document.documentElement).dataset.theme
  if (theme) el.dataset.theme = theme
  mount(Person, { target: shadowTarget(el), props: { personId, onclose } })
}

/** Back on the tab: read the host's record again (Web-view changes show up) and let it win over older ring edits. */
export async function refreshCurator(): Promise<void> {
  (await import('./state.svelte')).reloadRecord()
}
