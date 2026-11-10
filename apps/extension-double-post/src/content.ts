// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Content script. Reads the compose text once, at the moment the user clicks the network's own
// publish button, then lets the click go through untouched. Nothing else on the page is read,
// nothing is sent anywhere; "Yes" opens a TrustWeb tab with the text in the URL fragment.
import { buildComposeLink } from './compose_link'
import { NETWORKS, networkForHost } from './selectors'
import { SETTINGS_KEY, mergeSettings, shouldAsk, type Settings } from './settings'

const host = location.hostname
const network = networkForHost(host)
const sel = NETWORKS[network]
const TOAST_MS = 12000

function composerFor(button: Element): Element | null {
  const q = sel.composer.join(',')
  for (let el: Element | null = button; el; el = el.parentElement) {
    const found = el.querySelector(q)
    if (found) return found
  }
  return null
}

function readText(el: Element): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value
  return (el as HTMLElement).innerText ?? el.textContent ?? ''
}

async function loadSettings(): Promise<Settings> {
  return mergeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY])
}

async function neverOnThisSite(): Promise<void> {
  const s = await loadSettings()
  if (!s.never.includes(host)) await chrome.storage.local.set({ [SETTINGS_KEY]: { ...s, never: [...s.never, host] } })
}

const STYLE = `
:host { all: initial }
.box { position: fixed; z-index: 2147483647; left: 50%; bottom: 20px; transform: translateX(-50%); max-width: calc(100vw - 24px);
  background: #1F2A28; color: #FAFAF7; font: 15px/1.4 system-ui, sans-serif; padding: 12px 16px; border-radius: 10px;
  box-shadow: 0 4px 18px rgba(0,0,0,.35); display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center }
button { all: unset; cursor: pointer; text-decoration: underline; color: #8FD6CF; padding: 2px 0 }
button.yes { color: #FAFAF7; font-weight: 600 }
`

function showPrompt(text: string): void {
  document.getElementById('trustweb-double-post')?.remove()
  const holder = document.createElement('div')
  holder.id = 'trustweb-double-post'
  const root = holder.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLE
  const box = document.createElement('div')
  box.className = 'box'
  box.setAttribute('role', 'status')
  const label = document.createElement('span')
  label.textContent = 'Also post to TrustWeb?'
  const close = () => holder.remove()
  const button = (cls: string, caption: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.className = cls
    b.textContent = caption
    b.addEventListener('click', () => { onClick(); close() })
    return b
  }
  box.append(
    label,
    button('yes', 'Yes', () => {
      void loadSettings().then((s) => {
        const link = buildComposeLink(s.baseUrl, text, network)
        if (link) window.open(link, '_blank', 'noopener')
      })
    }),
    button('', 'Not now', () => {}),
    button('', 'Never on this site', () => { void neverOnThisSite() }),
  )
  root.append(style, box)
  document.documentElement.append(holder)
  setTimeout(close, TOAST_MS)
}

document.addEventListener('click', (ev) => {
  try {
    const button = (ev.target as Element | null)?.closest?.(sel.submit.join(','))
    if (!button) return
    const composer = composerFor(button)
    if (!composer) return
    const text = readText(composer)
    if (!text.trim()) return
    void loadSettings().then((s) => { if (shouldAsk(s, network, host)) showPrompt(text) }).catch(() => {})
  } catch {
    // fail silently: a redesigned site must never break the user's post
  }
}, true)
