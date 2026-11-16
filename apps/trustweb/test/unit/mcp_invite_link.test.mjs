// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-invite-link, MCP parity: invite_link_create / invite_link_revoke / invite_link_status. Fake identity only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { createIdentity, serializeIdentity, verifyDidSignature } from '../../../demo/src/did.ts'
import { connectLinkOf } from '../../src/add_by_code.ts'
import { qrSecretOf } from '../../src/handshake_crypto.ts'
import { inviteOfHash, redeemInvite, verifyInvite } from '../../src/invite_policy.ts'

const me = createIdentity('https://relay.example/relay')
const NOW = new Date('2026-11-16T10:00:00Z')
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpinv-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ina' }, people: [], inventory: [], log: [], peers: [], identity: serializeIdentity(me) }))
  const tools = Object.fromEntries(allTools({ file, write, now: () => NOW }).map((t) => [t.name, t]))
  return { tools, rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('invite link MCP tools', () => {
  it('listed in MCP_TOOLS (create/revoke write, status read)', () => {
    expect(MCP_TOOLS).toContainEqual({ name: 'invite_link_create', write: true })
    expect(MCP_TOOLS).toContainEqual({ name: 'invite_link_revoke', write: true })
    expect(MCP_TOOLS).toContainEqual({ name: 'invite_link_status', write: false })
    expect(Object.keys(fixture(false).tools)).toContain('invite_link_status')
    expect(Object.keys(fixture(false).tools)).not.toContain('invite_link_create')
  })

  it('create: a v2 connect link with a signed token the app verifies; open link 10 uses, 30 days; counter written', async () => {
    const f = fixture()
    const out = await f.tools.invite_link_create.run({ kind: 'open', tag: 'iyg', label: 'IYG' })
    expect(out).toMatchObject({ kind: 'open', tag: 'iyg', max: 10, expiresAt: NOW.getTime() + 30 * 86_400_000 })
    const u = new URL(out.link)
    const link = connectLinkOf(u.search)
    expect(link.did).toBe(me.did)
    expect(link.qk).toBe(qrSecretOf(me))
    const tok = inviteOfHash(u.hash)
    const v = verifyInvite(tok, me.did, NOW.getTime(), (b, s) => verifyDidSignature(me.did, b, s))
    expect(v).toMatchObject({ ok: true, inv: { k: 'o', n: 'Ina', l: 'IYG', t: 'iyg' } })
    const r = f.rec()
    expect(r.invites).toHaveLength(1)
    // the app's counter accepts it (same ledger shape)
    expect(redeemInvite(r.invites, tok, { myDid: me.did, fromDid: 'did:peer:x', now: NOW.getTime(), verify: (b, s) => verifyDidSignature(me.did, b, s) }).ok).toBe(true)
  })

  it('status never shows a DID or token; revoke stops them', async () => {
    const f = fixture()
    await f.tools.invite_link_create.run({ kind: 'personal', tag: 'iyg' })
    await f.tools.invite_link_create.run({ kind: 'open', tag: 'iyg', max_uses: 3 })
    const st = f.tools.invite_link_status.run({})
    expect(st.links.map((l) => [l.kind, l.max, l.state])).toEqual([['personal', 1, 'active'], ['open', 3, 'active']])
    expect(JSON.stringify(st)).not.toContain(me.did)
    expect(f.tools.invite_link_revoke.run({ tag: 'iyg' })).toEqual({ revoked: 2 })
    expect(f.tools.invite_link_status.run({ tag: 'iyg' }).links.every((l) => l.state === 'revoked')).toBe(true)
  })

  it('refuses a bad kind and a record without an identity', async () => {
    const f = fixture()
    await expect(async () => f.tools.invite_link_create.run({ kind: 'x', tag: 'iyg' })).rejects.toThrow(/kind/)
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpinv-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ina' }, people: [], inventory: [], log: [], peers: [] }))
    const t = Object.fromEntries(allTools({ file, write: true, now: () => NOW }).map((x) => [x.name, x]))
    await expect(async () => t.invite_link_create.run({ kind: 'open', tag: 'iyg' })).rejects.toThrow(/identity/)
  })
})
