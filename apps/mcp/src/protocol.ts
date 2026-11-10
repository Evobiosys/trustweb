// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: the small part of MCP (Model Context Protocol, JSON-RPC 2.0) a tools-only server needs:
 * initialize, ping, tools/list, tools/call. One message in (a line of JSON), one message out (or none for a notification).
 * No SDK: @modelcontextprotocol/sdk is not installed here and four methods do not need it.
 */
export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
type Id = string | number | null
const reply = (id: Id, result: unknown): string => JSON.stringify({ jsonrpc: '2.0', id, result })
const fail = (id: Id, code: number, message: string): string => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function createMcpServer(info: { name: string; version: string }, tools: readonly Tool[]): { handle: (line: string) => Promise<string | undefined> } {
  async function callTool(params: Record<string, unknown>): Promise<unknown> {
    const tool = tools.find((t) => t.name === params.name)
    if (!tool) return { isError: true, content: [{ type: 'text', text: `unknown tool: ${String(params.name)}` }] }
    try {
      const out = await tool.run(isObj(params.arguments) ? params.arguments : {})
      return { content: [{ type: 'text', text: JSON.stringify(out) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }
    }
  }

  async function handle(line: string): Promise<string | undefined> {
    let msg: unknown
    try { msg = JSON.parse(line) } catch { return fail(null, -32700, 'parse error') }
    if (!isObj(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(isObj(msg) && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null, -32600, 'invalid request')
    if (msg.id === undefined) return undefined   // a notification: no answer
    const id = msg.id as Id
    const params = msg.params
    if (params !== undefined && !isObj(params)) return fail(id, -32602, 'params must be an object')
    switch (msg.method) {
      case 'initialize': {
        const asked = params?.protocolVersion
        return reply(id, { protocolVersion: typeof asked === 'string' && VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: {} }, serverInfo: info })
      }
      case 'ping': return reply(id, {})
      case 'tools/list': return reply(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      case 'tools/call': return reply(id, await callTool(params ?? {}))
      default: return fail(id, -32601, `method not found: ${msg.method}`)
    }
  }
  return { handle }
}
