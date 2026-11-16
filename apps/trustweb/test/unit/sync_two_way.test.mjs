// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 sync-visibility: the two-way check, step by step, on invented data only. Obsidian vault -> TrustWeb (read, re-sync) and Tana both ways
 * (TrustWeb -> Tana push through the local API, Tana -> TrustWeb pull) run end to end here against a temp vault in /tmp and a mocked fetch.
 * TrustWeb -> vault (writing back into notes) does not exist in the web build; it is a todo below, not a stub.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acceptPath } from '../../src/ext/obsidian/obsidian_files.ts'
import { memoryCache, syncVault } from '../../src/ext/obsidian/obsidian_scan.ts'
import { buildContacts } from '../../src/ext/obsidian/obsidian_people.ts'
import { NOTES } from '../fixtures/synthetic_vault.mjs'
import { connect, planFieldSync } from '../../../crm/src/tana_sync.ts'
import { connect as pullConnect, pull } from '../../../crm/scripts/tana_pull_persons.mjs'

const tmp = mkdtempSync(path.join(tmpdir(), 'tw-twoway-'))

function writeVault(dir, notes) {
  for (const [rel, text] of Object.entries(notes)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text) }
}
const readVault = (dir, rels) => rels.filter(acceptPath).map((path_) => {
  const text = readFileSync(path.join(dir, path_), 'utf8')
  return { path: path_, file: { name: path.basename(path_), size: text.length, text: async () => text } }
})
const people = (notes) => buildContacts(notes).contacts.map((c) => c.name).sort()

describe('Obsidian: vault -> TrustWeb, pull and re-sync (temp vault in /tmp)', () => {
  it('first sync reads every note; a re-sync after edits sees exactly the add, the change and the removal', async () => {
    const dir = path.join(tmp, 'vault'); writeVault(dir, NOTES)
    const cache = memoryCache()
    const first = await syncVault(readVault(dir, Object.keys(NOTES)), cache)
    expect(first.diff.added).toBe(first.notes.length)
    expect(people(first.notes)).toEqual(expect.arrayContaining(['Alma Brandt', 'Bruno Cesar']))
    // the vault changes on disk: one new person note, one edited, one removed
    writeFileSync(path.join(dir, 'People/Nora Lind.md'), '---\nname: Nora Lind\ntags: [person]\n---\nNew neighbour.\n')
    writeFileSync(path.join(dir, 'People/Alma Brandt.md'), '---\nname: Alma Brandt\nemail: alma.new@example.org\ntags: [person]\n---\nMoved.\n')
    rmSync(path.join(dir, 'People/Bruno Cesar.md'))
    const rels = [...Object.keys(NOTES).filter((p) => p !== 'People/Bruno Cesar.md'), 'People/Nora Lind.md']
    const second = await syncVault(readVault(dir, rels), cache)
    expect(second.diff).toMatchObject({ added: 1, changed: 1, removed: 1 })
    expect(people(second.notes)).toContain('Nora Lind')
    expect(people(second.notes)).not.toContain('Bruno Cesar')
  })
  it.todo('TrustWeb -> vault (push): writing person notes back needs the Tauri shell, SPEC-tauri-shell-two-way-sync.txt step "reverse direction writer" (pc24 job 38); the web build opens a vault read-only (showDirectoryPicker mode read)')
})

const reply = (id, result, headers = {}) => ({ ok: true, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify({ jsonrpc: '2.0', id, result }) })

describe('Tana: TrustWeb -> Tana push through the local API (mocked fetch, loopback URL)', () => {
  it('a field edit and a ring change become set_field_content / set_field_option calls with the bearer token', async () => {
    const calls = []
    const fetcher = async (url, init) => { const b = JSON.parse(init.body); calls.push({ url, auth: init.headers.Authorization, body: b }); return reply(b.id, b.method === 'tools/call' ? { content: [{ text: 'ok' }] } : {}, { 'mcp-session-id': 's1' }) }
    const call = await connect('token-x', fetcher)
    for (const [key, value] of [['xu0y_4Pu3sOL', 'Graz'], ['tw-ring', 'close']]) {
      const op = planFieldSync(key, value)
      await call(op.tool, op.args)
    }
    expect(calls.every((c) => c.url === 'http://127.0.0.1:8262/mcp' && c.auth === 'Bearer token-x')).toBe(true)
    const tools = calls.filter((c) => c.body.method === 'tools/call').map((c) => [c.body.params.name, c.body.params.arguments.attributeId])
    expect(tools).toEqual([['set_field_content', 'xu0y_4Pu3sOL'], ['set_field_option', 'rVfw62lb7BYD']])
    expect(calls[2].body.params.name).toBe('set_field_content')
  })
})

describe('Tana: Tana -> TrustWeb pull (persons index + nodes in /tmp, mocked fetch)', () => {
  it('reads each indexed node through read_node and rewrites the nodes file with a backup', async () => {
    const indexPath = path.join(tmp, 'persons-index.json'); const nodesPath = path.join(tmp, 'persons-nodes.json')
    writeFileSync(indexPath, JSON.stringify([{ id: 'n1', created: '2025-01-01' }, { id: 'n2', created: '2025-02-01' }]))
    writeFileSync(nodesPath, JSON.stringify({ n1: 'old' }))
    const fetcher = async (_url, init) => { const b = JSON.parse(init.body); return reply(b.id, b.method === 'tools/call' ? { content: [{ text: `- fresh ${b.params.arguments.nodeId}` }] } : {}, { 'mcp-session-id': 's2' }) }
    const { call } = await pullConnect('token-y', fetcher)
    const r = await pull({ indexPath, nodesPath, call, pause: 0 })
    expect(r.failed).toEqual([])
    expect(JSON.parse(readFileSync(nodesPath, 'utf8'))).toEqual({ n1: '- fresh n1', n2: '- fresh n2' })
  })
})
