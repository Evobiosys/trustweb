// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local: the JSON-RPC 2.0 / MCP core (apps/mcp/src/protocol.ts). */
import { createMcpServer } from '../../../mcp/src/protocol.ts'

const echo = { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { x: { type: 'string' } } }, run: (a) => ({ got: a.x }) }
const boom = { name: 'boom', description: 'Fails', inputSchema: { type: 'object' }, run: () => { throw new Error('nope') } }
const srv = () => createMcpServer({ name: 'trustweb-mcp', version: '0.1.0' }, [echo, boom])
const call = async (s, msg) => { const r = await s.handle(JSON.stringify(msg)); return r === undefined ? undefined : JSON.parse(r) }

describe('createMcpServer', () => {
  it('initialize answers with tools capability and the server info, echoing a supported protocol version', async () => {
    const r = await call(srv(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } })
    expect(r.id).toBe(1)
    expect(r.result.protocolVersion).toBe('2025-03-26')
    expect(r.result.capabilities).toEqual({ tools: {} })
    expect(r.result.serverInfo).toEqual({ name: 'trustweb-mcp', version: '0.1.0' })
  })
  it('offers its newest version when the client asks for an unknown one', async () => {
    const r = await call(srv(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
    expect(r.result.protocolVersion).toBe('2025-06-18')
  })
  it('notifications get no answer', async () => {
    expect(await call(srv(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined()
  })
  it('ping answers an empty result', async () => {
    expect((await call(srv(), { jsonrpc: '2.0', id: 'p', method: 'ping' })).result).toEqual({})
  })
  it('tools/list names every tool with its schema', async () => {
    const r = await call(srv(), { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(r.result.tools.map((t) => t.name)).toEqual(['echo', 'boom'])
    expect(r.result.tools[0]).toEqual({ name: 'echo', description: 'Echo', inputSchema: echo.inputSchema })
  })
  it('tools/call returns the result as one JSON text block', async () => {
    const r = await call(srv(), { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 'hi' } } })
    expect(r.result.isError).toBeUndefined()
    expect(JSON.parse(r.result.content[0].text)).toEqual({ got: 'hi' })
  })
  it('a throwing tool is a tool error, not a protocol error', async () => {
    const r = await call(srv(), { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom', arguments: {} } })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('nope')
  })
  it('an unknown tool is a tool error', async () => {
    const r = await call(srv(), { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } })
    expect(r.result.isError).toBe(true)
  })
  it('unknown method -> -32601; broken JSON -> -32700 with null id; non-object params -> -32602', async () => {
    expect((await call(srv(), { jsonrpc: '2.0', id: 6, method: 'resources/list' })).error.code).toBe(-32601)
    const bad = JSON.parse(await srv().handle('{not json'))
    expect(bad.error.code).toBe(-32700)
    expect(bad.id).toBeNull()
    expect((await call(srv(), { jsonrpc: '2.0', id: 7, method: 'tools/call', params: 'x' })).error.code).toBe(-32602)
  })
  it('a request that is not JSON-RPC 2.0 is -32600', async () => {
    expect((await call(srv(), { id: 8, method: 'ping' })).error.code).toBe(-32600)
  })
})
