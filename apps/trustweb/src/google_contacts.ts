// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Connect Google (wave 33): OAuth 2.0 authorization code + PKCE in the browser, no server.
 * Scope: contacts.readonly only; the owner's contact groups become labels. A client secret is optional (Google web clients usually need it); it stays in this browser tab. Reads contacts through the People API (read-only scopes) into ImportedContact[].
 * Fetch, randomness and hashing are injected, so nothing here touches the DOM or the network
 * by itself. The access token lives in sessionStorage only and never enters the exported record (I1).
 */
import { ContactSource } from '../../crm/src/import/types'
import type { ImportedContact } from '../../crm/src/import/types'

export type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const PEOPLE = 'https://people.googleapis.com/v1'
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly']
const TOKEN_KEY = 'tw_google_token'
const SECRET_KEY = 'tw_google_client_secret'
export const CLIENT_ID_KEY = 'tw_google_client_id'
const FILE = 'Google contacts'

const b64url = (b: Uint8Array): string => {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function makePkce(
  randomBytes: (n: number) => Uint8Array,
  sha256: (s: string) => Promise<Uint8Array>,
): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(await sha256(verifier)), state: b64url(randomBytes(16)) }
}

export function buildAuthUrl(a: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: a.clientId,
    redirect_uri: a.redirectUri,
    scope: SCOPES.join(' '),
    code_challenge: a.challenge,
    code_challenge_method: 'S256',
    state: a.state,
    include_granted_scopes: 'false',
    prompt: 'consent',
  })
  return `${AUTH_URL}?${p}`
}

export function parseRedirect(url: string, expectedState: string): { code: string } | { error: string } | null {
  let q: URLSearchParams
  try { q = new URL(url).searchParams } catch { return null }
  const error = q.get('error')
  const code = q.get('code')
  if (!error && !code) return null
  if (q.get('state') !== expectedState) return { error: 'state' }
  return error ? { error } : { code: code as string }
}

export async function exchangeCode(
  fetchFn: FetchFn,
  a: { clientId: string; clientSecret?: string; redirectUri: string; code: string; verifier: string },
): Promise<string> {
  const r = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: a.clientId,
      redirect_uri: a.redirectUri,
      code: a.code,
      code_verifier: a.verifier,
      ...(a.clientSecret ? { client_secret: a.clientSecret } : {}),
    }).toString(),
  })
  if (!r.ok) throw new Error(`Google token request failed (${r.status})`)
  const token = (await r.json())?.access_token
  if (typeof token !== 'string' || !token) throw new Error('Google sent no access token')
  return token
}

const uniq = (xs: (string | undefined)[], lower = false): string[] => {
  const out: string[] = []
  for (const x of xs) {
    const v = (lower ? x?.toLowerCase() : x)?.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

function birthdayOf(p: any): string | undefined {
  for (const b of p.birthdays ?? []) {
    const { year, month, day } = b?.date ?? {}
    if (!month || !day) continue
    const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return year ? `${year}-${md}` : `--${md}`
  }
  return undefined
}

/** `groupName` turns a contact group resource name (contactGroups/abc) into its label; unknown groups and system groups give undefined. */
export function mapPerson(p: any, file: string, n: number, groupName: (resourceName: string) => string | undefined = () => undefined): ImportedContact | null {
  const emails = uniq((p.emailAddresses ?? []).map((e: any) => e?.value), true)
  const phones = uniq((p.phoneNumbers ?? []).map((e: any) => e?.value))
  const nm = p.names?.[0] ?? {}
  const org = p.organizations?.[0]
  const joined = [nm.givenName, nm.familyName].filter(Boolean).join(' ')
  const name = (nm.displayName || joined || org?.name || emails[0] || phones[0] || '').trim()
  if (!name) return null
  const c: ImportedContact = {
    source: ContactSource.GoogleApi,
    file,
    sourceRef: p.resourceName || `#${n}`,
    name,
    phones,
    emails,
    labels: uniq((p.memberships ?? []).map((m: any) => groupName(m?.contactGroupMembership?.contactGroupResourceName ?? ''))),
  }
  if (nm.givenName) c.given = nm.givenName
  if (nm.familyName) c.family = nm.familyName
  if (org?.name) c.org = org.name
  if (org?.title) c.title = org.title
  const birthday = birthdayOf(p)
  if (birthday) c.birthday = birthday
  const note = p.biographies?.[0]?.value
  if (note) c.note = note
  return c
}

/** Pages through a People API list. Wave 45: also hands back the last page's nextSyncToken; a 410 is Google's "sync token expired, list everything again". */
async function listPages(fetchFn: FetchFn, token: string, base: string, key: string): Promise<{ items: any[]; nextSyncToken?: string }> {
  const items: any[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  do {
    const r = await fetchFn(pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.status === 410) throw new SyncTokenExpired()
    if (!r.ok) throw new Error(`Google contacts request failed (${r.status})`)
    const body = await r.json()
    items.push(...(body?.[key] ?? []))
    pageToken = body?.nextPageToken
    if (typeof body?.nextSyncToken === 'string') nextSyncToken = body.nextSyncToken
  } while (pageToken)
  return { items, ...(nextSyncToken ? { nextSyncToken } : {}) }
}

/** Resource name -> label for the owner's own contact groups; Google's system groups ("My Contacts", "Starred") are no labels. */
async function groupLabels(fetchFn: FetchFn, token: string): Promise<(resourceName: string) => string | undefined> {
  const names = new Map<string, string>()
  try {
    for (const g of (await listPages(fetchFn, token, `${PEOPLE}/contactGroups?groupFields=name&pageSize=1000`, 'contactGroups')).items) {
      if (g?.groupType === 'USER_CONTACT_GROUP' && g.resourceName && (g.formattedName || g.name)) names.set(g.resourceName, g.formattedName || g.name)
    }
  } catch { /* labels are a bonus: the people still come through */ }
  return (r) => names.get(r)
}

export async function fetchAllContacts(fetchFn: FetchFn, token: string): Promise<{ contacts: ImportedContact[] }> {
  return { contacts: (await fetchChanges(fetchFn, token)).contacts }
}

/** Wave 45: Google's sync token is too old; the caller lists everything again (a full resync). */
export class SyncTokenExpired extends Error {
  constructor() { super('Google sync token expired') }
}

/** A Google contact as the sync keeps it: the import shape plus its photo; `deleted` when Google reports it gone (sync runs only). */
export type GContact = ImportedContact & { photo?: string; deleted?: true }

/** The owner's own photo of the contact; Google's generated letter avatar (default: true) is no photo. */
const photoOf = (p: any): string | undefined => (p.photos ?? []).find((x: any) => x?.url && !x.default)?.url

/**
 * Wave 45: without `syncToken` the whole list (the first run, or a full resync), with it only what changed since; either way Google
 * hands back the next sync token. `changes` keeps deleted contacts (flag only, no data); `contacts` is what the import preview takes.
 */
export async function fetchChanges(fetchFn: FetchFn, token: string, syncToken?: string): Promise<{ changes: GContact[]; contacts: ImportedContact[]; nextSyncToken?: string }> {
  const label = await groupLabels(fetchFn, token)
  const q = new URLSearchParams({ personFields: 'names,emailAddresses,phoneNumbers,organizations,birthdays,biographies,memberships,photos', pageSize: '1000', requestSyncToken: 'true', ...(syncToken ? { syncToken } : {}) })
  const { items, nextSyncToken } = await listPages(fetchFn, token, `${PEOPLE}/people/me/connections?${q}`, 'connections')
  const changes: GContact[] = []
  items.forEach((p, i) => {
    if (p?.metadata?.deleted && p.resourceName) { changes.push({ source: ContactSource.GoogleApi, file: FILE, sourceRef: p.resourceName, name: '', phones: [], emails: [], labels: [], deleted: true }); return }
    const c = mapPerson(p, FILE, i, label)
    if (!c) return
    const photo = photoOf(p)
    changes.push(photo ? { ...c, photo } : c)
  })
  return { changes, contacts: changes.filter((c) => !c.deleted).map(({ photo: _p, deleted: _d, ...c }) => c), ...(nextSyncToken ? { nextSyncToken } : {}) }
}

/** Best effort: a failed revoke must never block disconnecting. */
export async function revokeToken(fetchFn: FetchFn, token: string): Promise<void> {
  try {
    // Review wave 40: the token travels in the body, never in the address (proxies and logs keep addresses).
    await fetchFn(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() })
  } catch { /* ignore */ }
}

/** sessionStorage: the token dies with the tab and is never part of the exported record. */
export const saveToken = (s: KeyValueStore, token: string): void => s.setItem(TOKEN_KEY, token)
export const loadToken = (s: KeyValueStore): string | null => s.getItem(TOKEN_KEY)
export const clearToken = (s: KeyValueStore): void => s.removeItem(TOKEN_KEY)
/** localStorage: the owner's own OAuth client id (public value, no secret). */
export const saveClientId = (s: KeyValueStore, id: string): void => s.setItem(CLIENT_ID_KEY, id)
export const loadClientId = (s: KeyValueStore): string | null => s.getItem(CLIENT_ID_KEY)
/** sessionStorage like the token: the optional client secret is never persisted, exported or synced. */
export const saveClientSecret = (s: KeyValueStore, v: string): void => (v ? s.setItem(SECRET_KEY, v) : s.removeItem(SECRET_KEY))
export const loadClientSecret = (s: KeyValueStore): string | null => s.getItem(SECRET_KEY)
