// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 handshake-crypto, MCP parity (P02): handshake_status, a read tool. Fake data only. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

function fixture(write) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcphs-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({
    v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [], inventory: [], log: [],
    peers: [
      { id: 'p1', displayName: 'Sealed One', did: 'd1', ring: 'acquaintance', connectedAt: 1, handshake: 'qr', qk: 'secretsecretsecret0000' },
      { id: 'p2', displayName: 'Old One', did: 'd2', ring: 'acquaintance', connectedAt: 2 },
      { id: 'p3', displayName: 'Heard', did: 'd3', ring: 'acquaintance', connectedAt: 3, heardAt: 4, handshake: 'did' },
    ],
    handshakeLog: [{ at: 5, reason: 'tampered', from: 'abcd1234' }],
  }))
  return Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') }).map((t) => [t.name, t]))
}

describe('handshake_status', () => {
  it('is a read tool, listed in MCP_TOOLS', () => {
    expect(Object.keys(fixture(false))).toContain('handshake_status')
    expect(MCP_TOOLS).toContainEqual({ name: 'handshake_status', write: false })
  })
  it('says per pending connect whether its handshake is encrypted, and lists the refused ones; never a QR secret', () => {
    const out = fixture(false).handshake_status.run({})
    expect(out).toEqual({
      version: 2,
      pending: [{ id: 'p1', name: 'Sealed One', encrypted: true, mode: 'qr' }, { id: 'p2', name: 'Old One', encrypted: false, mode: null }],
      refused: [{ at: 5, reason: 'tampered', from: 'abcd1234' }],
    })
    expect(JSON.stringify(out)).not.toContain('secretsecret')
  })
})
