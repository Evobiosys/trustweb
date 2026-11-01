// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Run: node --test scripts/geb-bridge/
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRequest, parseConnections, parseInbox, parseHistory, buildThreads, pairingLink, validTarget, argText, startBridge } from './geb-bridge.mjs'

const tok = 'T'.repeat(32)
const ok = { method: 'GET', host: '127.0.0.1:4711', origin: 'https://app.trustweb.one', authorization: 'Bearer ' + tok }
const chk = (o) => checkRequest({ port: 4711, token: tok, ...ok, ...o })

test('guard: a good request passes and echoes the origin for CORS', () => {
  assert.deepEqual(chk({}), { ok: true, cors: 'https://app.trustweb.one' })
  assert.equal(chk({ host: 'localhost:4711' }).ok, true)
  assert.equal(chk({ origin: 'http://localhost:5173' }).ok, true)
  assert.equal(chk({ origin: undefined }).ok, true) // curl: no Origin, still needs the token
})
test('guard: wrong host (DNS rebinding) is refused', () => {
  for (const host of ['evil.example:4711', '127.0.0.1', '127.0.0.1:4712', 'localhost.evil.com:4711', undefined]) assert.equal(chk({ host }).status, 403, String(host))
})
test('guard: foreign origins are refused', () => {
  for (const origin of ['https://evil.example', 'http://app.trustweb.one', 'https://app.trustweb.one.evil.com', 'null', 'http://localhost.evil.com']) assert.equal(chk({ origin }).status, 403, origin)
})
test('guard: token must match exactly', () => {
  for (const authorization of [undefined, '', 'Bearer ', 'Bearer x', 'Bearer ' + tok + 'x', tok, 'Basic ' + tok]) assert.equal(chk({ authorization }).status, 401, String(authorization))
})
test('guard: preflight needs only host and an allowed origin', () => {
  assert.equal(chk({ method: 'OPTIONS', authorization: undefined }).preflight, true)
  assert.equal(chk({ method: 'OPTIONS', origin: 'https://evil.example', authorization: undefined }).status, 403)
  assert.equal(chk({ method: 'OPTIONS', origin: undefined, authorization: undefined }).status, 403)
})
test('guard: only GET and POST', () => assert.equal(chk({ method: 'DELETE' }).status, 405))

test('pairing link keeps the token in the fragment', () => {
  assert.equal(pairingLink('https://app.trustweb.one', 4711, tok), `https://app.trustweb.one/#geb-bridge=4711.${tok}`)
})
test('targets: DIDs and petnames pass, flags and shell-ish text do not', () => {
  assert.equal(validTarget('did:peer:2.Ez6LSabc.Vz6Mkdef'), true)
  assert.equal(validTarget('anna'), true)
  for (const t of ['-x', '--help', '', 'a b', 'a;b', 'x'.repeat(500), 5]) assert.equal(validTarget(t), false, String(t))
})
test('send text: a leading dash cannot become a flag', () => {
  assert.equal(argText('hello'), 'hello')
  assert.equal(argText('--re x'), ' --re x')
  assert.equal(argText(''), null)
  assert.equal(argText('x'.repeat(5000)), null)
})

const D1 = 'did:peer:2.Ez6LSaaa.Vz6Mkbbb'
const D2 = 'did:peer:2.Ez6LSccc.Vz6Mkddd'
test('connections: array, keyed object, strings, junk', () => {
  assert.deepEqual(parseConnections([{ did: D1, petname: 'Anna' }, D2, 7, null]), [{ did: D1, name: 'Anna' }, { did: D2, name: '' }])
  assert.deepEqual(parseConnections({ [D1]: { name: 'Anna' } }), [{ did: D1, name: 'Anna' }])
  assert.deepEqual(parseConnections({ connections: [{ peer: D2 }] }), [{ did: D2, name: '' }])
  assert.deepEqual(parseConnections('nope'), [])
})
test('inbox: lines from others only, times normalised, own lines ignored', () => {
  const r = parseInbox({ lines: [{ from: D1, text: 'hi', at: 1700000000 }, { from: 'me', text: 'x', at: 5 }, { from: D1, text: 'again', at: '2026-01-01T00:00:00Z' }, { text: 'no from' }] })
  assert.equal(r.length, 2)
  assert.equal(r[0].at, 1700000000000)
  assert.equal(r[1].at, Date.parse('2026-01-01T00:00:00Z'))
})
test('threads: unread counted per sender, newest first, names from connections', () => {
  const t = buildThreads([{ did: D1, name: 'Anna' }, { did: D2, name: '' }], [{ from: D2, text: 'a', at: 10 }, { from: D2, text: 'b', at: 30 }, { from: D1, text: 'c', at: 20 }])
  assert.deepEqual(t.map((x) => [x.did, x.unread, x.lastAt]), [[D2, 2, 30], [D1, 1, 20]])
  assert.equal(t[1].title, 'Anna')
  assert.ok(t[0].title.length > 0)
})
test('history: JSON lines become entries, anything else stays as plain text', () => {
  const h = parseHistory('{"from":"me","text":"yo","at":1700000000000}\nAnna: hello\n\n')
  assert.deepEqual(h, [{ from: 'me', text: 'yo', at: 1700000000000 }, { from: '', text: 'Anna: hello', at: 0 }])
})

// End to end through a fake CLI (a script that prints canned output), over a real loopback socket.
test('server: loopback only, guarded, drives the CLI by argument array', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gebfake-'))
  const cli = join(dir, 'geb.mjs')
  writeFileSync(cli, `const a=process.argv.slice(2);
if(a[0]==='id')console.log(JSON.stringify({did:${JSON.stringify(D1)}}));
else if(a[0]==='connections')console.log(JSON.stringify([{did:${JSON.stringify(D2)},petname:'Ben'}]));
else if(a[0]==='inbox')console.log(JSON.stringify([{from:${JSON.stringify(D2)},text:'hi',at:1700000000000}]));
else if(a[0]==='history')console.log('Ben: hi');
else if(a[0]==='send')console.log('SENT '+JSON.stringify(a.slice(1)));`)
  const b = await startBridge({ cli, port: 0, quiet: true })
  try {
    assert.equal(b.address, '127.0.0.1')
    const call = (path, init = {}) => fetch(`http://127.0.0.1:${b.port}${path}`, { ...init, headers: { authorization: 'Bearer ' + b.token, origin: 'https://app.trustweb.one', ...(init.headers ?? {}) } })
    assert.equal((await fetch(`http://127.0.0.1:${b.port}/status`)).status, 401)
    assert.equal((await call('/status', { headers: { origin: 'https://evil.example' } })).status, 403)
    const st = await (await call('/status')).json()
    assert.equal(st.ok, true)
    assert.equal(st.did, D1)
    const th = await (await call('/threads')).json()
    assert.deepEqual(th.threads.map((x) => [x.did, x.title, x.unread]), [[D2, 'Ben', 1]])
    const hi = await (await call('/history?with=' + encodeURIComponent(D2))).json()
    assert.equal(hi.lines[0].text, 'Ben: hi')
    assert.equal((await call('/history?with=--help')).status, 400)
    const sent = await call('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: D2, text: 'hello' }) })
    assert.equal(sent.status, 200)
    assert.equal((await call('/send', { method: 'POST', body: '{"to":"-x","text":"a"}' })).status, 400)
    assert.equal((await call('/nope')).status, 404)
    const pre = await fetch(`http://127.0.0.1:${b.port}/send`, { method: 'OPTIONS', headers: { origin: 'https://app.trustweb.one', 'access-control-request-method': 'POST' } })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.trustweb.one')
  } finally {
    b.close()
  }
})
