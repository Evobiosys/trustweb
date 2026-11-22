// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 google-contacts-sync: incremental People API sync (syncToken) against a fake People API, the conflict rule
 * (TrustWeb wins on fields the owner edited, Google wins otherwise), the switch GOOGLE_CONTACTS_SYNC_ENABLED. Synthetic data only (example.at).
 */
import { fetchChanges, SyncTokenExpired } from '../../src/google_contacts.ts'
import { AUTO_SYNC_MS, GOOGLE_CONTACTS_SYNC_ENABLED, autoSyncDue, googleKey, reconcile, setSyncOn, waitingContacts } from '../../src/google_sync.ts'
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'
import { planServices } from '../../src/services_import.ts'
import { snapOf } from '../../src/import_tags.ts'

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const NOW = Date.parse('2026-11-20T10:00:00Z')
const tagOf = (l) => `tag-${l.toLowerCase()}`
const G = (n, over = {}) => ({ source: 'google-api', file: 'Google contacts', sourceRef: `people/c${n}`, name: `Anna ${n}`, emails: [`anna${n}@example.at`], phones: ['+43 660 1110001'], labels: [], ...over })
const linked = (id, n, over = {}) => ({ id, name: `Anna ${n}`, context: '', ring: 'friend', metAt: 1, lines: [], sources: [{ source: 'google-api', file: 'Google contacts', importedAt: 1, key: googleKey(`people/c${n}`) }], ...over })
const state = (people, gs) => ({ people, ...(gs ? { googleSync: gs } : {}) })

describe('GOOGLE_CONTACTS_SYNC_ENABLED (external: TrustWeb has no Google OAuth client id yet)', () => {
  it('is off', () => expect(GOOGLE_CONTACTS_SYNC_ENABLED).toBe(false))
  it('the automatic sync runs only with the switch, a token, the owner\'s yes and the interval passed', () => {
    const gs = { on: true, seen: {}, base: {}, last: { at: NOW - AUTO_SYNC_MS, updated: 0, kept: 0, fresh: 0, gone: 0 } }
    expect(autoSyncDue(true, gs, 'tok', NOW)).toBe(true)
    expect(autoSyncDue(false, gs, 'tok', NOW)).toBe(false)
    expect(autoSyncDue(true, gs, null, NOW)).toBe(false)
    expect(autoSyncDue(true, { ...gs, on: false }, 'tok', NOW)).toBe(false)
    expect(autoSyncDue(true, undefined, 'tok', NOW)).toBe(false)
    expect(autoSyncDue(true, gs, 'tok', NOW - 1)).toBe(false)
    expect(autoSyncDue(true, { on: true, seen: {}, base: {} }, 'tok', NOW)).toBe(true)
  })
  it('setSyncOn keeps the owner\'s choice in the record', () => {
    const s = state([])
    setSyncOn(s, true)
    expect(s.googleSync.on).toBe(true)
    setSyncOn(s, false)
    expect(s.googleSync.on).toBe(false)
  })
})

describe('fetchChanges (fake People API)', () => {
  const groups = { contactGroups: [{ resourceName: 'contactGroups/fam', groupType: 'USER_CONTACT_GROUP', formattedName: 'Family' }] }
  it('first run: full list with requestSyncToken, photos asked for, next sync token from the last page', async () => {
    const urls = []
    const f = async (url) => {
      urls.push(url)
      const u = new URL(url)
      if (u.pathname === '/v1/contactGroups') return res(200, groups)
      return u.searchParams.get('pageToken')
        ? res(200, { connections: [{ resourceName: 'people/c2', names: [{ displayName: 'Anna 2' }], photos: [{ url: 'https://lh3.example.at/p2', default: true }] }], nextSyncToken: 'S1' })
        : res(200, { connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Anna 1' }], photos: [{ url: 'https://lh3.example.at/p1' }], memberships: [{ contactGroupMembership: { contactGroupResourceName: 'contactGroups/fam' } }] }], nextPageToken: 'P2' })
    }
    const r = await fetchChanges(f, 'tok')
    const first = new URL(urls.find((x) => x.includes('/connections')))
    expect(first.searchParams.get('requestSyncToken')).toBe('true')
    expect(first.searchParams.get('syncToken')).toBe(null)
    expect(first.searchParams.get('personFields')).toContain('photos')
    expect(r.nextSyncToken).toBe('S1')
    expect(r.changes.map((c) => c.sourceRef)).toEqual(['people/c1', 'people/c2'])
    expect(r.changes[0].photo).toBe('https://lh3.example.at/p1')
    expect(r.changes[0].labels).toEqual(['Family'])
    expect(r.changes[1].photo).toBeUndefined()
  })
  it('later runs send the sync token and read deleted contacts as deleted', async () => {
    const urls = []
    const f = async (url) => {
      urls.push(url)
      if (url.includes('/contactGroups')) return res(200, groups)
      return res(200, { connections: [{ resourceName: 'people/c3', metadata: { deleted: true } }], nextSyncToken: 'S2' })
    }
    const r = await fetchChanges(f, 'tok', 'S1')
    expect(new URL(urls.find((x) => x.includes('/connections'))).searchParams.get('syncToken')).toBe('S1')
    expect(r.changes).toEqual([expect.objectContaining({ sourceRef: 'people/c3', deleted: true })])
    expect(r.nextSyncToken).toBe('S2')
  })
  it('an expired sync token (410) throws SyncTokenExpired', async () => {
    const f = async (url) => (url.includes('/contactGroups') ? res(200, groups) : res(410, { error: { status: 'FAILED_PRECONDITION' } }))
    await expect(fetchChanges(f, 'tok', 'OLD')).rejects.toBeInstanceOf(SyncTokenExpired)
  })
  it('any other failure is a plain error', async () => {
    const f = async (url) => (url.includes('/contactGroups') ? res(200, groups) : res(401, {}))
    const p = fetchChanges(f, 'tok', 'S1')
    await expect(p).rejects.toThrow(Error)
    await expect(p).rejects.not.toBeInstanceOf(SyncTokenExpired)
  })
})

describe('Google rows are keyed by the Google contact, so a renamed contact stays the same person', () => {
  it('planServices keys a Google contact by its resource name', () => {
    const plan = planServices({ people: [] }, [{ name: 'Google contacts', text: '', contacts: [G(1)] }], { me: 'Me', now: NOW })
    expect(plan.rows[0].key).toBe(googleKey('people/c1'))
  })
})

describe('reconcile: one-shot preview first, then ongoing sync', () => {
  it('contacts nobody accepted yet are only remembered and handed to the preview, nobody is written', () => {
    const s = state([])
    const out = reconcile(s, [G(1), G(2)], { now: NOW, tagOf, syncToken: 'S1' })
    expect(s.people).toEqual([])
    expect(out.fresh.map((c) => c.sourceRef)).toEqual(['people/c1', 'people/c2'])
    expect(out.run).toEqual({ at: NOW, updated: 0, kept: 0, fresh: 2, gone: 0 })
    expect(s.googleSync.syncToken).toBe('S1')
    expect(Object.keys(s.googleSync.seen)).toEqual(['people/c1', 'people/c2'])
    expect(s.googleSync.last).toEqual(out.run)
  })
  it('a person accepted from the preview gets Google\'s photo and tags on the next run; what TrustWeb already had stays', () => {
    const p1 = linked('p1', 1, { fields: { [EMAIL_FIELD]: 'own@example.at' } })
    const src = p1.sources
    delete p1.sources
    const s = state([p1])
    expect(reconcile(s, [G(1, { photo: 'https://lh3.example.at/p1', labels: ['Family'] })], { now: NOW, tagOf }).fresh).toHaveLength(1)
    expect(p1.fields.photo).toBeUndefined()
    p1.sources = src // the owner accepted the row on the Curate page (decide writes the source key)
    const out = reconcile(s, [], { now: NOW + 1, tagOf })
    const p = s.people[0]
    expect(p.fields[EMAIL_FIELD]).toBe('own@example.at')
    expect(p.fields.phone).toBe('+436601110001')
    expect(p.fields.photo).toBe('https://lh3.example.at/p1')
    expect(p.fields['tag-family']).toBe(true)
    expect(p.fields.labels).toBe('Family')
    expect(out.run.updated).toBe(1)
    expect(out.run.kept).toBe(1)
    expect(out.changed).toEqual(['p1'])
  })
  it('Google wins on fields the owner never edited', () => {
    const s = state([linked('p1', 1)])
    reconcile(s, [G(1)], { now: NOW, tagOf })
    expect(s.people[0].fields[EMAIL_FIELD]).toBe('anna1@example.at')
    const out = reconcile(s, [G(1, { name: 'Anna Neu', emails: ['neu@example.at'], phones: ['0043 660 2220002'] })], { now: NOW + 1, tagOf })
    expect(s.people[0].name).toBe('Anna Neu')
    expect(s.people[0].fields[EMAIL_FIELD]).toBe('neu@example.at')
    expect(s.people[0].fields.phone).toBe('+436602220002')
    expect(out.run).toMatchObject({ updated: 1, kept: 0 })
  })
  it('TrustWeb wins on fields the owner edited (name, phone, a removed e-mail)', () => {
    const s = state([linked('p1', 1)])
    reconcile(s, [G(1, { emails: ['a@example.at', 'b@example.at'] })], { now: NOW, tagOf })
    const p = s.people[0]
    p.name = 'Anni'
    p.fields.phone = '+436609990009'
    delete p.fields['email 2']
    const out = reconcile(s, [G(1, { name: 'Anna Eins', emails: ['a@example.at', 'c@example.at'], phones: ['+43 660 3330003'] })], { now: NOW + 1, tagOf })
    expect(p.name).toBe('Anni')
    expect(p.fields.phone).toBe('+436609990009')
    expect(p.fields['email 2']).toBeUndefined()
    expect(out.run).toMatchObject({ updated: 0, kept: 3 })
  })
  it('a label removed in Google takes the tag away unless the owner touched it', () => {
    const s = state([linked('p1', 1), linked('p2', 2)])
    reconcile(s, [G(1, { labels: ['Family'] }), G(2, { labels: ['Family'] })], { now: NOW, tagOf })
    s.people[1].fields.labels = 'Family, Choir'
    reconcile(s, [G(1), G(2)], { now: NOW + 1, tagOf })
    expect(s.people[0].fields?.['tag-family']).toBeUndefined()
    expect(s.people[0].fields?.labels).toBeUndefined()
    expect(s.people[1].fields.labels).toBe('Family, Choir')
  })
  it('a contact deleted in Google is never deleted here', () => {
    const s = state([linked('p1', 1)])
    reconcile(s, [G(1)], { now: NOW, tagOf })
    const before = JSON.stringify(s.people)
    const out = reconcile(s, [{ ...G(1), deleted: true }], { now: NOW + 1, tagOf })
    expect(JSON.stringify(s.people)).toBe(before)
    expect(out.run.gone).toBe(1)
    expect(s.googleSync.seen['people/c1'].deleted).toBe(true)
  })
  it('a full resync (expired token) counts linked contacts missing from Google as gone and keeps them', () => {
    const s = state([linked('p1', 1), linked('p2', 2)])
    reconcile(s, [G(1), G(2)], { now: NOW, tagOf })
    const out = reconcile(s, [G(1)], { now: NOW + 1, tagOf, full: true, syncToken: 'S9' })
    expect(out.run.gone).toBe(1)
    expect(s.people).toHaveLength(2)
    expect(s.googleSync.syncToken).toBe('S9')
  })
  it('unchanged runs change nothing', () => {
    const s = state([linked('p1', 1)])
    reconcile(s, [G(1)], { now: NOW, tagOf })
    const before = JSON.stringify(s.people)
    const out = reconcile(s, [G(1)], { now: NOW + 1, tagOf })
    expect(JSON.stringify(s.people)).toBe(before)
    expect(out.run).toMatchObject({ updated: 0, kept: 0, fresh: 0 })
    expect(out.changed).toEqual([])
  })
  it('an import edit fingerprint follows a sync change (a sync is no edit by the owner)', () => {
    const s = state([linked('p1', 1)])
    reconcile(s, [G(1)], { now: NOW, tagOf })
    const imp = { did: 'accepted', personId: 'p1', snap: snapOf(s.people[0]) }
    s.serviceImports = [{ id: 'b1', at: 1, counts: {}, rows: [], done: { [googleKey('people/c1')]: imp } }]
    reconcile(s, [G(1, { emails: ['neu@example.at'] })], { now: NOW + 1, tagOf })
    expect(imp.snap).toBe(snapOf(s.people[0]))
  })
})

describe('waitingContacts: new in Google, not yet in an import', () => {
  it('lists remembered contacts that are not linked, not deleted and in no import batch', () => {
    const s = state([linked('p1', 1)])
    reconcile(s, [G(1), G(2), G(3), { ...G(4), deleted: true }], { now: NOW, tagOf })
    s.serviceImports = [{ id: 'b1', at: 1, counts: {}, rows: [{ key: googleKey('people/c3') }], done: {} }]
    expect(waitingContacts(s).map((c) => c.sourceRef)).toEqual(['people/c2'])
  })
})
