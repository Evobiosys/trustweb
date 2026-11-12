// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * trustweb-mcp (wave 40): an MCP server over this machine's TrustWeb record. Default: stdio (what pi, Claude Code and Mistral start as a child).
 * Optional `--http <port>`: loopback only, token required (http.ts).
 * Env: TW_RECORD (default ~/.cache/trustweb-dev/dev-record.live.json), TW_MCP_WRITE=1 (else read-only), TW_MCP_TOOLS=a,b (only these tools),
 * TW_MCP_TOKEN (HTTP mode).
 * Run: node apps/mcp/src/server.ts
 */
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { createHttpServer } from './http.ts'
import { createMcpServer } from './protocol.ts'
import { recordTools, toolAllow } from './record_tools.ts'

const env = process.env
const tools = recordTools({
  file: env.TW_RECORD || path.join(homedir(), '.cache/trustweb-dev/dev-record.live.json'),
  write: env.TW_MCP_WRITE === '1',
  // Review wave 40: an empty TW_MCP_TOOLS (every tool switched off) offers none; only an absent one offers all.
  ...(env.TW_MCP_TOOLS !== undefined ? { allow: toolAllow(env.TW_MCP_TOOLS) } : {}),
})
const { handle } = createMcpServer({ name: 'trustweb-mcp', version: '0.1.0' }, tools)

const at = process.argv.indexOf('--http')
if (at >= 0) {
  const port = Number(process.argv[at + 1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('usage: server.ts [--http <port>]'); process.exit(2) }
  let server: ReturnType<typeof createHttpServer>
  try { server = createHttpServer(handle, env.TW_MCP_TOKEN ?? '') } catch (e) { console.error((e as Error).message); process.exit(2) }
  server.listen(port, '127.0.0.1', () => console.error(`trustweb-mcp: http://127.0.0.1:${port}/ (POST, bearer token)`))
} else {
  const lines = createInterface({ input: process.stdin })
  let busy: Promise<void> = Promise.resolve()   // answers keep the order of the questions
  lines.on('line', (line) => {
    if (!line.trim()) return
    busy = busy.then(async () => { const out = await handle(line); if (out !== undefined) process.stdout.write(out + '\n') })
  })
}
