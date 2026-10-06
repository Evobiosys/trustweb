import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { A, A2, T, T2, RC, R1, R2, R3, call, getRec, hosted, put, tmpEmpty, usage, withServer } from './helpers.mjs'
import { sweepHosted } from '../hosted_store.mjs'

const P = 8971
const cipher = (text) => Buffer.from(text)

test('status route: hosting on, transcription and feedback off until configured', async () => {
  await withServer(P, {}, async () => {
    const r = await call(P, { url: '/hosted/status' })
    assert.equal(r.status, 200)
    assert.equal(r.json.hosted, true)
    assert.equal(r.json.transcribe, false)
    assert.equal(r.json.feedback, false)
    assert.equal(r.json.plan.secondsLimit, 36000)
    assert.equal((await call(P, { method: 'POST', url: '/hosted/status' })).status, 405)
  })
})

test('hosting off (no HOSTED_DIR): every hosted route is 503 not_configured', async () => {
  await withServer(P, { hostedDir: '' }, async () => {
    const r = await call(P, { url: '/hosted/status' })
    assert.equal(r.status, 503)
    assert.equal(r.json.error, 'not_configured')
    assert.equal((await put(P, A, R1, T, 60, cipher('x'))).status, 503)
  })
})

test('PUT, GET with the account token, GET with the read capability; never public by id alone', async () => {
  await withServer(P, {}, async () => {
    const w = await put(P, A, R1, T, 1800, cipher('ciphertext-1'), { 'X-Read-Token': RC })
    assert.equal(w.status, 204)
    assert.equal(w.headers['x-seconds-used'], '1800')
    assert.equal(w.headers['x-bytes-used'], '12')
    const owner = await getRec(P, A, R1, { 'X-Write-Token': T })
    assert.equal(owner.status, 200)
    assert.equal(owner.text, 'ciphertext-1')
    assert.equal(owner.headers['x-seconds'], '1800')
    assert.match(owner.headers.etag, /^"[0-9a-f]{32}"$/)
    assert.equal(owner.headers['content-length'], '12')
    assert.equal((await getRec(P, A, R1, { 'X-Read-Token': RC })).text, 'ciphertext-1')
    // no credential, wrong token, wrong capability, a capability on an upload that set none
    assert.equal((await getRec(P, A, R1)).status, 403)
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T2 })).status, 403)
    assert.equal((await getRec(P, A, R1, { 'X-Read-Token': 'e'.repeat(64) })).status, 403)
    assert.equal((await getRec(P, A, R1, { 'X-Read-Token': 'zz' })).status, 403)
    assert.equal((await getRec(P, A, R1, { 'X-Read-Token': 'zz', 'X-Write-Token': T })).status, 200)
    assert.equal((await put(P, A, R2, T, 60, cipher('two'))).status, 204)
    assert.equal((await getRec(P, A, R2, { 'X-Read-Token': RC })).status, 403)
    // the capability does not open anything else: not the list, not delete, not another recording
    assert.equal((await call(P, { url: `/hosted/${A}/recs`, headers: { 'X-Read-Token': RC } })).status, 400)
    assert.equal((await call(P, { method: 'DELETE', url: hosted(A, R1), headers: { 'X-Read-Token': RC } })).status, 400)
    assert.equal((await getRec(P, A, R3, { 'X-Write-Token': T })).status, 404)
    assert.equal((await getRec(P, A2, R1, { 'X-Write-Token': T })).status, 404)
  })
})

test('GET honours If-None-Match (304) and the ETag changes on replace', async () => {
  await withServer(P, {}, async () => {
    await put(P, A, R1, T, 60, cipher('v1'))
    const first = await getRec(P, A, R1, { 'X-Write-Token': T })
    const same = await getRec(P, A, R1, { 'X-Write-Token': T, 'If-None-Match': first.headers.etag })
    assert.equal(same.status, 304)
    assert.equal(same.body.length, 0)
    await put(P, A, R1, T, 60, cipher('v2'))
    const second = await getRec(P, A, R1, { 'X-Write-Token': T, 'If-None-Match': first.headers.etag })
    assert.equal(second.status, 200)
    assert.equal(second.text, 'v2')
    assert.notEqual(second.headers.etag, first.headers.etag)
  })
})

test('replace with the same id and token is idempotent and re-counts; a different token is 403 and changes nothing', async () => {
  await withServer(P, {}, async () => {
    assert.equal((await put(P, A, R1, T, 100, cipher('aaaa'))).status, 204)
    assert.equal((await put(P, A, R1, T, 200, cipher('bb'))).status, 204)
    const u = (await usage(P, A)).json
    assert.equal(u.recordings, 1)
    assert.equal(u.secondsUsed, 200)
    assert.equal(u.bytesUsed, 2)
    const bad = await put(P, A, R1, T2, 10, cipher('evil'))
    assert.equal(bad.status, 403)
    assert.equal(bad.json.error, 'forbidden_token')
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).text, 'bb')
  })
})

test('validation: ids, token, X-Seconds, X-Read-Token, empty body are 400; unknown paths 404; methods 405', async () => {
  await withServer(P, {}, async () => {
    const field = async (r) => (assert.equal(r.status, 400), r.json.field)
    assert.equal(await field(await call(P, { method: 'PUT', url: hosted('zz', R1), headers: { 'X-Write-Token': T, 'X-Seconds': '5' }, body: 'x' })), 'account')
    assert.equal(await field(await call(P, { method: 'PUT', url: hosted(A, 'short'), headers: { 'X-Write-Token': T, 'X-Seconds': '5' }, body: 'x' })), 'recording')
    assert.equal(await field(await call(P, { method: 'PUT', url: hosted(A, R1), headers: { 'X-Seconds': '5' }, body: 'x' })), 'X-Write-Token')
    for (const bad of [undefined, '0', '3601', '-1', '1.5', 'abc', '']) {
      const headers = { 'X-Write-Token': T, ...(bad === undefined ? {} : { 'X-Seconds': bad }) }
      assert.equal(await field(await call(P, { method: 'PUT', url: hosted(A, R1), headers, body: 'x' })), 'X-Seconds', `seconds=${bad}`)
    }
    assert.equal(await field(await put(P, A, R1, T, 5, 'x', { 'X-Read-Token': 'nothex' })), 'X-Read-Token')
    assert.equal(await field(await put(P, A, R1, T, 5, Buffer.alloc(0))), 'body')
    assert.equal(await field(await put(P, A, R1, T, 5, [])), 'body')
    assert.equal((await put(P, A, R1, T, 3600, 'x')).status, 204)
    assert.equal((await call(P, { url: '/hosted/nope' })).status, 404)
    assert.equal((await call(P, { method: 'POST', url: hosted(A, R1) })).status, 405)
    assert.equal((await call(P, { method: 'POST', url: `/hosted/${A}/usage` })).status, 405)
    assert.equal((await call(P, { url: `/hosted/${A}/usage/extra` })).status, 404)
    const empty = await call(P, { url: `/hosted/${A}/usage` })
    assert.equal(empty.status, 400)
    assert.equal(empty.json.error, 'bad_request')
  })
})

test('allowance edges: 10th hour accepted, 11th is 402, replace and delete free their share, delete then re-add works', async () => {
  await withServer(P, {}, async () => {
    const ids = Array.from({ length: 11 }, (_, i) => String(i + 10).repeat(16))
    for (let i = 0; i < 10; i += 1) assert.equal((await put(P, A, ids[i], T, 3600, cipher(`r${i}`))).status, 204, `recording ${i + 1}`)
    const full = (await usage(P, A)).json
    assert.equal(full.used, 10)
    assert.equal(full.secondsUsed, 36000)
    const over = await put(P, A, ids[10], T, 1, cipher('eleventh'))
    assert.equal(over.status, 402)
    assert.equal(over.json.error, 'allowance_reached')
    assert.equal(over.json.reason, 'seconds')
    assert.equal(over.json.limit, 10)
    assert.equal(over.json.secondsLimit, 36000)
    assert.equal(over.json.plan, 'free')
    // replacing recording 3 with a shorter one frees seconds ...
    assert.equal((await put(P, A, ids[2], T, 1800, cipher('shorter'))).status, 204)
    assert.equal((await put(P, A, ids[10], T, 1800, cipher('eleventh'))).status, 204)
    // ... and so does delete, then re-add
    assert.equal((await call(P, { method: 'DELETE', url: hosted(A, ids[0]), headers: { 'X-Write-Token': T } })).status, 204)
    assert.equal((await put(P, A, ids[0], T, 3600, cipher('again'))).status, 204)
    assert.equal((await put(P, A, ids[1], T, 3600, cipher('one more hour'))).status, 204) // replace at the full size stays legal
    assert.equal((await usage(P, A)).json.secondsUsed, 36000)
    // another person is unaffected
    assert.equal((await put(P, A2, R1, T2, 3600, cipher('other'))).status, 204)
  })
})

test('slot cap (anti-spam) refuses new slots with reason slots; existing slots stay writable', async () => {
  await withServer(P, { maxRecordings: 2 }, async () => {
    assert.equal((await put(P, A, R1, T, 1, 'a')).status, 204)
    assert.equal((await put(P, A, R2, T, 1, 'a')).status, 204)
    const r = await put(P, A, R3, T, 1, 'a')
    assert.equal(r.status, 402)
    assert.equal(r.json.reason, 'slots')
    assert.equal((await put(P, A, R2, T, 1, 'b')).status, 204)
  })
})

test('byte allowance and caps: account bytes 402, one recording 413, sanity 400; the old content survives each refusal', async () => {
  await withServer(P, { accountBytesLimit: 100, maxRecBytes: 60 }, async ({ hostedDir }) => {
    assert.equal((await put(P, A, R1, T, 600, Buffer.alloc(60, 1))).status, 204)
    assert.equal((await put(P, A, R2, T, 600, Buffer.alloc(40, 2))).status, 204)
    const full = await put(P, A, R3, T, 600, Buffer.alloc(10, 3))
    assert.equal(full.status, 402)
    assert.equal(full.json.reason, 'bytes')
    assert.equal(full.json.bytesLimit, 100)
    // streamed (chunked, no Content-Length) past the room this account has for R2 (100 - 60 = 40, the old R2 is replaced): cut off, 402
    const chunked = await put(P, A, R2, T, 600, [Buffer.alloc(30, 4), Buffer.alloc(30, 4), Buffer.alloc(30, 4)])
    assert.equal(chunked.status, 402)
    assert.equal(chunked.json.reason, 'bytes')
    assert.equal((await put(P, A, R2, T, 600, Buffer.alloc(61, 4))).status, 402) // the account cap (40 left) is smaller than the recording cap (60)
    assert.equal((await put(P, A, R1, T, 600, Buffer.alloc(61, 4))).status, 413) // replacing R1 frees 60: room 60, but one recording stops at 60
    assert.equal((await getRec(P, A, R2, { 'X-Write-Token': T })).body.length, 40)
    const roomy = await put(P, A, R3, T, 600, [Buffer.alloc(30, 4), Buffer.alloc(30, 4)]) // 60 fits one recording, but the account has no room left
    assert.equal(roomy.status, 402)
    await tmpEmpty(hostedDir)
    assert.equal((await usage(P, A)).json.bytesUsed, 100)
  })
  await withServer(P, {}, async () => {
    const mismatch = await put(P, A, R1, T, 1, Buffer.alloc(100000, 1))
    assert.equal(mismatch.status, 400)
    assert.equal(mismatch.json.error, 'seconds_mismatch')
    assert.equal((await usage(P, A)).json.recordings, 0)
  })
})

test('oversized streaming body is cut off at the cap (declared and chunked), nothing is left behind, no account is created', async () => {
  await withServer(P, { maxRecBytes: 1000 }, async ({ hostedDir }) => {
    const declared = await put(P, A, R1, T, 600, Buffer.alloc(1001, 1))
    assert.equal(declared.status, 413)
    assert.equal(declared.json.error, 'too_large')
    // 3 MB in 64 KB chunks against a 1000 byte cap: answered 413 while the client is still sending
    const status = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: P, method: 'PUT', path: hosted(A, R1), headers: { Host: 'app.example.test', 'X-Write-Token': T, 'X-Seconds': '600', 'Transfer-Encoding': 'chunked' } }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      })
      req.on('error', () => resolve('reset'))
      let sent = 0
      const pump = () => {
        while (sent < 48) {
          sent += 1
          if (!req.write(Buffer.alloc(65536, 7))) {
            req.once('drain', pump)
            return
          }
        }
        req.end()
      }
      pump()
    })
    assert.ok(status === 413 || status === 'reset', `got ${status}`)
    await tmpEmpty(hostedDir)
    assert.equal((await usage(P, A)).json.recordings, 0)
    assert.deepEqual(await fs.readdir(path.join(hostedDir, 'accounts')), []) // an unfinished first write claims nothing
    assert.equal((await put(P, A, R1, T, 600, Buffer.alloc(1000, 1))).status, 204) // exactly at the cap is accepted
  })
})

test('an upload that stalls is aborted after the idle timeout and leaves nothing behind', async () => {
  await withServer(P, { uploadIdleMs: 150 }, async ({ hostedDir }) => {
    const closed = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: P, method: 'PUT', path: hosted(A, R1), headers: { Host: 'app.example.test', 'X-Write-Token': T, 'X-Seconds': '60', 'Transfer-Encoding': 'chunked' } }, (res) => {
        res.resume()
        res.on('end', () => resolve(`status ${res.statusCode}`))
      })
      req.on('error', () => resolve('reset'))
      req.write('first bytes, then silence')
    })
    assert.ok(closed === 'reset' || closed.startsWith('status'), closed)
    await tmpEmpty(hostedDir)
    assert.equal((await put(P, A, R1, T, 60, 'fine')).status, 204)
  })
})

test('delete: 204, then 404; wrong token 403; frees the slot; list shows ids, sizes, seconds, stored date', async () => {
  await withServer(P, {}, async () => {
    await put(P, A, R1, T, 100, cipher('one'), { 'X-Read-Token': RC })
    await put(P, A, R2, T, 200, cipher('three'))
    const list = await call(P, { url: `/hosted/${A}/recs`, headers: { 'X-Write-Token': T } })
    assert.equal(list.status, 200)
    assert.deepEqual(list.json.recordings.map((r) => [r.id, r.bytes, r.seconds, r.hasReadToken]), [[R1, 3, 100, true], [R2, 5, 200, false]])
    assert.match(list.json.recordings[0].stored, /^\d{4}-\d\d-\d\dT/)
    assert.equal((await call(P, { url: `/hosted/${A}/recs`, headers: { 'X-Write-Token': T2 } })).status, 403)
    assert.equal((await call(P, { method: 'DELETE', url: hosted(A, R1), headers: { 'X-Write-Token': T2 } })).status, 403)
    assert.equal((await call(P, { method: 'DELETE', url: hosted(A, R1), headers: { 'X-Write-Token': T } })).status, 204)
    assert.equal((await call(P, { method: 'DELETE', url: hosted(A, R1), headers: { 'X-Write-Token': T } })).status, 404)
    assert.equal((await call(P, { method: 'DELETE', url: hosted(A2, R1), headers: { 'X-Write-Token': T } })).status, 404)
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).status, 404)
    assert.equal((await usage(P, A)).json.recordings, 1)
  })
})

test('usage and list of an unknown account are empty (and create nothing); a wrong token on a claimed account is 403', async () => {
  await withServer(P, {}, async ({ hostedDir }) => {
    const u = await usage(P, A)
    assert.equal(u.status, 200)
    assert.deepEqual([u.json.used, u.json.limit, u.json.secondsLimit, u.json.bytesLimit, u.json.plan], [0, 10, 36000, 200_000_000, 'free'])
    assert.equal(u.json.maxRecordings, 50)
    assert.deepEqual((await call(P, { url: `/hosted/${A}/recs`, headers: { 'X-Write-Token': T } })).json, { recordings: [] })
    assert.deepEqual(await fs.readdir(path.join(hostedDir, 'accounts')), [])
    await put(P, A, R1, T, 1, 'x')
    assert.equal((await usage(P, A, T2)).status, 403)
    assert.equal((await call(P, { url: `/hosted/${A}/usage` })).status, 400)
  })
})

test('concurrent first writes with different tokens: exactly one claims the account', async () => {
  await withServer(P, {}, async () => {
    const statuses = (await Promise.all([put(P, A, R1, T, 1, 'one'), put(P, A, R2, T2, 1, 'two')])).map((r) => r.status).sort()
    assert.deepEqual(statuses, [204, 403])
  })
})

test('global caps: total hosted bytes (507, frees on delete) and the free-disk floor (507)', async () => {
  await withServer(P, { hostedMaxBytes: 100 }, async () => {
    assert.equal((await put(P, A, R1, T, 60, Buffer.alloc(60, 1))).status, 204)
    const full = await put(P, A2, R1, T2, 60, Buffer.alloc(60, 2))
    assert.equal(full.status, 507)
    assert.equal(full.json.error, 'storage_full')
    assert.equal((await usage(P, A2, T2)).json.recordings, 0)
    assert.equal((await put(P, A, R1, T, 60, Buffer.alloc(100, 3))).status, 204) // a replace may grow into the room it frees
    assert.equal((await call(P, { method: 'DELETE', url: hosted(A, R1), headers: { 'X-Write-Token': T } })).status, 204)
    assert.equal((await put(P, A2, R1, T2, 60, Buffer.alloc(60, 2))).status, 204)
  })
  let free = 1_000_000_000
  await withServer(P, { hostedMinFreeBytes: 2_000_000_000, freeBytes: async () => free }, async ({ dir }) => {
    const refused = await put(P, A, R1, T, 60, 'x')
    assert.equal(refused.status, 507)
    free = 5_000_000_000
    assert.equal((await put(P, A, R1, T, 60, 'x')).status, 204)
    assert.deepEqual(await fs.readdir(path.join(dir, 'backup', 'blobs')), []) // backups live elsewhere
  })
})

test('hosted data lives in its own directory, never in BACKUP_DIR, and holds no plaintext', async () => {
  await withServer(P, {}, async ({ backupDir, hostedDir }) => {
    await put(P, A, R1, T, 60, cipher('opaque-bytes'))
    assert.deepEqual(await fs.readdir(path.join(backupDir, 'blobs')), [])
    const recs = path.join(hostedDir, 'accounts', A, 'recs')
    const names = await fs.readdir(recs)
    assert.equal(names.length, 2)
    const account = await fs.readFile(path.join(hostedDir, 'accounts', A, 'account.json'), 'utf8')
    assert.equal(account.includes(T), false) // the token is stored hashed
    const mode = (await fs.stat(path.join(hostedDir, 'accounts', A, 'account.json'))).mode & 0o777
    assert.equal(mode, 0o600)
    assert.equal(account.includes(RC), false)
  })
})

test('accounts and allowances survive a restart; the claim holds across it', async () => {
  const keep = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'twkeep-'))
  const opts = { hostedDir: path.join(keep, 'hosted'), dir: path.join(keep, 'backup') }
  try {
    await withServer(P, opts, async () => {
      assert.equal((await put(P, A, R1, T, 900, cipher('persist'))).status, 204)
    })
    await withServer(P, opts, async () => {
      const u = (await usage(P, A)).json
      assert.equal(u.secondsUsed, 900)
      assert.equal((await put(P, A, R2, T2, 1, 'thief')).status, 403)
      assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).text, 'persist')
    })
  } finally {
    await fs.rm(keep, { recursive: true, force: true })
  }
})

test('rate limits: new accounts per IP and day, writes per IP and hour, downloads per recording; each 429 says when to retry', async () => {
  await withServer(P, { accountCreatesPerIpDay: 2 }, async () => {
    const mint = (n, ip) => call(P, { method: 'PUT', url: hosted(String(n).repeat(64), R1), headers: { 'X-Write-Token': T, 'X-Seconds': '1' }, body: 'x', ip })
    assert.equal((await mint(1, '7.7.7.7')).status, 204)
    assert.equal((await mint(2, '7.7.7.7')).status, 204)
    const third = await mint(3, '7.7.7.7')
    assert.equal(third.status, 429)
    assert.equal(third.json.error, 'account_rate_limited')
    assert.ok(Number(third.headers['retry-after']) > 0)
    assert.equal((await mint(3, '8.8.8.8')).status, 204) // another network
    assert.equal((await call(P, { method: 'PUT', url: hosted('1'.repeat(64), R2), headers: { 'X-Write-Token': T, 'X-Seconds': '1' }, body: 'y', ip: '7.7.7.7' })).status, 204) // existing account still writes
  })
  await withServer(P, { hostedWritesPerHourPerIp: 2 }, async () => {
    assert.equal((await put(P, A, R1, T, 1, 'x')).status, 204)
    assert.equal((await put(P, A, R1, T, 1, 'x')).status, 204)
    const limited = await put(P, A, R1, T, 1, 'x')
    assert.equal(limited.status, 429)
    assert.equal(limited.json.error, 'rate_limited')
    assert.ok(Number(limited.headers['retry-after']) > 0)
  })
  await withServer(P, { recGetsPerHour: 2 }, async () => {
    await put(P, A, R1, T, 1, 'x')
    await put(P, A, R2, T, 1, 'x')
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).status, 200)
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).status, 200)
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).status, 429)
    assert.equal((await getRec(P, A, R2, { 'X-Write-Token': T })).status, 200) // per recording
  })
})

test('Host and Origin guard covers the hosted routes: foreign Origin 403, https://idea2.site 403, bad Host 421', async () => {
  await withServer(P, {}, async () => {
    assert.equal((await call(P, { url: '/hosted/status', host: 'evil.example.com' })).status, 421)
    assert.equal((await call(P, { url: '/hosted/status', headers: { Origin: 'https://evil.example.com' } })).status, 403)
    assert.equal((await call(P, { url: '/hosted/status', headers: { Origin: 'https://idea2.site' } })).status, 403)
    assert.equal((await call(P, { url: '/hosted/status', headers: { Origin: 'https://app.example.test' } })).status, 200)
    assert.equal((await put(P, A, R1, T, 1, 'x', { Origin: 'https://idea2.site' })).status, 403)
  })
})

test('retention sweeper: dry run reports and keeps everything; apply removes only what idled past the limit; idle empty accounts go too', async () => {
  await withServer(P, {}, async ({ hostedDir }) => {
    await put(P, A, R1, T, 60, cipher('old one'))
    await put(P, A, R2, T, 60, cipher('fresh one'))
    await put(P, A2, R1, T2, 60, cipher('old, other account'))
    const old = new Date(Date.now() - 100 * 86400000)
    for (const [acc, rid] of [[A, R1], [A2, R1]]) await fs.utimes(path.join(hostedDir, 'accounts', acc, 'recs', `${rid}.json`), old, old)
    await fs.utimes(path.join(hostedDir, 'accounts', A2, 'account.json'), old, old)

    const dry = await sweepHosted(hostedDir, { retentionDays: 90 })
    assert.equal(dry.dryRun, true)
    assert.deepEqual(dry.recordings.map((r) => [r.account, r.id]).sort(), [[A, R1], [A2, R1]].sort())
    assert.equal(dry.recordings[0].idleDays >= 100, true)
    assert.deepEqual(dry.accounts, [{ account: A2 }])
    assert.equal(dry.freedBytes, 7 + 18)
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).status, 200) // dry run changed nothing (and this read touched it: it is fresh now)
    await fs.utimes(path.join(hostedDir, 'accounts', A, 'recs', `${R1}.json`), old, old)

    const applied = await sweepHosted(hostedDir, { retentionDays: 90, dryRun: false })
    assert.equal(applied.dryRun, false)
    assert.equal(applied.recordings.length, 2)
    assert.equal((await getRec(P, A, R1, { 'X-Write-Token': T })).status, 404)
    assert.equal((await getRec(P, A, R2, { 'X-Write-Token': T })).text, 'fresh one')
    assert.equal((await usage(P, A2, T2)).json.recordings, 0)
    assert.equal((await fs.readdir(path.join(hostedDir, 'accounts'))).includes(A2), false)
    assert.equal((await fs.readdir(path.join(hostedDir, 'accounts', A, 'recs'))).length, 2) // only the fresh recording's json + bin
  })
})
