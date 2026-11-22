// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 sync-errors-retry: the classifier picks the cause; the cause picks the first fix; MCP sync_status shows it. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { classifySyncError } from '../../src/sync_error.ts'
import { SchemaNewerError } from '../../src/schema_version.ts'
import { S } from '../../src/strings.ts'
import { allTools } from '../../../mcp/src/tools.ts'

const fail = (m) => new Error(m)

describe('classifySyncError', () => {
  it('offline browser = airplane mode / Wi-Fi, whatever the error says', () => {
    expect(classifySyncError(fail('offline'), false)).toBe('airplane')
    expect(classifySyncError(new TypeError('Failed to fetch'), false)).toBe('airplane')
    expect(classifySyncError(fail('version'), false)).toBe('airplane')
  })
  it('a network failure or a relay answer 5xx/404/429 while online = relay unreachable', () => {
    expect(classifySyncError(new TypeError('Failed to fetch'), true)).toBe('relay')
    expect(classifySyncError(new TypeError('NetworkError when attempting to fetch resource.'), true)).toBe('relay')
    for (const s of [500, 502, 503, 504, 404, 429]) expect(classifySyncError(fail(`RelayChannel.send: relay ingress http://x/relay/send responded ${s}`), true)).toBe('relay')
  })
  it('a different protocol or schema version = schema (update the app)', () => {
    expect(classifySyncError(fail('version'), true)).toBe('schema')
    expect(classifySyncError(new SchemaNewerError(9), true)).toBe('schema')
  })
  it('an unlinked device or a relay 401/403 = auth (pair again)', () => {
    expect(classifySyncError(fail('not linked'), true)).toBe('auth')
    expect(classifySyncError(fail('RelayChannel.send: relay ingress http://x/relay/send responded 401'), true)).toBe('auth')
    expect(classifySyncError(fail('RelayChannel.send: relay ingress http://x/relay/send responded 403'), true)).toBe('auth')
  })
  it('the other device not answering, too large, receive only keep their own cause; the rest is other', () => {
    expect(classifySyncError(fail('offline'), true)).toBe('device-off')
    expect(classifySyncError(fail('too large'), true)).toBe('too-large')
    expect(classifySyncError(fail('receive only'), true)).toBe('receive-only')
    expect(classifySyncError(fail('boom'), true)).toBe('other')
    expect(classifySyncError('x', true)).toBe('other')
    expect(classifySyncError(undefined, true)).toBe('other')
  })
})

describe('first-fix texts', () => {
  it('say what Jakob asked for', () => {
    expect(S.syncErr.airplane).toBe('Turn off airplane mode / check Wi-Fi')
    expect(S.syncErr.relay).toBe('The relay is down, retry in a minute')
    expect(S.syncErr.schema).toBe('Update the app')
    expect(S.syncErr.auth).toBe('Pair again')
    expect(S.syncErr.retry).toBe('Retry')
  })
})

describe('sync_status over MCP shows the last error', () => {
  const fx = (rec) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-sync-err-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, people: [], ...rec }))
    return Object.fromEntries(allTools({ file, write: false }).map((t) => [t.name, t]))
  }
  it('error = {cause, hint} or null', () => {
    expect(fx({ syncStatus: { devices: 1, lastAt: 0 } }).sync_status.run({}).error).toBeNull()
    expect(fx({ syncStatus: { devices: 1, lastAt: 0, error: 'relay' } }).sync_status.run({}).error).toEqual({ cause: 'relay', hint: 'The relay is down, retry in a minute' })
    expect(fx({ syncStatus: { devices: 1, lastAt: 0, error: 'bogus' } }).sync_status.run({}).error).toBeNull()
  })
})
