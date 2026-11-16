// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b hide-from-crypto, MCP parity (P02): ask_tamper_reports_list, a read tool. Fake data only. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

function fixture(write, extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcphide-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [], inventory: [], log: [], peers: [], ...extra }))
  return Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') }).map((t) => [t.name, t]))
}

describe('ask_tamper_reports_list', () => {
  it('is a read tool, listed in MCP_TOOLS', () => {
    expect(Object.keys(fixture(false))).toContain('ask_tamper_reports_list')
    expect(MCP_TOOLS).toContainEqual({ name: 'ask_tamper_reports_list', write: false })
  })
  it('lists the verified reports, newest first; none = empty', () => {
    const reports = [{ askId: 'r2', text: 'Who has a ladder?', step: 2, why: 'tampered', at: 5 }, { askId: 'r1', text: 'Drill?', step: 3, why: 'unsupported', at: 4 }]
    expect(fixture(false, { hideReports: reports }).ask_tamper_reports_list.run({})).toEqual({ reports })
    expect(fixture(false).ask_tamper_reports_list.run({})).toEqual({ reports: [] })
  })
})
