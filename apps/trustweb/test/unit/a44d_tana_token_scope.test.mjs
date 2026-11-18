// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 5 (Jakob 00:18: "make sure the personal devices only hold the Tana token"): a Tana token or credential that ever reaches the
 * record is stripped from what leaves this device: the device-sync bundle and delta (sync_core), the JSON export, the MCP reads. The token itself
 * lives in this browser's storage only (tana_token.ts), never in the record. Fake data only.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scrubSecrets, isTanaSecret } from '../../src/secret_scrub.ts'
import { bundleOf, deltaOf } from '../../src/sync_core.ts'
import { exportFiles } from '../../src/sovereign_switch.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { S } from '../../src/strings.ts'

const SECRET = 'tana-SECRET-0123456789'
const rec = () => ({
  v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], events: [],
  people: [{ id: 'a', name: 'Ada', ring: 'friend', lines: [], context: '', metAt: 1, fields: { tanaToken: SECRET, mentor: 'true' } }],
  tanaToken: SECRET, tana_api_key: SECRET,
  extData: { tana: { token: SECRET, workspace: 'w1' }, other: { token: 'keep-me' } },
  twSettings: { importTana: { apiToken: SECRET, on: true } },
})
const leaks = (v) => JSON.stringify(v).includes(SECRET)

describe('isTanaSecret / scrubSecrets', () => {
  it('names: a Tana token, key or secret, also as a child of a "tana" object; other tokens stay', () => {
    expect(isTanaSecret(['tanaToken'])).toBe(true)
    expect(isTanaSecret(['tana_api_key'])).toBe(true)
    expect(isTanaSecret(['extData', 'tana', 'token'])).toBe(true)
    expect(isTanaSecret(['twSettings', 'importTana', 'apiToken'])).toBe(true)
    expect(isTanaSecret(['extData', 'other', 'token'])).toBe(false)
    expect(isTanaSecret(['tana', 'workspace'])).toBe(false)
  })
  it('a deep copy without them; the input is untouched', () => {
    const r = rec()
    const out = scrubSecrets(r)
    expect(leaks(out)).toBe(false)
    expect(out.extData).toEqual({ tana: { workspace: 'w1' }, other: { token: 'keep-me' } })
    expect(out.people[0].fields).toEqual({ mentor: 'true' })
    expect(leaks(r)).toBe(true)
  })
})

describe('Settings > Import > Tana says where the token lives and what it grants', () => {
  it('one line', () => {
    expect(S.a44d.tanaStays).toBe('Token stays on this computer only.')
    expect(S.a44d.tanaGrants).toMatch(/read/)
  })
})

describe('nothing Tana leaves the device', () => {
  it('device sync: the full bundle and the delta', () => {
    const r = rec()
    expect(leaks(bundleOf(r, {}))).toBe(false)
    const stamps = { 'p:a': { at: 5, by: 'dev1' } }
    const d = deltaOf(r, stamps, 0, 'dev1')
    expect(d && leaks(d)).toBe(false)
  })
  it('the export (Settings > Sovereign Switch: record.json, log.jsonl, markdown)', () => {
    expect(exportFiles(rec(), 1).some((f) => leaks(f.data))).toBe(false)
  })
  it('MCP reads (get_person, list_people, settings)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-a44d-tana-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify(rec()))
    const by = Object.fromEntries(allTools({ file, write: false }).map((t) => [t.name, t]))
    expect(leaks(by.get_person.run({ person: 'a' }))).toBe(false)
    expect(leaks(by.list_people.run({}))).toBe(false)
    expect(leaks(by.settings_list.run({}))).toBe(false)
  })
})
