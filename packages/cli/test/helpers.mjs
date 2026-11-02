// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Shared by the CLI tests: an in-memory Io (no disk, no network) and made-up ids only (fruit names, no personal data). */
import { run } from '../src/cli.ts'

export const NOW = '2026-10-27T12:00:00.000Z'
export const LATER = '2026-11-01T09:30:00.000Z'

/** An Io over a plain object of files. `archive` records where a replaced file went. */
export function memIo({ files = {}, stdin = '', env = {}, now = NOW } = {}) {
  const io = {
    files: { ...files },
    archived: [],
    stdout: '',
    stderr: '',
    env,
    clock: now,
    now: () => new Date(io.clock),
    exists: (p) => p in io.files,
    readFile: (p) => {
      if (!(p in io.files)) throw new Error(`ENOENT: ${p}`)
      return io.files[p]
    },
    writeFile: (p, text) => { io.files[p] = text },
    readStdin: () => stdin,
    moveToArchive: (p) => {
      const to = `archive/${p}.${io.archived.length + 1}`
      io.files[to] = io.files[p]
      delete io.files[p]
      io.archived.push(to)
      return to
    },
    out: (s) => { io.stdout += s },
    err: (s) => { io.stderr += s },
  }
  return io
}

/** Runs one command line; returns its exit code and only this call's output. */
export function cli(io, ...argv) {
  io.stdout = ''
  io.stderr = ''
  const code = run(argv, io)
  return { code, out: io.stdout, err: io.stderr }
}

/** A fresh record with a few zones, people, tags and shares, for the read-side tests. */
export function seeded() {
  const io = memIo()
  const steps = [
    ['init'],
    ['zone', 'create', 'allies', '--level', 'close', '--name', 'Allies'],
    ['zone', 'add', 'friend', 'person:fig', 'person:kiwi'],
    ['zone', 'add', 'allies', 'person:plum', 'tag:garden'],
    ['person', 'tag', 'kiwi', 'garden'],
    ['tag', 'create', 'seedlings', '--label', 'Seedlings'],
    ['tag', 'nest', 'seedlings', 'garden'],
    ['person', 'add', 'pear', '--name', 'Pear'],
    ['person', 'tag', 'pear', 'seedlings'],
    ['share', 'bike', '--zone', 'friend'],
    ['share', 'ladder', '--zone', 'close', '--include', 'tag:garden'],
    ['share', 'recipe', '--zone', 'public'],
    ['share', 'tools', '--zone', 'friend', '--exclude', 'person:kiwi'],
  ]
  for (const s of steps) {
    const r = cli(io, ...s)
    if (r.code !== 0) throw new Error(`seed step ${s.join(' ')} failed: ${r.err}`)
  }
  return io
}
