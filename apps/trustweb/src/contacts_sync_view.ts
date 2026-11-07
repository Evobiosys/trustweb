// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 33: Connect Google (OAuth code + PKCE in this browser, read-only, no server) and "Export my web" (vCard, CSV, JSON). DOM only;
 * the rules are in google_contacts.ts and contacts_export.ts. The token lives in sessionStorage, never in the record or an export.
 */
import { el } from '../../demo/src/ui/dom'
import type { ImportedContact } from '../../crm/src/import/types'
import { toCsv, toJson, toVCard } from './contacts_export'
import { lastContact } from './engagement'
import {
  buildAuthUrl, clearToken, exchangeCode, fetchAllContacts, loadClientId, loadClientSecret, loadToken, makePkce, parseRedirect, revokeToken, saveClientId, saveClientSecret, saveToken,
} from './google_contacts'
import { Ring } from './model'
import type { AppState } from './model'
import type { Pages } from './page_view'
import { S } from './strings'

export interface SyncHooks {
  state: () => AppState
  toast: (msg: string) => void
  pages: Pages
}

const PKCE_KEY = 'tw_google_pkce'
const GOOGLE_PARAMS = ['code', 'state', 'scope', 'authuser', 'prompt', 'error']
const redirectUri = (): string => location.origin + location.pathname
const fetchFn = (url: string, init?: RequestInit) => fetch(url, init)
const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))
const sha256 = async (s: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const store = (): Storage | null => { try { return sessionStorage } catch { return null } }
const local = (): Storage | null => { try { return localStorage } catch { return null } }

/** Settings > import: client id field, Connect / Fetch again / Disconnect. `offer` hands the fetched contacts to the import summary. */
export function googleGroup(offer: (contacts: ImportedContact[]) => void, toast: (msg: string) => void): HTMLElement {
  const box = el('div', { 'data-google-sync': '1' })
  const ss = store()
  const draw = (): void => {
    const clientId = (local() ? loadClientId(local()!) : null) ?? ''
    const token = ss ? loadToken(ss) : null
    const input = el('input', { class: 'field', value: clientId, placeholder: S.googleClientId, 'aria-label': S.googleClientId, 'data-google-clientid': '1', style: 'width:100%;box-sizing:border-box' }) as HTMLInputElement
    input.addEventListener('change', () => { if (local()) saveClientId(local()!, input.value.trim()); draw() })
    const secret = ss ? loadClientSecret(ss) ?? '' : ''
    const secretInput = el('input', { class: 'field', type: 'password', value: secret, placeholder: S.googleClientSecret, 'aria-label': S.googleClientSecret, 'data-google-clientsecret': '1', autocomplete: 'off', style: 'width:100%;box-sizing:border-box' }) as HTMLInputElement
    secretInput.addEventListener('change', () => { if (ss) saveClientSecret(ss, secretInput.value.trim()) })
    const ready = clientId !== ''
    const parts: (Node | null)[] = [
      el('h4', { class: 'eyebrow' }, [S.googleTitle]),
      el('p', { class: 'meta' }, [S.googleHint]),
      el('label', { class: 'meta' }, [S.googleClientId, ' ', input]),
      el('label', { class: 'meta' }, [S.googleClientSecret, ' ', secretInput]),
      el('p', { class: 'meta' }, [S.googleSecretHint]),
      ready ? null : el('p', { class: 'meta', 'data-google-needs-id': '1' }, [S.googleNeedsId, ' ', el('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank', rel: 'noopener', style: 'text-decoration:underline' }, [S.googleGetId])]),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, ([
        el('button', {
          class: 'btn btn-ghost', style: 'text-decoration:underline', 'data-google-connect': '1', 'aria-disabled': String(!ready), ...(ready ? {} : { disabled: true }),
          onclick: () => { void connect(clientId).catch(() => toast(S.googleFailed)) },
        }, [S.googleConnect]),
        token ? el('button', { class: 'btn btn-ghost', style: 'text-decoration:underline', 'data-google-again': '1', onclick: () => { void load(token).then(offer).catch(() => { toast(S.googleFailed) }) } }, [S.googleAgain]) : null,
        token ? el('button', { class: 'btn btn-ghost', style: 'text-decoration:underline', 'data-google-disconnect': '1', onclick: () => { void disconnect(token); draw() } }, [S.googleDisconnect]) : null,
      ] as (Node | null)[]).filter((x): x is Node => x !== null)),
    ]
    box.replaceChildren(...parts.filter((x): x is Node => x !== null))
  }
  draw()
  return box
}

async function connect(clientId: string): Promise<void> {
  const p = await makePkce(randomBytes, sha256)
  store()?.setItem(PKCE_KEY, JSON.stringify({ verifier: p.verifier, state: p.state }))
  location.assign(buildAuthUrl({ clientId, redirectUri: redirectUri(), challenge: p.challenge, state: p.state }))
}

async function load(token: string): Promise<ImportedContact[]> {
  return (await fetchAllContacts(fetchFn, token)).contacts
}

async function disconnect(token: string): Promise<void> {
  const ss = store()
  if (ss) clearToken(ss)
  await revokeToken(fetchFn, token)
}

/** Called once at start: when Google sent the browser back with a code, finish the sign-in and offer the contacts. Cleans only Google's own query parameters. */
export async function resumeGoogle(h: SyncHooks, offer: (contacts: ImportedContact[]) => void): Promise<void> {
  const ss = store()
  const pending = ss?.getItem(PKCE_KEY)
  if (!ss || !pending) return
  const { verifier, state } = JSON.parse(pending) as { verifier: string; state: string }
  const r = parseRedirect(location.href, state)
  if (!r) return
  ss.removeItem(PKCE_KEY)
  const url = new URL(location.href)
  for (const k of GOOGLE_PARAMS) url.searchParams.delete(k)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  if ('error' in r) { h.toast(S.googleFailed); return }
  try {
    const clientId = (local() ? loadClientId(local()!) : null) ?? ''
    const token = await exchangeCode(fetchFn, { clientId, clientSecret: loadClientSecret(ss) ?? '', redirectUri: redirectUri(), code: r.code, verifier })
    saveToken(ss, token)
    offer(await load(token))
  } catch {
    h.toast(S.googleFailed)
  }
}

const FORMATS = [
  { id: 'vcf', label: () => S.exportVcard, mime: 'text/vcard;charset=utf-8', file: 'my-web.vcf', make: toVCard },
  { id: 'csv', label: () => S.exportCsv, mime: 'text/csv;charset=utf-8', file: 'my-web.csv', make: toCsv },
  { id: 'json', label: () => S.exportJson, mime: 'application/json', file: 'my-web.json', make: toJson },
] as const

export function download(name: string, mime: string, text: string): void {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** The entry button (Settings > You, and the import page) that opens the export page. */
export function exportEntry(h: SyncHooks): HTMLElement {
  return el('button', { class: 'conn-row', 'data-export-web': '1', onclick: () => exportPage(h) }, [el('b', {}, [S.exportEntry]), el('em', {}, [S.exportEntryHint])])
}

function exportPage(h: SyncHooks): void {
  const run = (f: (typeof FORMATS)[number]): void => {
    const s = h.state()
    const now = Date.now()
    const people = s.people.filter((p) => p.ring !== Ring.None)
    const text = f.make(people, { now, ringLabel: (r) => S.ringLabel[r], lastContact: (p) => lastContact(s, p, now) || undefined })
    download(f.file, f.mime, text)
    h.toast(S.exportDone(people.length))
  }
  h.pages.open(S.exportEntry, [
    el('p', { class: 'meta' }, [S.exportHint]),
    ...FORMATS.map((f) => el('button', { class: 'btn btn-ghost', style: 'text-decoration:underline', [`data-export-${f.id}`]: '1', onclick: () => run(f) }, [f.label()])),
  ], 'export-web')
}
