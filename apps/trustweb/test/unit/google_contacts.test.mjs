// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Connect Google (src/google_contacts.ts): OAuth code + PKCE in the browser, People API read-only.
 * Fetch, randomness and hashing are injected; all data synthetic (example.at).
 */
import { createHash } from 'node:crypto'
import {
  buildAuthUrl, clearToken, exchangeCode, fetchAllContacts, loadClientId, loadClientSecret, saveClientSecret, loadToken,
  makePkce, mapPerson, parseRedirect, revokeToken, saveClientId, saveToken,
} from '../../src/google_contacts.ts'

const sha256 = async (s) => new Uint8Array(createHash('sha256').update(s).digest())
const b64url = (b) => Buffer.from(b).toString('base64url')

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const memStore = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), m }
}

describe('makePkce', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    const verifierBytes = new Uint8Array(Buffer.from('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'base64url'))
    const p = await makePkce(() => verifierBytes, async (s) => {
      expect(s).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
      return sha256(s)
    })
    expect(p.challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('makes a 43..128 char unreserved verifier, S256 challenge and a state', async () => {
    const p = await makePkce((n) => new Uint8Array(n).map((_, i) => i * 7 + 1), sha256)
    expect(p.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(p.challenge).toBe(b64url(createHash('sha256').update(p.verifier).digest()))
    expect(p.state.length).toBeGreaterThan(10)
  })
})

describe('buildAuthUrl', () => {
  const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://app.example.at/', challenge: 'CH', state: 'ST' }))
  it('targets Google with code + PKCE parameters', () => {
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = u.searchParams
    expect(p.get('response_type')).toBe('code')
    expect(p.get('client_id')).toBe('cid')
    expect(p.get('redirect_uri')).toBe('https://app.example.at/')
    expect(p.get('code_challenge')).toBe('CH')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('state')).toBe('ST')
    expect(p.get('include_granted_scopes')).toBe('false')
    expect(p.get('prompt')).toBe('consent')
  })
  it('asks for the one read scope contacts.readonly and never a write scope', () => {
    const scopes = u.searchParams.get('scope').split(' ')
    expect(scopes).toEqual(['https://www.googleapis.com/auth/contacts.readonly'])
    expect(u.search).not.toMatch(/auth\/contacts(%20|&|$)/)
  })
})

describe('parseRedirect', () => {
  it('returns the code when state matches', () => {
    expect(parseRedirect('https://app.example.at/?code=abc&state=S', 'S')).toEqual({ code: 'abc' })
  })
  it('flags a state mismatch', () => {
    expect(parseRedirect('https://app.example.at/?code=abc&state=X', 'S')).toEqual({ error: 'state' })
  })
  it('passes Google errors on', () => {
    expect(parseRedirect('https://app.example.at/?error=access_denied&state=S', 'S')).toEqual({ error: 'access_denied' })
  })
  it('returns null without code or error', () => {
    expect(parseRedirect('https://app.example.at/', 'S')).toBeNull()
    expect(parseRedirect('not a url', 'S')).toBeNull()
  })
})

describe('exchangeCode', () => {
  const args = { clientId: 'cid', redirectUri: 'https://app.example.at/', code: 'abc', verifier: 'ver' }
  it('posts a form and returns the access token only', async () => {
    let seen
    const f = async (url, init) => { seen = { url, init }; return res(200, { access_token: 'tok', refresh_token: 'r' }) }
    expect(await exchangeCode(f, args)).toBe('tok')
    expect(seen.url).toBe('https://oauth2.googleapis.com/token')
    expect(seen.init.method).toBe('POST')
    const body = new URLSearchParams(String(seen.init.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('abc')
    expect(body.get('code_verifier')).toBe('ver')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('client_secret')).toBeNull()
  })
  it('P4: sends client_secret only when one is set', async () => {
    let body
    const f = async (_u, init) => { body = new URLSearchParams(String(init.body)); return res(200, { access_token: 'tok' }) }
    await exchangeCode(f, { ...args, clientSecret: 'sec' })
    expect(body.get('client_secret')).toBe('sec')
    await exchangeCode(f, { ...args, clientSecret: '' })
    expect(body.get('client_secret')).toBeNull()
  })
  it('throws a plain Error on failure', async () => {
    await expect(exchangeCode(async () => res(400, { error: 'invalid_grant' }), args)).rejects.toThrow(Error)
    await expect(exchangeCode(async () => res(200, {}), args)).rejects.toThrow(Error)
  })
})

describe('fetchAllContacts', () => {
  const person = (n, extra = {}) => ({ resourceName: `people/c${n}`, names: [{ displayName: `Anna ${n}` }], ...extra })
  const member = (id) => ({ contactGroupMembership: { contactGroupId: id, contactGroupResourceName: `contactGroups/${id}` } })
  const groups = { contactGroups: [
    { resourceName: 'contactGroups/myContacts', groupType: 'SYSTEM_CONTACT_GROUP', name: 'myContacts', formattedName: 'My Contacts' },
    { resourceName: 'contactGroups/starred', groupType: 'SYSTEM_CONTACT_GROUP', name: 'starred', formattedName: 'Starred' },
    { resourceName: 'contactGroups/fam', groupType: 'USER_CONTACT_GROUP', name: 'Family', formattedName: 'Family' },
    { resourceName: 'contactGroups/work', groupType: 'USER_CONTACT_GROUP', name: 'Work', formattedName: 'Work' },
  ] }
  it('pages connections with a bearer header and reads no other contacts', async () => {
    const calls = []
    const f = async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization })
      const u = new URL(url)
      if (u.pathname === '/v1/contactGroups') return res(200, groups)
      return u.searchParams.get('pageToken')
        ? res(200, { connections: [person(2)] })
        : res(200, { connections: [person(1)], nextPageToken: 'P2' })
    }
    const r = await fetchAllContacts(f, 'tok')
    expect(r.contacts.map((c) => c.sourceRef)).toEqual(['people/c1', 'people/c2'])
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true)
    expect(calls.some((c) => c.url.includes('otherContacts'))).toBe(false)
    const first = new URL(calls.find((c) => c.url.includes('/people/me/connections')).url)
    expect(first.searchParams.get('personFields')).toBe('names,emailAddresses,phoneNumbers,organizations,birthdays,biographies,memberships')
    expect(first.searchParams.get('pageSize')).toBe('1000')
  })
  it('turns contact groups into labels and leaves out Google system groups', async () => {
    const f = async (url) => {
      if (new URL(url).pathname === '/v1/contactGroups') return res(200, groups)
      return res(200, { connections: [person(1, { memberships: [member('myContacts'), member('fam'), member('work'), member('starred')] }), person(2, { memberships: [member('gone')] })] })
    }
    const r = await fetchAllContacts(f, 'tok')
    expect(r.contacts[0].labels).toEqual(['Family', 'Work'])
    expect(r.contacts[1].labels).toEqual([])
  })
  it('pages the contact groups too', async () => {
    const f = async (url) => {
      const u = new URL(url)
      if (u.pathname !== '/v1/contactGroups') return res(200, { connections: [person(1, { memberships: [member('fam'), member('work')] })] })
      return u.searchParams.get('pageToken') ? res(200, { contactGroups: [groups.contactGroups[3]] }) : res(200, { contactGroups: [groups.contactGroups[2]], nextPageToken: 'G2' })
    }
    expect((await fetchAllContacts(f, 'tok')).contacts[0].labels).toEqual(['Family', 'Work'])
  })
  it('still returns the people when the groups cannot be read', async () => {
    const f = async (url) => (url.includes('/contactGroups') ? res(403, {}) : res(200, { connections: [person(1, { memberships: [member('fam')] })] }))
    const r = await fetchAllContacts(f, 'tok')
    expect(r.contacts).toHaveLength(1)
    expect(r.contacts[0].labels).toEqual([])
  })
  it('fails when the connections call fails', async () => {
    await expect(fetchAllContacts(async (u) => (u.includes('/contactGroups') ? res(200, groups) : res(401, {})), 'tok')).rejects.toThrow(Error)
  })
  it('handles an empty account', async () => {
    const r = await fetchAllContacts(async () => res(200, {}), 'tok')
    expect(r).toEqual({ contacts: [] })
  })
})

describe('mapPerson', () => {
  it('maps a full person', () => {
    const c = mapPerson({
      resourceName: 'people/c9',
      names: [{ displayName: 'Anna Beispiel', givenName: 'Anna', familyName: 'Beispiel' }],
      emailAddresses: [{ value: 'Anna@Example.at' }, { value: 'anna@example.at' }],
      phoneNumbers: [{ value: '+43 1 234' }, { value: '+43 1 234' }],
      organizations: [{ name: 'Example GmbH', title: 'Dev' }],
      birthdays: [{ date: { year: 1990, month: 3, day: 7 } }],
      biographies: [{ value: 'Met at a fair' }],
      memberships: [{ contactGroupMembership: { contactGroupResourceName: 'contactGroups/abc' } }, { contactGroupMembership: { contactGroupResourceName: 'contactGroups/zzz' } }],
    }, 'Google contacts', 3, (r) => ({ 'contactGroups/abc': 'Family' })[r])
    expect(c).toEqual({
      source: 'google-api', file: 'Google contacts', sourceRef: 'people/c9', name: 'Anna Beispiel',
      given: 'Anna', family: 'Beispiel', emails: ['anna@example.at'], phones: ['+43 1 234'],
      org: 'Example GmbH', title: 'Dev', birthday: '1990-03-07', note: 'Met at a fair', labels: ['Family'],
    })
  })
  it('writes a yearless birthday as --MM-DD', () => {
    const c = mapPerson({ resourceName: 'p', names: [{ displayName: 'B' }], birthdays: [{ date: { month: 12, day: 5 } }] }, 'f', 0)
    expect(c.birthday).toBe('--12-05')
  })
  it('falls back for the name', () => {
    expect(mapPerson({ resourceName: 'p', names: [{ givenName: 'A', familyName: 'B' }] }, 'f', 0).name).toBe('A B')
    expect(mapPerson({ resourceName: 'p', organizations: [{ name: 'Org' }] }, 'f', 0).name).toBe('Org')
    expect(mapPerson({ resourceName: 'p', emailAddresses: [{ value: 'X@example.at' }] }, 'f', 0).name).toBe('x@example.at')
    expect(mapPerson({ resourceName: 'p', phoneNumbers: [{ value: '123' }] }, 'f', 0).name).toBe('123')
  })
  it('returns null for an empty person and falls back to the position as ref', () => {
    expect(mapPerson({ resourceName: 'p' }, 'f', 0)).toBeNull()
    expect(mapPerson({ names: [{ displayName: 'Z' }] }, 'f', 4).sourceRef).toBe('#4')
  })
})

describe('revokeToken', () => {
  it('posts to the revoke endpoint', async () => {
    let url
    await revokeToken(async (u) => { url = u; return res(200, {}) }, 'a b')
    expect(url).toBe('https://oauth2.googleapis.com/revoke?token=a%20b')
  })
  it('never throws', async () => {
    await expect(revokeToken(async () => { throw new Error('offline') }, 't')).resolves.toBeUndefined()
  })
})

describe('storage helpers', () => {
  it('round-trips and clears the token', () => {
    const s = memStore()
    expect(loadToken(s)).toBeNull()
    saveToken(s, 'tok')
    expect(s.m.get('tw_google_token')).toBe('tok')
    expect(loadToken(s)).toBe('tok')
    clearToken(s)
    expect(loadToken(s)).toBeNull()
  })
  it('round-trips the client id under its own key', () => {
    const s = memStore()
    saveClientId(s, 'cid')
    expect(s.m.get('tw_google_client_id')).toBe('cid')
    expect(loadClientId(s)).toBe('cid')
  })
})

describe('P4: client secret store', () => {
  it('lives in the session store next to the token, not with the client id', () => {
    const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
    const s = mem()
    saveClientSecret(s, 'sec')
    expect(loadClientSecret(s)).toBe('sec')
    expect(loadClientSecret(mem())).toBeNull()
  })
})
