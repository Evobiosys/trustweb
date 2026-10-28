// Restore drill (docs/ops/dlp.md). Synthetic data only: random bytes, example.test hosts, no person's data.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { snapshotDir, verifySnapshot, restoreSnapshot, runDrill } from '../restore_drill.mjs'
import { withServer, call, A, T, HOST } from './helpers.mjs'

const MAGIC = Buffer.from('TWB1')
const blobFile = (id, body) => Buffer.concat([MAGIC, crypto.createHash('sha256').update('t').digest(), body])

async function liveDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'twdrill-'))
  const live = path.join(root, 'live')
  await fs.mkdir(path.join(live, 'blobs'), { recursive: true })
  await fs.mkdir(path.join(live, 'tmp'), { recursive: true })
  await fs.writeFile(path.join(live, 'blobs', `${A}.bin`), blobFile(A, Buffer.from('ciphertext-one')))
  await fs.writeFile(path.join(live, 'links.json'), JSON.stringify({ v: 1, links: {} }))
  await fs.writeFile(path.join(live, 'connect.json'), JSON.stringify({ v: 1, codes: {} }))
  await fs.writeFile(path.join(live, 'tmp', 'half-written'), 'torn')
  return { root, live, snap: path.join(root, 'snap'), restored: path.join(root, 'restored') }
}
const cleanup = (root) => fs.rm(root, { recursive: true, force: true })

test('snapshot copies blobs and stores, skips tmp, writes a manifest with hashes', async () => {
  const d = await liveDir()
  try {
    const m = await snapshotDir(d.live, d.snap, { now: () => new Date('2026-01-01T00:00:00Z') })
    assert.deepEqual(Object.keys(m.files).sort(), [`blobs/${A}.bin`, 'connect.json', 'links.json'])
    assert.equal(m.createdAt, '2026-01-01T00:00:00.000Z')
    assert.match(m.files['links.json'].sha256, /^[0-9a-f]{64}$/)
    await assert.rejects(fs.access(path.join(d.snap, 'tmp')))
    assert.deepEqual((await verifySnapshot(d.snap)).problems, [])
  } finally {
    await cleanup(d.root)
  }
})

test('snapshot refuses a non-empty destination (never overwrites)', async () => {
  const d = await liveDir()
  try {
    await fs.mkdir(d.snap)
    await fs.writeFile(path.join(d.snap, 'keep'), 'x')
    await assert.rejects(snapshotDir(d.live, d.snap), /not empty/)
    assert.equal(await fs.readFile(path.join(d.snap, 'keep'), 'utf8'), 'x')
  } finally {
    await cleanup(d.root)
  }
})

test('verify reports bit rot, a missing file, a bad blob header and unparseable JSON', async () => {
  const d = await liveDir()
  try {
    await snapshotDir(d.live, d.snap)
    await fs.appendFile(path.join(d.snap, 'blobs', `${A}.bin`), 'x')
    await fs.rm(path.join(d.snap, 'connect.json'))
    const r = await verifySnapshot(d.snap)
    assert.equal(r.ok, false)
    assert.ok(r.problems.some((p) => p.includes('hash mismatch') && p.includes('.bin')))
    assert.ok(r.problems.some((p) => p.includes('missing') && p.includes('connect.json')))

    const d2 = await liveDir()
    try {
      await fs.writeFile(path.join(d2.live, 'blobs', `${A}.bin`), Buffer.from('nope'))
      await fs.writeFile(path.join(d2.live, 'links.json'), '{not json')
      await snapshotDir(d2.live, d2.snap)
      const r2 = await verifySnapshot(d2.snap)
      assert.ok(r2.problems.some((p) => p.includes('blob header')))
      assert.ok(r2.problems.some((p) => p.includes('links.json') && p.includes('JSON')))
    } finally {
      await cleanup(d2.root)
    }
  } finally {
    await cleanup(d.root)
  }
})

test('restore verifies first and refuses a non-empty target', async () => {
  const d = await liveDir()
  try {
    await snapshotDir(d.live, d.snap)
    await restoreSnapshot(d.snap, d.restored)
    assert.deepEqual(
      await fs.readFile(path.join(d.restored, 'blobs', `${A}.bin`)),
      await fs.readFile(path.join(d.live, 'blobs', `${A}.bin`)),
    )
    await assert.rejects(restoreSnapshot(d.snap, d.restored), /not empty/)
    await fs.appendFile(path.join(d.snap, 'links.json'), ' ')
    await assert.rejects(restoreSnapshot(d.snap, path.join(d.root, 'other')), /verification failed/)
  } finally {
    await cleanup(d.root)
  }
})

test('drill against a running server: PUT, snapshot, restore, a fresh server serves the same bytes', async () => {
  const body = crypto.randomBytes(512)
  let report
  await withServer(0, {}, async ({ srv: live, backupDir, dir }) => {
    const put = await call(live.port, { method: 'PUT', url: `/backup/${A}`, headers: { 'X-Write-Token': T }, body })
    assert.equal(put.status, 204)
    const work = path.join(dir, 'drill')
    const r = await runDrill({ live: backupDir, work, now: () => new Date('2026-01-01T00:00:00Z') })
    assert.equal(r.ok, true)
    assert.deepEqual(r.problems, [])
    assert.ok(r.files >= 1)
    assert.equal(typeof r.restoreMs, 'number')
    // a fresh server on the restored copy answers with the same ciphertext
    const { startServer } = await import('../server.mjs')
    const srv = await startServer({
      dir: path.join(work, 'restored'), port: 0, allowedHosts: [HOST], log: () => {}, hostedMinFreeBytes: 0,
    })
    try {
      const got = await call(srv.port, { url: `/backup/${A}` })
      assert.equal(got.status, 200)
      assert.ok(got.body.equals(body))
    } finally {
      await srv.close()
    }
    report = r
  })
  assert.equal(report.ok, true)
})
