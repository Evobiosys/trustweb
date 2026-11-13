// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 mcp-parity: the two dev-server answers (vite_dev_record.mjs): where the MCP program is (GET /__tw/mcp-info), and what it just did (GET /__tw/mcp-events). */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { announce } from '../../../mcp/src/events.ts'
import { mcpEventsReply, mcpInfoReply } from '../../vite_dev_record.mjs'

const ok = { host: '127.0.0.1:5420' }
const dir = mkdtempSync(path.join(tmpdir(), 'tw-routes-'))
const file = path.join(dir, 'live.json')
writeFileSync(file, '{"v":1,"people":[]}')
const SERVER = '/abs/checkout/apps/mcp/src/server.ts'

describe('GET /__tw/mcp-info', () => {
  it('names the absolute server path; the record only when the live file is not the default', () => {
    expect(JSON.parse(mcpInfoReply('GET', ok, { serverPath: SERVER, recordFile: undefined }).body)).toEqual({ server: SERVER })
    expect(JSON.parse(mcpInfoReply('GET', ok, { serverPath: SERVER, recordFile: file }).body)).toEqual({ server: SERVER, record: file })
  })
  it('loopback host, no foreign origin, local client, GET only', () => {
    expect(mcpInfoReply('GET', { host: 'evil.example.com' }, { serverPath: SERVER }).code).toBe(403)
    expect(mcpInfoReply('GET', { ...ok, origin: 'http://evil.example.com' }, { serverPath: SERVER }).code).toBe(403)
    expect(mcpInfoReply('GET', ok, { serverPath: SERVER, remote: '192.168.1.9' }).code).toBe(403)
    expect(mcpInfoReply('POST', ok, { serverPath: SERVER }).code).toBe(405)
  })
})

describe('GET /__tw/mcp-events', () => {
  it('without a cursor it answers the end of the list and no events (a page never replays the past)', () => {
    announce(file, { at: '2026-11-12T10:00:00Z', kind: 'record', tool: 'set_ring', summary: 'set_ring {}' })
    const r = JSON.parse(mcpEventsReply(file, 'GET', ok, '').body)
    expect(r).toEqual({ events: [], next: 1 })
  })
  it('with a cursor it answers the lines after it', () => {
    announce(file, { at: '2026-11-12T10:00:01Z', kind: 'action', tool: 'app_action', summary: 'open', action: { type: 'open', args: { place: 'web' } } })
    const r = JSON.parse(mcpEventsReply(file, 'GET', ok, 'from=1').body)
    expect(r.next).toBe(2)
    expect(r.events.map((e) => e.tool)).toEqual(['app_action'])
    expect(JSON.parse(mcpEventsReply(file, 'GET', ok, 'from=2').body).events).toEqual([])
  })
  it('refuses a foreign host, a foreign origin, a remote client and non-GET', () => {
    expect(mcpEventsReply(file, 'GET', { host: 'evil.example.com' }, 'from=0').code).toBe(403)
    expect(mcpEventsReply(file, 'GET', { ...ok, origin: 'http://evil.example.com' }, 'from=0').code).toBe(403)
    expect(mcpEventsReply(file, 'GET', ok, 'from=0', { remote: '10.0.0.5' }).code).toBe(403)
    expect(mcpEventsReply(file, 'POST', ok, 'from=0').code).toBe(405)
  })
  it('a bad cursor counts as none', () => {
    expect(JSON.parse(mcpEventsReply(file, 'GET', ok, 'from=abc').body).events).toEqual([])
  })
})
