// Disk layer of the hosted recordings. Its own directory (HOSTED_DIR), never BACKUP_DIR.
//
//   <dir>/accounts/<account>/account.json          {v, token (sha256 hex), created, tSeconds, tCount}
//   <dir>/accounts/<account>/recs/<rid>.json       {seconds, bytes, stored, etag, readHash|null, file}
//   <dir>/accounts/<account>/recs/<file>           the ciphertext (file = "<rid>.<random>.bin": every version has its own file,
//                                                  the json is the atomic pointer; a reader never sees a half-replaced recording)
//   <dir>/tmp/                                     uploads in flight (0600), emptied at start
//
// Crash safety: a version file is renamed into recs/ before its json pointer is written, and the replaced version is
// removed after. A crash between those steps leaves a ciphertext file no json points at: removeOrphans() deletes such
// files at start (before any request), so they never escape the byte count.
//
// A recording exists iff its json exists. "Touched" (for retention) = the json's mtime: a write or an owner/capability read.
// The ciphertext is opaque; nothing here parses it.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const RESCAN_AFTER_MS = 600000

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function ignoreMissing(promise) {
  try {
    await promise
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

export async function createHostedStore(cfg) {
  const root = cfg.hostedDir
  const accountsDir = path.join(root, 'accounts')
  const tmpDir = path.join(root, 'tmp')
  await fs.mkdir(accountsDir, { recursive: true, mode: 0o700 })
  await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 })
  for (const name of await fs.readdir(tmpDir)) await fs.rm(path.join(tmpDir, name), { force: true })

  let totalBytes = 0
  let reservedBytes = 0
  let lastScan = 0

  const accountDir = (account) => path.join(accountsDir, account)
  const recsDir = (account) => path.join(accountDir(account), 'recs')

  async function writeJsonAtomic(file, value) {
    const tmp = path.join(tmpDir, crypto.randomBytes(12).toString('hex'))
    await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    await fs.rename(tmp, file)
  }

  async function loadAccount(account) {
    return readJson(path.join(accountDir(account), 'account.json'))
  }

  async function saveAccount(account, data) {
    await fs.mkdir(recsDir(account), { recursive: true, mode: 0o700 })
    await writeJsonAtomic(path.join(accountDir(account), 'account.json'), data)
  }

  async function claimAccount(account, tokenHash) {
    await saveAccount(account, { v: 1, token: tokenHash, created: new Date(cfg.now()).toISOString(), tSeconds: 0, tCount: 0 })
  }

  /** Recordings of an account: [{id, seconds, bytes, stored, etag, readHash, file}]. */
  async function listRecs(account) {
    let names
    try {
      names = await fs.readdir(recsDir(account))
    } catch (err) {
      if (err.code === 'ENOENT') return []
      throw err
    }
    const recs = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const meta = await readJson(path.join(recsDir(account), name))
      if (meta !== null) recs.push({ id: name.slice(0, -5), ...meta })
    }
    return recs.sort((a, b) => (a.stored < b.stored ? -1 : a.stored > b.stored ? 1 : 0))
  }

  async function getRec(account, id) {
    const meta = await readJson(path.join(recsDir(account), `${id}.json`))
    return meta === null ? null : { id, ...meta }
  }

  function recFile(account, rec) {
    return path.join(recsDir(account), rec.file)
  }

  function newTmpFile() {
    return path.join(tmpDir, crypto.randomBytes(12).toString('hex'))
  }

  /** Moves a finished upload into place and swings the json pointer. Returns the replaced recording or null. Caller holds the account lock. */
  async function commitRecording(account, { id, tmpFile, seconds, bytes, etag, readHash }) {
    await fs.mkdir(recsDir(account), { recursive: true, mode: 0o700 })
    const old = await getRec(account, id)
    const file = `${id}.${crypto.randomBytes(6).toString('hex')}.bin`
    await fs.rename(tmpFile, path.join(recsDir(account), file))
    const meta = { seconds, bytes, stored: new Date(cfg.now()).toISOString(), etag, readHash, file }
    await writeJsonAtomic(path.join(recsDir(account), `${id}.json`), meta)
    if (old !== null) await ignoreMissing(fs.rm(recFile(account, old)))
    totalBytes += bytes - (old?.bytes ?? 0)
    return old
  }

  /** Removes a recording (json first, so a reader never finds a pointer without its file). Returns the removed one or null. */
  async function deleteRecording(account, id) {
    const old = await getRec(account, id)
    if (old === null) return null
    await ignoreMissing(fs.rm(path.join(recsDir(account), `${id}.json`)))
    await ignoreMissing(fs.rm(recFile(account, old)))
    totalBytes = Math.max(0, totalBytes - old.bytes)
    return old
  }

  /** Marks a recording as touched (retention clock) without rewriting it. */
  async function touch(account, id) {
    const t = new Date(cfg.now())
    await ignoreMissing(fs.utimes(path.join(recsDir(account), `${id}.json`), t, t))
  }

  /** Changes the transcription counters of an account (negative = refund). Caller holds the account lock. */
  async function adjustTranscribed(account, deltaSeconds, deltaCount = 0) {
    const acct = await loadAccount(account)
    if (acct === null) return
    acct.tSeconds = Math.max(0, acct.tSeconds + deltaSeconds)
    acct.tCount = Math.max(0, acct.tCount + deltaCount)
    await saveAccount(account, acct)
  }

  /** Start only (no request in flight): deletes version files that no json points at. Returns how many. */
  async function removeOrphans() {
    let removed = 0
    for (const account of await fs.readdir(accountsDir)) {
      let names
      try {
        names = await fs.readdir(recsDir(account))
      } catch (err) {
        if (err.code === 'ENOENT') continue
        throw err
      }
      const live = new Set((await listRecs(account)).map((r) => r.file))
      for (const name of names) {
        if (name.endsWith('.json') || live.has(name)) continue
        await ignoreMissing(fs.rm(path.join(recsDir(account), name)))
        removed += 1
      }
    }
    return removed
  }

  /** Sums every recording (startup, and every 10 minutes so an external sweep is noticed). */
  async function rescan() {
    let sum = 0
    for (const account of await fs.readdir(accountsDir)) {
      for (const rec of await listRecs(account)) sum += rec.bytes
    }
    totalBytes = sum
    lastScan = cfg.now()
    return sum
  }

  async function freeDiskBytes() {
    if (cfg.freeBytes) return cfg.freeBytes()
    const s = await fs.statfs(root)
    return Number(s.bavail) * Number(s.bsize)
  }

  /** Bytes the server may still take for hosted data: the cap minus reservations, and the free-disk floor. */
  async function globalRemaining() {
    if (cfg.now() - lastScan > RESCAN_AFTER_MS) await rescan()
    const free = await freeDiskBytes()
    // Both read after the last await, so a reservation made meanwhile by another upload is counted.
    const byCap = cfg.hostedMaxBytes - totalBytes - reservedBytes
    const byDisk = free - cfg.hostedMinFreeBytes - reservedBytes
    return Math.min(byCap, byDisk)
  }

  await removeOrphans()
  await rescan()

  return {
    loadAccount,
    saveAccount,
    claimAccount,
    listRecs,
    getRec,
    recFile,
    newTmpFile,
    commitRecording,
    deleteRecording,
    touch,
    adjustTranscribed,
    rescan,
    globalRemaining,
    reserve: (n) => {
      reservedBytes += n
    },
    release: (n) => {
      reservedBytes = Math.max(0, reservedBytes - n)
    },
    totalBytes: () => totalBytes,
    accountsDir,
  }
}

/**
 * Retention sweep (a function, not a daemon): recordings untouched for `retentionDays` are removed, and so are
 * accounts without recordings that were idle as long. dryRun (the default) only reports. Operates on the
 * directory directly, so it can run while the server runs (only idle data is touched; the server re-sums its
 * byte total within 10 minutes).
 */
export async function sweepHosted(dir, { retentionDays = 90, dryRun = true, now = Date.now() } = {}) {
  const cutoff = now - retentionDays * 86400000
  const accountsDir = path.join(dir, 'accounts')
  const report = { dryRun, retentionDays, recordings: [], accounts: [], freedBytes: 0 }
  let accounts = []
  try {
    accounts = await fs.readdir(accountsDir)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  for (const account of accounts) {
    const recsDir = path.join(accountsDir, account, 'recs')
    let names = []
    try {
      names = await fs.readdir(recsDir)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    let remaining = 0
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const jsonFile = path.join(recsDir, name)
      const stat = await fs.stat(jsonFile)
      if (stat.mtimeMs >= cutoff) {
        remaining += 1
        continue
      }
      const meta = await readJson(jsonFile)
      report.recordings.push({ account, id: name.slice(0, -5), bytes: meta?.bytes ?? 0, idleDays: Math.floor((now - stat.mtimeMs) / 86400000) })
      report.freedBytes += meta?.bytes ?? 0
      if (!dryRun) {
        await ignoreMissing(fs.rm(jsonFile))
        if (meta?.file) await ignoreMissing(fs.rm(path.join(recsDir, meta.file)))
      }
    }
    if (remaining === 0) {
      let accountStat = null
      try {
        accountStat = await fs.stat(path.join(accountsDir, account, 'account.json'))
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
      if (accountStat === null || accountStat.mtimeMs < cutoff) {
        report.accounts.push({ account })
        if (!dryRun) await fs.rm(path.join(accountsDir, account), { recursive: true, force: true })
      }
    }
  }
  return report
}
