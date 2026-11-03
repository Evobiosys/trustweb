// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// @ts-nocheck  (fs/os/path: the crm tsconfig carries no node types; vitest runs this in node)
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireLock, pidAlive } from '../../scripts/notes_lock.mjs'

const NOW = Date.UTC(2026, 10, 3, 9, 0)
const lockFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'lock-')), 'pull.lock')
const plant = (file, pid, startedAt) => writeFileSync(file, JSON.stringify({ pid, startedAt: new Date(startedAt).toISOString(), host: 'h' }))

describe('notes_lock', () => {
  it('acquire: creates the file with pid, startedAt and host', () => {
    const f = lockFile()
    const l = acquireLock(f, { now: NOW, pid: 4242, alive: () => true })
    expect(l.ok).toBe(true)
    const d = JSON.parse(readFileSync(f, 'utf8'))
    expect(d.pid).toBe(4242)
    expect(d.startedAt).toBe(new Date(NOW).toISOString())
    expect(typeof d.host).toBe('string')
  })
  it('held: a live pid younger than staleMs keeps the lock; the file is untouched', () => {
    const f = lockFile()
    plant(f, 777, NOW - 60_000)
    const before = readFileSync(f, 'utf8')
    const l = acquireLock(f, { now: NOW, pid: 4242, alive: (p) => p === 777 })
    expect(l).toEqual({ ok: false, held: { pid: 777, startedAt: new Date(NOW - 60_000).toISOString() } })
    expect(readFileSync(f, 'utf8')).toBe(before)
  })
  it('stale by dead pid: taken over', () => {
    const f = lockFile()
    plant(f, 777, NOW - 60_000)
    const l = acquireLock(f, { now: NOW, pid: 4242, alive: () => false })
    expect(l.ok).toBe(true)
    expect(JSON.parse(readFileSync(f, 'utf8')).pid).toBe(4242)
  })
  it('stale by age: a live pid older than staleMs is taken over (pid reuse after a crash)', () => {
    const f = lockFile()
    plant(f, 777, NOW - 7 * 3600e3)
    expect(acquireLock(f, { now: NOW, pid: 4242, alive: () => true }).ok).toBe(true)
    plant(f, 777, NOW - 7 * 3600e3)
    expect(acquireLock(f, { now: NOW, pid: 4242, alive: () => true, staleMs: 8 * 3600e3 }).ok).toBe(false)
  })
  it('an unreadable lock file counts as stale', () => {
    const f = lockFile()
    writeFileSync(f, '')
    expect(acquireLock(f, { now: NOW, pid: 4242, alive: () => true }).ok).toBe(true)
  })
  it('release removes the file only while it still holds our pid; twice is harmless', () => {
    const f = lockFile()
    const l = acquireLock(f, { now: NOW, pid: 4242, alive: () => true })
    l.release()
    expect(existsSync(f)).toBe(false)
    l.release()
    const m = acquireLock(f, { now: NOW, pid: 4242, alive: () => true })
    plant(f, 999, NOW)   // someone took it over (we were judged stale)
    m.release()
    expect(JSON.parse(readFileSync(f, 'utf8')).pid).toBe(999)
  })
  it('pidAlive: this process is alive, a non-positive or absurd pid is not', () => {
    expect(pidAlive(process.pid)).toBe(true)
    expect(pidAlive(0)).toBe(false)
    expect(pidAlive(-1)).toBe(false)
    expect(pidAlive(2 ** 30)).toBe(false)
  })
})
