// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Dev endpoint /__tw/matches: loopback only, slices the side file from=n. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { matchesReply } from '../../vite_matches.mjs'

const dir = mkdtempSync(path.join(tmpdir(), 'twm-'))
writeFileSync(path.join(dir, 'dev-matches.jsonl'), 'a\nb\nc\n')
writeFileSync(path.join(dir, 'dev-matches-status.json'), '{"phase":"running","done":2,"total":9}')
const ok = { host: '127.0.0.1:5400' }

describe('matchesReply', () => {
  it('slices from n and reports next and status', () => {
    expect(matchesReply(dir, '/?from=1', ok)).toEqual({ code: 200, body: { lines: ['b', 'c'], next: 3, status: { phase: 'running', done: 2, total: 9 } } })
  })
  it('answers 403 on a foreign Host or any Origin', () => {
    expect(matchesReply(dir, '/', { host: 'evil.example.com' }).code).toBe(403)
    expect(matchesReply(dir, '/', { ...ok, origin: 'http://evil.example.com' }).code).toBe(403)
  })
  it('is empty while the service never ran', () => {
    expect(matchesReply(path.join(dir, 'none'), '/', ok).body).toEqual({ lines: [], next: 0, status: null })
  })
})
