// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { aggregate, appendRow, checkRequest, contactsFromList, createServer, findLinkUri, logRow, newToken, pairingUrl, readRows, rowFromReceive, tokenize } from './signal-link.mjs'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 31)
const A = '+436600000001'
const B = '+436600000002'

test('tokenize drops stopwords, short words and numbers', () => {
  assert.deepEqual(tokenize('The climbing gym is open, 2026! und Klettern?'), ['climbing', 'gym', 'open', 'klettern'])
})

test('logRow keeps sorted kept words, never the body', () => {
  const r = logRow(A, 'in', NOW, 'zebra apple the mango')
  assert.deepEqual(r, { peer: A, dir: 'in', ts: NOW, w: ['apple', 'mango', 'zebra'] })
  assert.ok(!JSON.stringify(r).includes('the mango'))
})

test('aggregate: counts in/out over 365 days, first/last any age, top words', () => {
  const rows = [
    logRow(A, 'in', NOW - 10 * DAY, 'garden tomatoes garden'),
    logRow(A, 'out', NOW - 9 * DAY, 'tomatoes garden'),
    logRow(A, 'in', NOW - 400 * DAY, 'ancient history'),
    logRow(B, 'out', NOW - 1 * DAY, 'hi ok'),
    logRow('+10000000000', 'in', NOW, 'stranger'),
  ]
  const out = aggregate(rows, [{ e164: A, name: 'Test Anna' }, { e164: B, name: 'Test Ben' }], NOW)
  const a = out.find((x) => x.e164 === A)
  assert.equal(a.n365, 2); assert.equal(a.in, 1); assert.equal(a.out, 1)
  assert.equal(a.firstTs, NOW - 400 * DAY); assert.equal(a.lastTs, NOW - 9 * DAY)
  assert.deepEqual(a.words[0], ['garden', 3])
  assert.equal(out.length, 2)
  assert.equal(out.find((x) => x.e164 === B).words.length, 0)
})

test('rowFromReceive: incoming, synced outgoing, ignores groups and receipts', () => {
  const inc = JSON.stringify({ jsonrpc: '2.0', method: 'receive', params: { envelope: { sourceNumber: A, timestamp: 5, dataMessage: { timestamp: 5, message: 'pizza tonight' } } } })
  assert.deepEqual(rowFromReceive(inc), { peer: A, dir: 'in', ts: 5, w: ['pizza', 'tonight'] })
  const out = JSON.stringify({ jsonrpc: '2.0', method: 'receive', params: { envelope: { timestamp: 6, syncMessage: { sentMessage: { destinationNumber: B, timestamp: 6, message: 'pizza' } } } } })
  assert.equal(rowFromReceive(out).dir, 'out')
  const grp = JSON.stringify({ jsonrpc: '2.0', method: 'receive', params: { envelope: { sourceNumber: A, dataMessage: { message: 'x', groupInfo: {} } } } })
  assert.equal(rowFromReceive(grp), null)
  assert.equal(rowFromReceive('not json'), null)
  assert.equal(rowFromReceive(JSON.stringify({ method: 'receive', params: { envelope: { receiptMessage: {} } } })), null)
})

test('contactsFromList keeps valid E.164 only', () => {
  assert.deepEqual(contactsFromList([{ number: A, name: 'Test Anna' }, { number: 'x' }, { uuid: 'u' }, { number: B, profileName: 'Ben' }]),
    [{ e164: A, name: 'Test Anna' }, { e164: B, name: 'Ben' }])
})

test('token: 24 random bytes base64url, differs per call', () => {
  const t = newToken()
  assert.match(t, /^[A-Za-z0-9_-]{32}$/)
  assert.notEqual(t, newToken())
  assert.equal(pairingUrl(4711, t), `https://app.trustweb.one/#signal-link=4711.${t}`)
})

test('checkRequest: host, origin, bearer', () => {
  const tok = 'tok-tok-tok-tok-tok-tok-tok-tok-'
  const ok = { method: 'GET', headers: { host: '127.0.0.1:4711', origin: 'https://app.trustweb.one', authorization: 'Bearer ' + tok } }
  assert.equal(checkRequest(ok, 4711, tok).ok, true)
  assert.equal(checkRequest({ ...ok, headers: { ...ok.headers, host: 'evil.test:4711' } }, 4711, tok).status, 421)
  assert.equal(checkRequest({ ...ok, headers: { ...ok.headers, host: '127.0.0.1:1' } }, 4711, tok).status, 421)
  assert.equal(checkRequest({ ...ok, headers: { ...ok.headers, origin: 'https://evil.test' } }, 4711, tok).status, 403)
  assert.equal(checkRequest({ ...ok, headers: { ...ok.headers, origin: 'http://localhost:4711' } }, 4711, tok).ok, true)
  assert.equal(checkRequest({ ...ok, headers: { ...ok.headers, origin: 'http://localhost:9' } }, 4711, tok).status, 403)
  assert.equal(checkRequest({ ...ok, headers: { host: ok.headers.host, authorization: 'Bearer nope' } }, 4711, tok).status, 401)
  assert.equal(checkRequest({ ...ok, headers: { host: ok.headers.host } }, 4711, tok).status, 401)
  assert.equal(checkRequest({ method: 'OPTIONS', headers: { host: ok.headers.host, origin: ok.headers.origin } }, 4711, tok).ok, true)
})

test('findLinkUri picks the sgnl link out of output', () => {
  assert.equal(findLinkUri('blah\nsgnl://linkdevice?uuid=abc&pub_key=DEF\nmore'), 'sgnl://linkdevice?uuid=abc&pub_key=DEF')
  assert.equal(findLinkUri('nothing'), null)
})

test('log file is mode 0600 and round-trips', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-sl-'))
  appendRow(d, logRow(A, 'in', NOW, 'hello world'))
  assert.equal(fs.statSync(path.join(d, 'messages.jsonl')).mode & 0o777, 0o600)
  assert.equal(readRows(d).length, 1)
})

test('server: refuses without token, serves /status, /import and /link with token', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-sl-'))
  appendRow(d, logRow(A, 'in', NOW - DAY, 'climbing gym'))
  const token = newToken()
  let port = 0
  const receiver = { running: true, call: async () => [{ number: A, name: 'Test Anna' }] }
  const linker = { state: { phase: 'idle' }, start: async () => 'sgnl://linkdevice?uuid=u&pub_key=k' }
  const srv = createServer({ token, getPort: () => port, linker, receiver: () => receiver, dir: d, now: () => NOW, account: () => A })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  port = srv.address().port
  const call = (p, headers = {}, method = 'GET') => new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }))
    })
    rq.end()
  })
  try {
    assert.equal((await call('/status')).status, 401)
    const auth = { authorization: 'Bearer ' + token, origin: 'https://app.trustweb.one' }
    const st = await call('/status', auth)
    assert.equal(st.status, 200); assert.equal(st.headers['access-control-allow-origin'], 'https://app.trustweb.one')
    const imp = JSON.parse((await call('/import', auth)).body)
    assert.equal(imp.conversations[0].in, 1); assert.deepEqual(imp.conversations[0].words[0], ['climbing', 1])
    assert.equal(JSON.parse((await call('/link', auth, 'POST')).body).uri.startsWith('sgnl://linkdevice?'), true)
    assert.equal((await call('/status', { ...auth, origin: 'https://evil.test' })).status, 403)
  } finally { srv.close() }
})
