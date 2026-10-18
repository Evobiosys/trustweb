// Hardening of GET /who/<name> and the claim of a name: per-name budget, noindex, uniform 404, lookalike names.
import test from 'node:test'
import assert from 'node:assert/strict'
import { confusableKey } from '../connect_names.mjs'
import { call, withServer } from './helpers.mjs'
import { BASE, DAY, T0, claim, mint, who } from './connect_helpers.mjs'

const NOINDEX = 'noindex, nofollow'
const openCode = (port, code) => call(port, { url: `/c/${code}` })
const ip = (i) => `10.0.${i >> 8}.${i & 255}`

test('confusableKey: squash, 0/1/3/5/7 and rn mapped; different names stay different', () => {
  assert.equal(confusableKey('jap0ssert'), confusableKey('japossert'))
  assert.equal(confusableKey('ja-p_0.ssert'), 'japossert')
  assert.equal(confusableKey('arnold'), confusableKey('amold'))
  assert.equal(confusableKey('s7e1l4'), 'stell4')
  assert.equal(confusableKey('h3ll0'), 'hello')
  assert.notEqual(confusableKey('ada'), confusableKey('adam'))
})

test('/who per name: the 61st hit in a minute from distinct addresses is the plain-text 429; another name is not affected', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    assert.equal((await claim(srv.port, { name: 'popular', ...a })).status, 200)
    for (let i = 0; i < 60; i += 1) assert.equal((await who(srv.port, 'popular', { ip: ip(i) })).status, 302)
    const limited = await who(srv.port, 'popular', { ip: ip(100) })
    assert.equal(limited.status, 429)
    assert.equal(limited.text, 'slow down')
    assert.ok(Number(limited.headers['retry-after']) >= 1)
    assert.equal((await who(srv.port, 'quiet', { ip: ip(101) })).status, 404)
  })
})

test('X-Robots-Tag noindex on /who and /c answers: 302, 404, 429, 405', async () => {
  await withServer(0, { ...BASE, connectGetPerMinute: 4 }, async ({ srv }) => {
    const a = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    const seen = [await who(srv.port, 'ada'), await who(srv.port, 'nobody'), await openCode(srv.port, a.code)]
    assert.deepEqual(seen.map((r) => r.status), [302, 404, 302])
    seen.push(await call(srv.port, { method: 'POST', url: '/who/ada' }), await who(srv.port, 'ada'), await who(srv.port, 'ada'))
    assert.deepEqual(seen.slice(3).map((r) => r.status), [405, 302, 429])
    for (const r of seen) assert.equal(r.headers['x-robots-tag'], NOINDEX, String(r.status))
  })
})

test('/who 404: unknown name and bad shape answer the same headers and body, no-store', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const unknown = await who(srv.port, 'nobody')
    const bad = await who(srv.port, 'No%20Body!')
    assert.equal(unknown.status, 404)
    assert.equal(bad.status, 404)
    assert.equal(unknown.text, bad.text)
    assert.equal(unknown.headers['cache-control'], 'no-store')
    assert.deepEqual(unknown.headers['cache-control'], bad.headers['cache-control'])
    assert.deepEqual(unknown.headers['content-type'], bad.headers['content-type'])
  })
})

test('claim: a lookalike of ANOTHER code\'s name is name_taken (primary and alias); own variants are fine; a released name frees its lookalikes', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port)
    assert.equal((await claim(srv.port, { name: 'anna.huber', ...a })).status, 200)
    for (const name of ['anna.hub3r', 'annahuber', 'annahuber', 'anna-huber', 'annahu6er'.replace('6', 'b')]) {
      const r = await claim(srv.port, { name, ...b })
      assert.equal(r.status, 409, name)
      assert.equal(r.json.error, 'name_taken')
    }
    assert.equal((await claim(srv.port, { name: 'anna.hub3r', alias: true, ...b })).status, 409)
    assert.equal((await claim(srv.port, { name: 'anna.hub3r', alias: true, ...a })).status, 200)
    assert.equal((await claim(srv.port, { name: 'bertl', ...b })).status, 200)
    assert.equal((await claim(srv.port, { name: 'anna.hub3r', ...a })).status, 200)
    assert.equal((await claim(srv.port, { release: 'anna.hub3r', ...a })).status, 200)
    assert.equal((await claim(srv.port, { release: 'anna.huber', ...a })).status, 200)
    t += 31 * DAY // a freed name rests 30 days (wave 15)
    assert.equal((await claim(srv.port, { name: 'anna.hub3r', ...b })).status, 200)
  })
})
