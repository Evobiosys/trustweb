// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { normalizeBaseUrl } from './compose_link'
import { SETTINGS_KEY, instanceHost, mergeSettings, type Settings } from './settings'
import type { Network } from './selectors'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const NAMES: Record<Network, string> = { mastodon: 'Mastodon', x: 'X / Twitter', facebook: 'Facebook', linkedin: 'LinkedIn' }
const PREFIX = 'mastodon-'

async function load(): Promise<Settings> {
  return mergeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY])
}
const save = (s: Settings) => chrome.storage.local.set({ [SETTINGS_KEY]: s })

function item(text: string, buttonCaption?: string, onClick?: () => void): HTMLLIElement {
  const li = document.createElement('li')
  li.append(text)
  if (buttonCaption && onClick) {
    const b = document.createElement('button')
    b.textContent = buttonCaption
    b.addEventListener('click', onClick)
    li.append(' ', b)
  }
  return li
}

async function render(): Promise<void> {
  const s = await load()
  const sites = $('sites')
  sites.replaceChildren()
  for (const n of Object.keys(NAMES) as Network[]) {
    const label = document.createElement('label')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = s.sites[n]
    box.addEventListener('change', async () => save({ ...(await load()), sites: { ...(await load()).sites, [n]: box.checked } }))
    label.append(box, ' ', NAMES[n])
    const li = document.createElement('li')
    li.append(label)
    sites.append(li)
  }
  $<HTMLInputElement>('base').value = s.baseUrl
  const never = $('never')
  never.replaceChildren(...s.never.map((h) => item(h, 'Ask again', async () => {
    const cur = await load()
    await save({ ...cur, never: cur.never.filter((x) => x !== h) })
    void render()
  })))
  const scripts = (await chrome.scripting.getRegisteredContentScripts()).filter((c) => c.id.startsWith(PREFIX))
  $('instances').replaceChildren(...scripts.map((c) => item(c.id.slice(PREFIX.length), 'Remove', async () => {
    await chrome.scripting.unregisterContentScripts({ ids: [c.id] })
    await chrome.permissions.remove({ origins: c.matches })
    void render()
  })))
}

$('save-base').addEventListener('click', async () => {
  const base = normalizeBaseUrl($<HTMLInputElement>('base').value)
  $('base-msg').textContent = base ? 'Saved.' : 'Only https:// addresses, or http://127.0.0.1:<port> for a local preview.'
  if (base) await save({ ...(await load()), baseUrl: base })
  void render()
})

$('add-instance').addEventListener('click', async () => {
  const msg = $('instance-msg')
  const added = (await chrome.scripting.getRegisteredContentScripts()).filter((c) => c.id.startsWith(PREFIX)).map((c) => c.id.slice(PREFIX.length))
  const raw = instanceHost($<HTMLInputElement>('instance').value, added)   // review wave 40: plain host, not built in, not added twice
  if (!raw) { msg.textContent = 'Enter a host name like mastodon.social that is not in the list yet.'; return }
  const matches = [`https://${raw}/*`]
  try {
    if (!(await chrome.permissions.request({ origins: matches }))) { msg.textContent = 'Permission was not granted.'; return }
    await chrome.scripting.registerContentScripts([{ id: PREFIX + raw, matches, js: ['content.js'], runAt: 'document_idle' }])
  } catch { msg.textContent = 'This instance could not be added.'; return }
  msg.textContent = 'Added. Reload the instance tab.'
  void render()
})

void render()
