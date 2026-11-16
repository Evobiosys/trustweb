// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-embed (MCP parity D-P02): feed_embed_link over the record file, fetch injected. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const json = (o, status = 200) => new Response(JSON.stringify(o), { status })
function fixture(fetchFn, write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpfe-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], sameAs: {}, meetings: [], me: { id: 'me', displayName: 'T' } }))
  const tools = recordTools({ file, write, embedFetch: fetchFn, now: () => new Date('2026-11-16T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}
const status = { id: '9', created_at: '2026-11-15T08:00:00Z', content: '<p>Hi</p>', account: { username: 'al', acct: 'al', display_name: 'Al' } }

describe('feed_embed_link', () => {
  it('is a change (only with writes on) and listed in MCP_TOOLS', () => {
    expect(Object.keys(fixture(async () => json(status), false).by)).not.toContain('feed_embed_link')
    expect(Object.keys(fixture(async () => json(status)).by)).toContain('feed_embed_link')
    expect(MCP_TOOLS).toContainEqual({ name: 'feed_embed_link', write: true })
  })
  it('fetches one post and keeps it in the record', async () => {
    const f = fixture(async () => json(status))
    expect(await f.by.feed_embed_link.run({ url: 'https://mastodon.social/@al/9' })).toMatchObject({ who: 'Al', text: 'Hi', added: true })
    expect(f.rec().feedEmbeds).toHaveLength(1)
    expect(await f.by.feed_embed_link.run({ url: 'https://mastodon.social/@al/9' })).toMatchObject({ added: false })
    expect(f.rec().feedEmbeds).toHaveLength(1)
  })
  it('an x.com link becomes a link card; a non-link is refused', async () => {
    const f = fixture(async () => { throw new Error('no network') })
    expect(await f.by.feed_embed_link.run({ url: 'https://x.com/a/status/1' })).toMatchObject({ card: true, linkHost: 'x.com' })
    await expect(f.by.feed_embed_link.run({ url: 'hello' })).rejects.toThrow(/link/)
  })
})
