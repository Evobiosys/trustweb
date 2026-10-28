// Backup + restore drill for the BACKUP_DIR of this service (plan: docs/ops/dlp.md). node stdlib only.
//
//   node restore_drill.mjs snapshot <live-dir> <snapshot-dir>     copy blobs + JSON stores, write MANIFEST.json (sha256 per file)
//   node restore_drill.mjs verify   <snapshot-dir>                re-hash every file, check blob headers and JSON stores
//   node restore_drill.mjs restore  <snapshot-dir> <target-dir>   verify, then copy into an EMPTY target
//   node restore_drill.mjs drill    <live-dir> <work-dir>         snapshot + verify + restore into <work>/restored, print a JSON report
//
// Nothing here deletes or overwrites: a destination that is not empty is refused, tmp/ (half-written uploads) is never copied.
// Contents are opaque ciphertext and hashes; no file content is printed or logged.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MAGIC = Buffer.from('TWB1')
const HEADER_BYTES = MAGIC.length + 32
const JSON_STORES = ['links.json', 'connect.json', 'organizers.json']
const MANIFEST = 'MANIFEST.json'

const sha256File = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')

async function assertEmpty(dir) {
  let names
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  if (names.length > 0) throw new Error(`${dir} is not empty`)
}

/** Relative paths (posix) of what a snapshot holds: blobs/*.bin and the JSON stores, whichever exist. */
async function listLive(live) {
  const out = []
  let blobs = []
  try {
    blobs = (await fs.readdir(path.join(live, 'blobs'))).filter((n) => n.endsWith('.bin')).sort()
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  for (const n of blobs) out.push(`blobs/${n}`)
  for (const n of JSON_STORES) {
    try {
      await fs.access(path.join(live, n))
      out.push(n)
    } catch {
      /* store not created yet */
    }
  }
  return out
}

async function copyFile0600(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 })
  await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL)
  await fs.chmod(to, 0o600)
}

export async function snapshotDir(live, snap, { now = () => new Date() } = {}) {
  await assertEmpty(snap)
  await fs.mkdir(snap, { recursive: true, mode: 0o700 })
  const files = {}
  for (const rel of await listLive(live)) {
    await copyFile0600(path.join(live, rel), path.join(snap, rel))
    const to = path.join(snap, rel)
    files[rel] = { sha256: await sha256File(to), bytes: (await fs.stat(to)).size }
  }
  const manifest = { v: 1, createdAt: now().toISOString(), files }
  await fs.writeFile(path.join(snap, MANIFEST), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  return manifest
}

export async function verifySnapshot(snap) {
  const problems = []
  let manifest
  try {
    manifest = JSON.parse(await fs.readFile(path.join(snap, MANIFEST), 'utf8'))
  } catch {
    return { ok: false, problems: [`${MANIFEST} missing or unreadable`], files: 0 }
  }
  for (const [rel, want] of Object.entries(manifest.files ?? {})) {
    const file = path.join(snap, rel)
    let data
    try {
      data = await fs.readFile(file)
    } catch {
      problems.push(`missing: ${rel}`)
      continue
    }
    if (crypto.createHash('sha256').update(data).digest('hex') !== want.sha256) {
      problems.push(`hash mismatch: ${rel}`)
      continue
    }
    if (rel.startsWith('blobs/')) {
      if (data.length < HEADER_BYTES || !data.subarray(0, MAGIC.length).equals(MAGIC)) problems.push(`bad blob header: ${rel}`)
    } else {
      try {
        JSON.parse(data.toString('utf8'))
      } catch {
        problems.push(`not valid JSON: ${rel}`)
      }
    }
  }
  return { ok: problems.length === 0, problems, files: Object.keys(manifest.files ?? {}).length, createdAt: manifest.createdAt }
}

export async function restoreSnapshot(snap, target) {
  const v = await verifySnapshot(snap)
  if (!v.ok) throw new Error(`snapshot verification failed: ${v.problems.join('; ')}`)
  await assertEmpty(target)
  const manifest = JSON.parse(await fs.readFile(path.join(snap, MANIFEST), 'utf8'))
  await fs.mkdir(path.join(target, 'blobs'), { recursive: true, mode: 0o700 })
  for (const rel of Object.keys(manifest.files)) await copyFile0600(path.join(snap, rel), path.join(target, rel))
  return v
}

/** snapshot -> verify -> restore into <work>/restored, then verify the restored copy against the same hashes. */
export async function runDrill({ live, work, now = () => new Date() }) {
  const snap = path.join(work, 'snapshot')
  const restored = path.join(work, 'restored')
  const manifest = await snapshotDir(live, snap, { now })
  const t0 = Date.now()
  await restoreSnapshot(snap, restored)
  const restoreMs = Date.now() - t0
  const problems = []
  for (const [rel, want] of Object.entries(manifest.files)) {
    if ((await sha256File(path.join(restored, rel)).catch(() => null)) !== want.sha256) problems.push(`restored copy differs: ${rel}`)
  }
  return { ok: problems.length === 0, problems, files: Object.keys(manifest.files).length, createdAt: manifest.createdAt, restoreMs }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, a, b] = process.argv.slice(2)
  const run = { snapshot: () => snapshotDir(a, b), verify: () => verifySnapshot(a), restore: () => restoreSnapshot(a, b), drill: () => runDrill({ live: a, work: b }) }[cmd]
  if (!run || !a) {
    console.error('usage: restore_drill.mjs snapshot|verify|restore|drill <dir> [<dir>]')
    process.exit(2)
  }
  run().then(
    (r) => {
      console.log(JSON.stringify(r.files && !r.problems ? { files: Object.keys(r.files).length, createdAt: r.createdAt } : r))
      process.exit(r.ok === false ? 1 : 0)
    },
    (e) => {
      console.error(e.message)
      process.exit(1)
    },
  )
}
