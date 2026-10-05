import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(process.env.BACKUP_JS).href)
const { newRandomKey, keyFromPassphrase, parseKeyText, backupNow, restore, BackupNotFound } = mod

/** In-memory stand-in for the server, so these unit tests do not depend on server.mjs. */
async function fakeServer() {
  const store = new Map()
  const seen = []
  const server = http.createServer((req, res) => {
    const id = req.url.split('/').pop()
    if (req.method === 'PUT') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        seen.push({ id, token: req.headers['x-write-token'], body: Buffer.concat(chunks) })
        store.set(id, Buffer.concat(chunks))
        res.writeHead(204).end()
      })
    } else if (store.has(id)) {
      res.writeHead(200).end(store.get(id))
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    base: `http://127.0.0.1:${server.address().port}/backup/`,
    store,
    seen,
    close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections() }),
  }
}

const sample = { v: 1, inventory: [{ name: 'Motorbike' }], log: ['Über-Straße'] }

test('random key: format, parse round trip, kind flag', async () => {
  const key = await newRandomKey()
  assert.equal(key.fromPassphrase, false)
  assert.match(key.text, /^TW1R(-[0-9A-Z]{5}){11}$/)
  const parsed = parseKeyText(key.text)
  assert.deepEqual(parsed, key)
  assert.deepEqual(parseKeyText(key.text.toLowerCase().replaceAll('-', ' ')), key)
  assert.notEqual((await newRandomKey()).text, key.text)
})

test('parseKeyText rejects malformed text and typos', async () => {
  const key = await newRandomKey()
  assert.throws(() => parseKeyText(''))
  assert.throws(() => parseKeyText('hello'))
  assert.throws(() => parseKeyText(key.text.slice(0, -1)))
  assert.throws(() => parseKeyText(key.text.replace('TW1R', 'TW1X')))
  const chars = key.text.split('')
  const i = 8 // inside the first group
  chars[i] = chars[i] === '2' ? '3' : '2'
  assert.throws(() => parseKeyText(chars.join('')))
})

test('passphrase: deterministic, NFKC-normalised, minimum length enforced', async () => {
  const a = await keyFromPassphrase('correct horse battery')
  const b = await keyFromPassphrase('correct horse battery')
  assert.equal(a.text, b.text)
  assert.equal(a.fromPassphrase, true)
  assert.match(a.text, /^TW1P-/)
  assert.deepEqual(parseKeyText(a.text), a)
  assert.notEqual((await keyFromPassphrase('correct horse batterz')).text, a.text)
  // Precomposed vs decomposed umlaut: same passphrase on every device.
  const nfc = await keyFromPassphrase('Grüne Wiese am See')
  const nfd = await keyFromPassphrase('Grüne Wiese am See')
  assert.equal(nfc.text, nfd.text)
  await assert.rejects(() => keyFromPassphrase('too short'))
  await assert.rejects(() => keyFromPassphrase(''))
})

test('round trip: backup then restore returns the payload', async () => {
  const srv = await fakeServer()
  try {
    const key = await newRandomKey()
    const info = await backupNow(key, sample, srv.base)
    assert.equal(typeof info.at, 'number')
    assert.ok(info.bytes > 29)
    assert.deepEqual(await restore(key, srv.base), sample)
    // A key re-entered from text works the same.
    assert.deepEqual(await restore(parseKeyText(key.text), srv.base), sample)
    // Base without trailing slash is accepted.
    assert.deepEqual(await restore(key, srv.base.slice(0, -1)), sample)
  } finally {
    await srv.close()
  }
})

test('id and token derivation are stable per key and independent of each other', async () => {
  const srv = await fakeServer()
  try {
    const key = await newRandomKey()
    await backupNow(key, sample, srv.base)
    await backupNow(key, { again: true }, srv.base)
    const [first, second] = srv.seen
    assert.equal(first.id, second.id)
    assert.equal(first.token, second.token)
    assert.match(first.id, /^[0-9a-f]{64}$/)
    assert.match(first.token, /^[0-9a-f]{64}$/)
    assert.notEqual(first.id, first.token)
    // Fresh IV per backup: same plaintext key, different bytes.
    assert.notDeepEqual(first.body, second.body)
    assert.deepEqual(first.body.subarray(0, 1), Buffer.from([1]))
    const other = await newRandomKey()
    await backupNow(other, sample, srv.base)
    assert.notEqual(srv.seen[2].id, first.id)
    assert.notEqual(srv.seen[2].token, first.token)
    // Passphrase-derived keys give stable ids too.
    const p = await keyFromPassphrase('correct horse battery')
    await backupNow(p, sample, srv.base)
    await backupNow(await keyFromPassphrase('correct horse battery'), sample, srv.base)
    assert.equal(srv.seen[3].id, srv.seen[4].id)
  } finally {
    await srv.close()
  }
})

test('wrong key fails: no backup under another key', async () => {
  const srv = await fakeServer()
  try {
    await backupNow(await newRandomKey(), sample, srv.base)
    await assert.rejects(async () => restore(await newRandomKey(), srv.base), BackupNotFound)
  } finally {
    await srv.close()
  }
})

test('server never sees plaintext', async () => {
  const srv = await fakeServer()
  try {
    await backupNow(await newRandomKey(), sample, srv.base)
    const bytes = srv.seen[0].body
    assert.equal(bytes.includes(Buffer.from('Motorbike')), false)
  } finally {
    await srv.close()
  }
})

test('tamper fails (AES-GCM): flipped ciphertext, tag, IV, version; and blob swapped between ids', async () => {
  const srv = await fakeServer()
  try {
    const key = await newRandomKey()
    await backupNow(key, sample, srv.base)
    const [[id, original]] = [...srv.store.entries()]
    for (const pos of [0, 5, 20, original.length - 1]) {
      const bad = Buffer.from(original)
      bad[pos] ^= 0x01
      srv.store.set(id, bad)
      await assert.rejects(() => restore(key, srv.base), (e) => !(e instanceof BackupNotFound))
    }
    srv.store.set(id, original.subarray(0, original.length - 3))
    await assert.rejects(() => restore(key, srv.base))
    srv.store.set(id, original)
    assert.deepEqual(await restore(key, srv.base), sample)
    // Replay under a different id is rejected by the AAD binding.
    const other = await newRandomKey()
    await backupNow(other, { x: 1 }, srv.base)
    const otherId = [...srv.store.keys()].find((k) => k !== id)
    srv.store.set(otherId, original)
    await assert.rejects(() => restore(other, srv.base), (e) => !(e instanceof BackupNotFound))
  } finally {
    await srv.close()
  }
})
