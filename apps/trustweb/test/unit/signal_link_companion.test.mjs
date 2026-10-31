// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-signal-link): pairing hash and the companion client (pure / injected fetch). */
import { consumePairing, createClient, parsePairing } from '../../src/ext/signal-link/companion.ts'

const TOK = 'abcdefghijklmnopqrstuvwxyz012345'

describe('signal-link: pairing', () => {
  it('reads port and token from the hash', () => {
    expect(parsePairing('#signal-link=4711.' + TOK)).toEqual({ port: 4711, token: TOK })
    expect(parsePairing('#signal-link=99999999.' + TOK)).toBeNull()
    expect(parsePairing('#other=1')).toBeNull()
    expect(parsePairing('#signal-link=4711.<script>')).toBeNull()
  })
  it('consumes once: stored, then the hash is removed', () => {
    const mem = {}
    const replaced = []
    const ok = consumePairing('#signal-link=4711.' + TOK, { setItem: (k, v) => { mem[k] = v } }, (u) => replaced.push(u))
    expect(ok).toBe(true)
    expect(JSON.parse(Object.values(mem)[0])).toEqual({ port: 4711, token: TOK })
    expect(replaced).toEqual([''])
    expect(consumePairing('#x', { setItem: () => { throw new Error('no') } }, () => { throw new Error('no') })).toBe(false)
  })
})

describe('signal-link: client', () => {
  it('sends the bearer token to 127.0.0.1 only', async () => {
    const seen = []
    const f = async (url, init) => { seen.push([url, init]); return { ok: true, json: async () => ({ uri: 'sgnl://linkdevice?uuid=u' }) } }
    const c = createClient({ port: 4711, token: TOK }, f)
    expect((await c.link()).uri).toBe('sgnl://linkdevice?uuid=u')
    expect(seen[0][0]).toBe('http://127.0.0.1:4711/link')
    expect(seen[0][1].method).toBe('POST')
    expect(seen[0][1].headers.authorization).toBe('Bearer ' + TOK)
  })
  it('null when the companion is not reachable or refuses', async () => {
    expect(await createClient({ port: 1, token: TOK }, async () => { throw new Error('refused') }).status()).toBeNull()
    expect(await createClient({ port: 1, token: TOK }, async () => ({ ok: false, json: async () => ({}) })).status()).toBeNull()
  })
})
