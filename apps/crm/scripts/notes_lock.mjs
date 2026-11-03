// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// A lock file for scheduled runs (launchd / cron / systemd every 15 min): a second pull never starts while one is still reading.
//   const l = acquireLock(file)            -> { ok: true, release() } | { ok: false, held: { pid, startedAt } }
//   releaseOnExit(l)                       release on exit, SIGINT, SIGTERM (then exit 130 / 143)
// The file is created atomically (flag 'wx') with JSON { pid, startedAt: ISO, host }. An existing lock is honoured while its pid is
// alive (kill(pid, 0); EPERM = alive, ESRCH = dead) AND it is younger than staleMs (default 6 h, so a reused pid cannot hold it
// forever); otherwise it is stale: removed and taken. An unreadable file is stale. release() removes the file only while it still
// holds our pid. The lock file is not user data: removing it loses nothing. `alive`, `now`, `pid` injectable for tests.
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'

export const STALE_MS = 6 * 3600e3

/** Is a process with this pid running? A pid that is not a positive integer never is (kill(0) would hit our own group). */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function readLock(file) {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'))
    return { pid: Number(d.pid), startedAt: String(d.startedAt) }
  } catch (e) {
    if (e.code === 'ENOENT') return null
    return { pid: 0, startedAt: '' }   // empty or broken: stale
  }
}

function create(file, pid, now) {
  try {
    writeFileSync(file, `${JSON.stringify({ pid, startedAt: new Date(now).toISOString(), host: hostname() })}\n`, { flag: 'wx' })
    return true
  } catch (e) {
    if (e.code === 'EEXIST') return false
    throw e
  }
}

export function acquireLock(file, { staleMs = STALE_MS, now = Date.now(), alive = pidAlive, pid = process.pid } = {}) {
  const release = () => { if (readLock(file)?.pid === pid) try { unlinkSync(file) } catch { /* already gone */ } }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (create(file, pid, now)) return { ok: true, release }
    const held = readLock(file)
    if (!held) continue   // released between our two calls
    const age = now - Date.parse(held.startedAt)
    if (alive(held.pid) && age < staleMs) return { ok: false, held }   // a NaN age (no startedAt) is stale
    try { unlinkSync(file) } catch { /* another run removed it first */ }
  }
  const held = readLock(file) ?? { pid: 0, startedAt: '' }   // lost the takeover race to another run
  return { ok: false, held }
}

/** Release the lock when the process ends, however it ends (Ctrl-C, launchd/systemd stop, process.exit). */
export function releaseOnExit(lock) {
  if (!lock.ok) return
  process.once('exit', lock.release)
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(sig, () => { lock.release(); process.exit(code) })
}
