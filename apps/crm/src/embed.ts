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

/** The shell fills the host's screen; its tab bar sits at the bottom of that, the content scrolls above it. */
const EMBED_CSS = `:host{all:initial; display:block; height:100%}
.shell{height:100%; min-height:0; max-width:none; box-shadow:none}
main{overflow-y:auto; padding-bottom:12px}
.privacy{padding-bottom:8px}
.tabbar{position:static; transform:none; max-width:none}`

export async function mountCurator(el: HTMLElement, lent: Omit<Host, 'root'>): Promise<void> {
  Object.assign(host, lent, { root: el })
  const { default: App } = await import('./app.svelte')
  const root = el.attachShadow({ mode: 'open' })
  const target = document.createElement('div')
  target.style.height = '100%'
  root.append(Object.assign(document.createElement('style'), { textContent: EMBED_CSS + asShadowCss(css) }), target)
  mount(App, { target })
}

/** Back on the tab: read the host's record again (Web-view changes show up) and let it win over older ring edits. */
export async function refreshCurator(): Promise<void> {
  (await import('./state.svelte')).reloadRecord()
}
