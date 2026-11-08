// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 37 (co-notes-link): invite tokens, the link, the read token, state machine, guest shell (src/ext/co_notes/co_invite.ts).
import { accessRows, advance, cleanInvite, cleanInvites, guestShell, inviteUrl, newInvite, offerFor, openSealed, parseInviteLink, readToken, ringFor, sealSnapshot } from '../../src/ext/co_notes/co_invite.ts'

const NOW = 1_800_000_000_000
const OWNER = { did: 'did:peer:2.owner', id: 'jak1', name: 'Jakob' }
const mk = (o = {}) => newInvite({ noteId: 'co1', name: 'Ben', now: NOW, ...o })

describe('newInvite', () => {
  it('is per person, single use, conservative: 128-bit id, 256-bit key, ring Intending, not watching', () => {
    const i = mk()
    expect(i.id).toMatch(/^[0-9a-f]{32}$/)
    expect(i.key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(i).toMatchObject({ mode: 'person', ring: 'intending', watch: false, state: 'invited', noteId: 'co1', name: 'Ben' })
    expect(mk().id).not.toBe(i.id)
    expect(mk().key).not.toBe(i.key)
  })
  it('keeps a bound did and a chosen ring; anyone mode keeps the watch flag, a person invite never watches', () => {
    expect(mk({ did: 'did:x', ring: 'friend' })).toMatchObject({ did: 'did:x', ring: 'friend' })
    expect(mk({ mode: 'anyone', watch: true }).watch).toBe(true)
    expect(mk({ mode: 'person', watch: true }).watch).toBe(false)
  })
})

describe('link: the key lives in the fragment only (I1)', () => {
  const inv = mk()
  const url = inviteUrl('https://app.trustweb.one', inv, OWNER)
  it('builds ?note=<id> with owner hints in the query and the key in #k=', () => {
    const u = new URL(url)
    expect(u.searchParams.get('note')).toBe(inv.id)
    expect(u.search).not.toContain(inv.key)
    expect(u.hash).toContain(`k=${inv.key}`)
    expect(url).not.toMatch(new RegExp(`/${inv.key}`))
  })
  it('parses back', () => {
    const u = new URL(url)
    expect(parseInviteLink(u.search, u.hash)).toEqual({ id: inv.id, key: inv.key, anonymous: false, watch: false, owner: OWNER })
  })
  it('anonymous links say so', () => {
    const a = mk({ mode: 'anyone' })
    const u = new URL(inviteUrl('https://x.invalid', a, OWNER))
    expect(parseInviteLink(u.search, u.hash)?.anonymous).toBe(true)
  })
  it('the watch choice rides in the fragment of an anonymous link, so the guest knows whether to tell me', () => {
    const w = mk({ mode: 'anyone', watch: true })
    const u = new URL(inviteUrl('https://x.invalid', w, OWNER))
    expect(parseInviteLink(u.search, u.hash)).toMatchObject({ anonymous: true, watch: true })
    const q = new URL(inviteUrl('https://x.invalid', mk({ mode: 'anyone' }), OWNER))
    expect(parseInviteLink(q.search, q.hash)?.watch).toBe(false)
  })
  it('refuses a key in the query, a bad id, a bad key, a missing part', () => {
    const u = new URL(url)
    expect(parseInviteLink(`${u.search}&k=${inv.key}`, u.hash)).toBeNull()
    expect(parseInviteLink('?note=zz', u.hash)).toBeNull()
    expect(parseInviteLink(u.search, '#k=short&f=x')).toBeNull()
    expect(parseInviteLink(u.search, '')).toBeNull()
    expect(parseInviteLink('', u.hash)).toBeNull()
  })
})

describe('read token (single use is the first claim of the relay mailbox)', () => {
  it('is 64 hex, differs per device for a person link, equal for everyone on an anonymous link', async () => {
    const key = mk().key
    const a = await readToken(key, 'device-A', false)
    const b = await readToken(key, 'device-B', false)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
    expect(await readToken(key, 'device-A', false)).toBe(a)
    expect(await readToken(key, 'device-A', true)).toBe(await readToken(key, 'device-B', true))
    expect(await readToken(key, 'device-A', true)).not.toBe(a)
  })
})

describe('sealed snapshot', () => {
  it('opens with the key and with nothing else; the text is not in the bytes', async () => {
    const inv = mk()
    const bytes = await sealSnapshot({ doc: { title: 'Retreat plan' } }, inv.key)
    expect(new TextDecoder().decode(bytes)).not.toContain('Retreat')
    expect(await openSealed(bytes, inv.key)).toEqual({ doc: { title: 'Retreat plan' } })
    expect(await openSealed(bytes, mk().key)).toBeNull()
    expect(await openSealed(bytes.slice(0, 20), inv.key)).toBeNull()
  })
})

describe('state machine invited -> opened -> connected', () => {
  it('moves forward only', () => {
    const i = mk()
    const o = advance(i, 'opened', NOW + 1)
    expect(o).toMatchObject({ state: 'opened', openedAt: NOW + 1 })
    expect(advance(o, 'connected', NOW + 2).state).toBe('connected')
    expect(advance(advance(o, 'connected', NOW + 2), 'opened', NOW + 3).state).toBe('connected')
    expect(advance(i, 'connected', NOW + 2).state).toBe('connected')
  })
  it('an anonymous link never reaches connected', () => {
    expect(advance(mk({ mode: 'anyone' }), 'connected', NOW).state).toBe('invited')
    expect(advance(advance(mk({ mode: 'anyone' }), 'opened', NOW), 'connected', NOW).state).toBe('opened')
  })
})

describe('cleanInvite (from the wire or a stored record)', () => {
  it('keeps a good one, drops garbage, clamps text, whitelists the ring and state', () => {
    const i = mk({ name: 'x'.repeat(200) })
    expect(cleanInvite(i)?.name.length).toBeLessThanOrEqual(60)
    expect(cleanInvite({ ...i, ring: 'god' })?.ring).toBe('intending')
    expect(cleanInvite({ ...i, state: 'hacked' })?.state).toBe('invited')
    expect(cleanInvite({ ...i, id: 'nope' })).toBeNull()
    expect(cleanInvite({ ...i, key: 'nope' })).toBeNull()
    expect(cleanInvite(null)).toBeNull()
    expect(cleanInvite({ ...i, extra: 1 })).not.toHaveProperty('extra')
  })
  it('a list drops duplicates and garbage and is capped', () => {
    const i = mk()
    expect(cleanInvites([i, i, 5, null])).toHaveLength(1)
    expect(cleanInvites('x')).toEqual([])
    expect(cleanInvites(Array.from({ length: 300 }, () => mk()))).toHaveLength(200)
  })
})

describe('share sheet logic', () => {
  it('no match for a typed name offers a single-use link; a match or empty text offers none', () => {
    expect(offerFor('Cara', 0)).toBe('Cara')
    expect(offerFor('  Cara  ', 0)).toBe('Cara')
    expect(offerFor('Cara', 2)).toBeNull()
    expect(offerFor('   ', 0)).toBeNull()
  })
  it('People with access: me as owner first, then each invite with its state', () => {
    const rows = accessRows('Jakob', [mk({ name: 'Ben' }), advance(mk({ name: 'Cara' }), 'opened', NOW)])
    expect(rows.map((r) => [r.name, r.role, r.state])).toEqual([['Jakob', 'owner', undefined], ['Ben', 'guest', 'invited'], ['Cara', 'guest', 'opened']])
  })
})

describe('guest shell', () => {
  it('a plain note: Web, Chat (centre, highlighted), Resources', () => {
    expect(guestShell(false)).toEqual({ tabs: ['web', 'chat', 'inventory'], primary: 'chat' })
  })
  it('an event note: Web, Chat, Events, Resources, Events highlighted, Chat not', () => {
    expect(guestShell(true)).toEqual({ tabs: ['web', 'chat', 'events', 'inventory'], primary: 'events' })
  })
})

describe('the ring the guest lands in, in my web', () => {
  const inv = mk({ ring: 'friend' })
  it('a person who joined my web after the invite and still sits in a default ring goes to the ring I chose', () => {
    expect(ringFor(inv, { ring: 'acquaintance', metAt: NOW + 5 })).toBe('friend')
    expect(ringFor(inv, { ring: 'intending', metAt: NOW + 5 })).toBe('friend')
  })
  it('somebody already in my web, or placed by me since, keeps their ring', () => {
    expect(ringFor(inv, { ring: 'acquaintance', metAt: NOW - 1 })).toBeNull()
    expect(ringFor(inv, { ring: 'closest', metAt: NOW + 5 })).toBeNull()
  })
  it('already in the chosen ring: nothing to change', () => {
    expect(ringFor(inv, { ring: 'friend', metAt: NOW + 5 })).toBeNull()
  })
})
