// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local: HTTP mode guards (loopback only, Host check, no Origin, token), unit and on a real socket. */
import http from 'node:http'
import { checkRequest, createHttpServer } from '../../../mcp/src/http.ts'
import { createMcpServer } from '../../../mcp/src/protocol.ts'

const TOKEN = 'a-long-enough-token-1234'
const ok = { method: 'POST', host: '127.0.0.1:7777', remote: '127.0.0.1', authorization: `Bearer ${TOKEN}` }

describe('checkRequest', () => {
  it('lets a loopback POST with the token through', () => expect(checkRequest(ok, TOKEN)).toBeNull())
  it('accepts localhost and [::1] hosts', () => {
    expect(checkRequest({ ...ok, host: 'localhost:7777' }, TOKEN)).toBeNull()
    expect(checkRequest({ ...ok, host: '[::1]:7777', remote: '::1' }, TOKEN)).toBeNull()
  })
  it('rejects a foreign Host (DNS rebinding) with 403', () => {
    for (const host of ['evil.example.com', 'evil.example.com:7777', '127.0.0.1.evil.com', undefined, '']) expect(checkRequest({ ...ok, host }, TOKEN)).toEqual({ code: 403 })
  })
  it('rejects any Origin header with 403, even a loopback one or an empty one', () => {
    for (const origin of ['https://evil.example.com', 'http://127.0.0.1:7777', 'null', '']) expect(checkRequest({ ...ok, origin }, TOKEN)).toEqual({ code: 403 })
  })
  it('rejects a remote client with 403', () => expect(checkRequest({ ...ok, remote: '192.168.1.5' }, TOKEN)).toEqual({ code: 403 }))
  it('rejects a missing or wrong token with 401', () => {
    for (const authorization of [undefined, '', 'Bearer', 'Bearer nope', `Basic ${TOKEN}`, `Bearer ${TOKEN}x`]) expect(checkRequest({ ...ok, authorization }, TOKEN)).toEqual({ code: 401 })
  })
  it('only POST: 405', () => expect(checkRequest({ ...ok, method: 'GET' }, TOKEN)).toEqual({ code: 405 }))
  it('checks Host and Origin before the token, so a bad Host never learns about the token', () => {
    expect(checkRequest({ ...ok, host: 'evil.example.com', authorization: undefined }, TOKEN)).toEqual({ code: 403 })
  })
})

describe('createHttpServer', () => {
  it('refuses to start without a token of 16+ characters', () => {
    const handle = createMcpServer({ name: 'x', version: '1' }, []).handle
    expect(() => createHttpServer(handle, '')).toThrow(/token/)
    expect(() => createHttpServer(handle, 'short')).toThrow(/token/)
  })
  function req(port, { host, headers = {}, body = '{"jsonrpc":"2.0","id":1,"method":"ping"}', method = 'POST' }) {
    return new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path: '/mcp', headers: { 'content-type': 'application/json', ...(host !== undefined ? { host } : {}), ...headers } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ code: res.statusCode, body: d })) })
      r.on('error', reject); r.end(body)
    })
  }
  it('answers a good request and rejects bad Host / Origin / token on a real socket', async () => {
    const server = createHttpServer(createMcpServer({ name: 'x', version: '1' }, []).handle, TOKEN)
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { port, address } = server.address()
    try {
      expect(address).toBe('127.0.0.1')
      const auth = { authorization: `Bearer ${TOKEN}` }
      const good = await req(port, { headers: auth })
      expect(good.code).toBe(200)
      expect(JSON.parse(good.body).result).toEqual({})
      expect((await req(port, { host: 'evil.example.com', headers: auth })).code).toBe(403)
      expect((await req(port, { headers: { ...auth, origin: 'https://evil.example.com' } })).code).toBe(403)
      expect((await req(port, { headers: {} })).code).toBe(401)
      expect((await req(port, { headers: auth, method: 'GET', body: '' })).code).toBe(405)
      const note = await req(port, { headers: auth, body: '{"jsonrpc":"2.0","method":"notifications/initialized"}' })
      expect(note.code).toBe(202)
    } finally { await new Promise((r) => server.close(r)) }
  })
  it('caps the request body at 1 MB with 413', async () => {
    const server = createHttpServer(createMcpServer({ name: 'x', version: '1' }, []).handle, TOKEN)
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    try {
      const r = await req(server.address().port, { headers: { authorization: `Bearer ${TOKEN}` }, body: 'x'.repeat(1_100_000) }).catch((e) => ({ code: e.code }))
      expect([413, 'ECONNRESET', 'EPIPE']).toContain(r.code)
    } finally { await new Promise((r) => server.close(r)) }
  })
})
