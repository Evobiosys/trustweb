// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 37 (co-notes-link): the invite mailbox on the relay (src/ext/co_notes/co_invite_relay.ts) against a fake that keeps the real server's first-claim rule.
import { claimInvite, pollOpened, publishInvite, reportOpened, revokeInvite } from '../../src/ext/co_notes/co_invite_relay.ts'
import { newInvite, parseInviteLink, inviteUrl } from '../../src/ext/co_notes/co_invite.ts'
import { createIdentity } from '../../../demo/src/did.ts'
import { createHash } from 'node:crypto'

const NOW = 1_800_000_000_000
const OWNER = createIdentity('https://x.invalid/relay')
const sha = (s) => createHash('sha256').update(s).digest('hex')

/** services/trustweb-backup/notes_relay.mjs in miniature: first POST for a sender did claims its send token, the first GET for a mailbox with mail claims its read token; every refusal is the same 404. */
function fakeServer() {
  const box = []
  const claims = new Map()
  let n = 0
  const auth = (role, did, token, mayClaim) => {
    const k = `${role}\0${did}`
    if (!claims.has(k)) { if (!mayClaim) return false; claims.set(k, sha(token)); return true }
    return claims.get(k) === sha(token)
  }
  const fetch = async (url, init = {}) => {
    const u = new URL(url, 'https://x.invalid')
    const token = init.headers?.['X-Relay-Token'] ?? ''
    const json = (status, body) => ({ status, ok: status < 300, json: async () => body })
    if (init.method === 'POST') {
      const body = JSON.parse(init.body)
      if (!auth('send', body.from, token, true)) return json(404, {})
      const id = `id${n++}`
      box.push({ id, at: n, ...body })
      return json(201, { id })
    }
    const to = u.searchParams.get('for')
    const mine = box.filter((x) => x.to === to)
    if (!mine.length || !auth('read', to, token, true)) return json(404, {})
    if (init.method === 'DELETE') { const i = box.findIndex((x) => x.id === u.searchParams.get('id')); if (i >= 0) box.splice(i, 1); return { status: 204, ok: true } }
    const id = u.searchParams.get('id')
    if (id) { const m = mine.find((x) => x.id === id); return m ? json(200, m) : json(404, {}) }
    return json(200, { items: mine.map(({ id: i, from, size, expires }) => ({ id: i, from, size, expires })) })
  }
  return { fetch, box }
}
const deps = (srv) => ({ origin: 'https://x.invalid', fetch: srv.fetch, now: () => NOW })
const snapshot = { doc: { title: 'Retreat plan secret' } }

async function setup(o = {}) {
  const srv = fakeServer()
  const inv = newInvite({ noteId: 'co1', name: 'Ben', now: NOW, ...o })
  const owner = { did: OWNER.did, id: 'jak1', name: 'Jakob' }
  const url = new URL(inviteUrl('https://app.example', inv, owner))
  const link = parseInviteLink(url.search, url.hash)
  expect(await publishInvite(deps(srv), OWNER, inv, snapshot)).toBe(true)
  return { srv, inv, link }
}

describe('publish and claim', () => {
  it('the relay holds ciphertext only', async () => {
    const { srv } = await setup()
    expect(JSON.stringify(srv.box)).not.toContain('secret')
    expect(srv.box.every((m) => m.to.startsWith('co-invite:'))).toBe(true)
  })
  it('the first device opens it; the same device can again; a second device is refused (single use)', async () => {
    const { srv, link } = await setup()
    const first = await claimInvite(deps(srv), link, 'device-A')
    expect(first).toEqual({ ok: true, snapshot })
    expect(await claimInvite(deps(srv), link, 'device-A')).toEqual({ ok: true, snapshot })
    expect(await claimInvite(deps(srv), link, 'device-B')).toEqual({ ok: false, why: 'refused' })
  })
  it('an anonymous link opens on any device', async () => {
    const { srv, link } = await setup({ mode: 'anyone' })
    expect((await claimInvite(deps(srv), link, 'device-A')).ok).toBe(true)
    expect((await claimInvite(deps(srv), link, 'device-B')).ok).toBe(true)
  })
  it('a refused open leaks nothing: same answer for a used link, a made-up id and a wrong key', async () => {
    const { srv, link } = await setup()
    await claimInvite(deps(srv), link, 'device-A')
    const used = await claimInvite(deps(srv), link, 'device-B')
    const unknown = await claimInvite(deps(srv), { ...link, id: 'f'.repeat(32) }, 'device-C')
    const wrongKey = await claimInvite(deps(srv), { ...link, key: 'A'.repeat(43) }, 'device-A')
    expect(used).toEqual({ ok: false, why: 'refused' })
    expect(unknown).toEqual(used)
    expect(wrongKey).toEqual(used)
  })
  it('a network failure is offline, not refused', async () => {
    const { link } = await setup()
    const down = { origin: 'https://x.invalid', fetch: async () => { throw new Error('offline') }, now: () => NOW }
    expect(await claimInvite(down, link, 'device-A')).toEqual({ ok: false, why: 'offline' })
  })
})

describe('the owner hears that it was opened', () => {
  it('the guest leaves a note sealed with the invite key; the owner reads it once and it is removed', async () => {
    const { srv, inv, link } = await setup()
    expect(await reportOpened(deps(srv), link, 'device-A', { name: 'Ben', did: 'did:peer:2.ben' }, NOW)).toBe(true)
    expect(JSON.stringify(srv.box)).not.toContain('did:peer:2.ben')
    const got = await pollOpened(deps(srv), OWNER, inv)
    expect(got).toEqual([{ name: 'Ben', did: 'did:peer:2.ben', at: NOW }])
    expect(await pollOpened(deps(srv), OWNER, inv)).toEqual([])
  })
  it('a note sealed with another key is ignored', async () => {
    const { srv, inv, link } = await setup()
    await reportOpened(deps(srv), { ...link, key: 'B'.repeat(43) }, 'device-A', { name: 'Eve' }, NOW)
    expect(await pollOpened(deps(srv), OWNER, inv)).toEqual([])
  })
  it('nothing waiting is an empty list, a down relay too', async () => {
    const { srv, inv } = await setup()
    expect(await pollOpened(deps(srv), OWNER, inv)).toEqual([])
    expect(await pollOpened({ origin: 'x', fetch: async () => { throw new Error('x') }, now: () => NOW }, OWNER, inv)).toEqual([])
  })
})

describe('revoke', () => {
  it('an unopened link stops working for everyone', async () => {
    const { srv, inv, link } = await setup()
    expect(await revokeInvite(deps(srv), inv)).toBe(true)
    expect(await claimInvite(deps(srv), link, 'device-A')).toEqual({ ok: false, why: 'refused' })
    expect(srv.box).toHaveLength(0)
  })
  it('a link somebody already opened cannot be recalled (they hold their copy): honest false', async () => {
    const { srv, inv, link } = await setup()
    await claimInvite(deps(srv), link, 'device-A')
    expect(await revokeInvite(deps(srv), inv)).toBe(false)
    expect((await claimInvite(deps(srv), link, 'device-A')).ok).toBe(true)
  })
})
