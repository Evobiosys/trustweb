/** The event's public face (name and logo) for the join sheet: one GET without identity, every error swallowed. */
import { fetchPublic } from '../../src/org_public.ts'

const SRV = '0123456789abcdef'
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) })

describe('fetchPublic', () => {
  it('GETs /org/event/<srv>/public with no body and no extra headers', async () => {
    const calls = []
    const got = await fetchPublic((u, i) => { calls.push([u, i]); return Promise.resolve(reply(200, { name: 'Forum' })) }, SRV)
    expect(got).toEqual({ name: 'Forum' })
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(`/org/event/${SRV}/public`)
    const init = calls[0][1] ?? {}
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.headers).toBeUndefined()
    expect(init.credentials ?? 'omit').toBe('omit')
  })

  it('returns null without a request for a bad srv', async () => {
    let n = 0
    const f = () => { n++; return Promise.resolve(reply(200, { name: 'x' })) }
    for (const bad of ['', '0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0', '../../org/me', '0123456789abcdeg', undefined, null]) {
      expect(await fetchPublic(f, bad)).toBeNull()
    }
    expect(n).toBe(0)
  })

  it('returns null on reject, throw, non-200 and bad JSON', async () => {
    expect(await fetchPublic(() => Promise.reject(new Error('offline')), SRV)).toBeNull()
    expect(await fetchPublic(() => { throw new Error('boom') }, SRV)).toBeNull()
    expect(await fetchPublic(() => Promise.resolve(reply(404, { error: 'not_found' })), SRV)).toBeNull()
    expect(await fetchPublic(() => Promise.resolve(reply(500, { name: 'Forum' })), SRV)).toBeNull()
    expect(await fetchPublic(() => Promise.resolve(reply(200, new SyntaxError('bad json'))), SRV)).toBeNull()
    for (const body of [null, 'Forum', [], {}, { name: '' }, { name: 42 }, { name: 'x'.repeat(121) }]) {
      expect(await fetchPublic(() => Promise.resolve(reply(200, body)), SRV)).toBeNull()
    }
  })

  it('keeps name and a valid logo, drops a logo that fails the rule', async () => {
    expect(await fetchPublic(() => Promise.resolve(reply(200, { name: 'Forum', logo: PNG })), SRV)).toEqual({ name: 'Forum', logo: PNG })
    expect(await fetchPublic(() => Promise.resolve(reply(200, { name: 'x'.repeat(120) })), SRV)).toEqual({ name: 'x'.repeat(120) })
    for (const logo of ['data:image/svg+xml;base64,AAAA', 'javascript:alert(1)', 'https://example.org/l.png', 7, '']) {
      expect(await fetchPublic(() => Promise.resolve(reply(200, { name: 'Forum', logo })), SRV)).toEqual({ name: 'Forum' })
    }
  })
})
