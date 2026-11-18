// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c sync-seamless (B1): the Tana token lives for this visit only (sessionStorage); "Remember on this computer" keeps it sealed under a key held in IndexedDB. */
import { createTanaToken, TANA_LOCAL_KEY, TANA_SESSION_KEY } from '../../src/tana_token.ts'

const mem = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
const keyStore = () => { let k; return { get: async () => k, put: async (x) => { k = x } } }
const TOKEN = 'tana-secret-token-123'
const rig = () => ({ session: mem(), local: mem(), keys: keyStore() })

describe('tana token', () => {
  it('by default the token stays in this visit only: nothing in localStorage', async () => {
    const r = rig()
    const t = createTanaToken(r)
    await t.save(TOKEN, false)
    expect(r.session.getItem(TANA_SESSION_KEY)).toBe(TOKEN)
    expect(r.local.m.size).toBe(0)
    expect(await t.load()).toEqual({ token: TOKEN, remembered: false })
  })

  it('remembered on this computer: sealed in localStorage (no plaintext), read back in a new visit with the key from IndexedDB', async () => {
    const r = rig()
    await createTanaToken(r).save(TOKEN, true)
    const sealed = r.local.getItem(TANA_LOCAL_KEY)
    expect(sealed).toBeTruthy()
    expect(sealed).not.toContain(TOKEN)
    expect(JSON.stringify([...r.local.m.values()])).not.toContain(TOKEN)
    const next = { ...r, session: mem() } // a new visit: the session is empty
    expect(await createTanaToken(next).load()).toEqual({ token: TOKEN, remembered: true })
  })

  it('un-ticking Remember removes the sealed copy; an empty token clears both', async () => {
    const r = rig()
    const t = createTanaToken(r)
    await t.save(TOKEN, true)
    await t.save(TOKEN, false)
    expect(r.local.getItem(TANA_LOCAL_KEY)).toBeNull()
    expect(r.session.getItem(TANA_SESSION_KEY)).toBe(TOKEN)
    await t.save('', true)
    expect(r.session.getItem(TANA_SESSION_KEY)).toBeNull()
    expect(await t.load()).toEqual({ token: '', remembered: false })
  })

  it('a sealed copy that cannot be opened (the key is gone) reads as no token and is dropped', async () => {
    const r = rig()
    await createTanaToken(r).save(TOKEN, true)
    const lost = { session: mem(), local: r.local, keys: keyStore() }
    expect(await createTanaToken(lost).load()).toEqual({ token: '', remembered: false })
    expect(r.local.getItem(TANA_LOCAL_KEY)).toBeNull()
  })

  it('a token an earlier build left in plaintext moves into the sealed copy', async () => {
    const r = rig()
    r.local.setItem('trustweb.tana.token', TOKEN)
    const t = createTanaToken(r)
    expect(await t.load()).toEqual({ token: TOKEN, remembered: true })
    expect(r.local.getItem('trustweb.tana.token')).toBeNull()
    expect(JSON.stringify([...r.local.m.values()])).not.toContain(TOKEN)
  })
})
