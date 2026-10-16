// @ts-nocheck  (fs/os/path: the crm tsconfig carries no node types; vitest runs this in node)
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowed, changes, homeNotes, push, safePath, serve } from '../../scripts/notes_bridge.mjs'

const NOW = Date.UTC(2026, 9, 16, 9, 30)
const line = (id, text, extra = {}) => ({ id, text, tag: 'note', audience: 'me', status: 'current', notedAt: Date.UTC(2026, 6, 11, 12), checkedAt: 1, ...extra })
const people = () => [
  { id: 'tana-abc', name: 'Mira Hollenstein', context: '', ring: 'friend', metAt: 1, lines: [line('tana-abc-0', 'Plays chess')], fields: {} },
  { id: 'local-1', name: 'Lena Berger', context: '', ring: 'unsorted', metAt: 1, lines: [line('local-1-x-0', 'Lives in Leoben', { source: { kind: 'local', path: 'pages/Lena Berger.md' } })] },
  { id: 'tana-zzz', name: 'Nobody Mentioned', context: '', ring: 'close', metAt: 1, lines: [], fields: {} },
]
function vault() {
  const v = mkdtempSync(path.join(tmpdir(), 'vault-'))
  mkdirSync(path.join(v, 'journals')); mkdirSync(path.join(v, 'pages')); mkdirSync(path.join(v, 'assets', 'local-notes'), { recursive: true }); mkdirSync(path.join(v, 'node_modules', 'x'), { recursive: true })
  writeFileSync(path.join(v, 'journals', '2026_07_11.md'), '- Met [[Mira Hollenstein]] at the bonfire.\n')
  writeFileSync(path.join(v, 'journals', '2026_07_12.md'), '- Mira again.\n')
  writeFileSync(path.join(v, 'pages', 'Lena Berger.md'), '# Lena\n')
  writeFileSync(path.join(v, 'node_modules', 'x', 'a.md'), '<!-- trustweb:begin tana-abc -->\n- TrustWeb: x · ring: close · updated: 2020-01-01T00:00:00.000Z\n<!-- trustweb:end tana-abc -->\n')
  writeFileSync(path.join(v, 'assets', 'local-notes', 'people-haiku.jsonl'), [
    JSON.stringify({ path: 'journals/2026_07_12.md', date: '2026-07-12', people: [{ name: 'Mira', aliases: [], context: '', facts: [], met: '', confidence: 0.9 }] }),
    JSON.stringify({ path: 'journals/2026_07_11.md', date: '2026-07-11', people: [{ name: 'Mira Hollenstein', aliases: ['Mira'], context: '', facts: ['Plays chess'], met: '', confidence: 0.95 }] }),
  ].join('\n') + '\n')
  return v
}

describe('notes bridge: writes', () => {
  it('home note = the earliest note the reader found the person in, else the note a local line points at; nothing for the rest', () => {
    const v = vault()
    const home = homeNotes(people(), [{ path: 'journals/2026_07_12.md', date: '2026-07-12', people: [{ name: 'Mira', aliases: [] }] }, { path: 'journals/2026_07_11.md', date: '2026-07-11', people: [{ name: 'Mira Hollenstein', aliases: ['Mira'] }] }])
    expect([...home]).toEqual([['tana-abc', 'journals/2026_07_11.md'], ['local-1', 'pages/Lena Berger.md']])
    expect(v).toBeTruthy()
  })
  it('push writes a block into each home note, is unchanged the second time, counts the people without a home; --everyone adds pages', () => {
    const v = vault()
    expect(push(v, people(), { now: NOW })).toEqual({ written: 2, unchanged: 0, noHome: 1, pages: 0, errors: [] })
    const j = readFileSync(path.join(v, 'journals', '2026_07_11.md'), 'utf8')
    expect(j).toBe('- Met [[Mira Hollenstein]] at the bonfire.\n\n<!-- trustweb:begin tana-abc -->\n- TrustWeb: Mira Hollenstein · ring: friend · https://app.tana.inc?nodeid=abc · updated: 2026-10-16T09:30:00.000Z\n- 2026-07-11 Plays chess <!-- tw:tana-abc-0 -->\n<!-- trustweb:end tana-abc -->\n')
    expect(readFileSync(path.join(v, 'journals', '2026_07_12.md'), 'utf8')).toBe('- Mira again.\n')
    expect(push(v, people(), { now: NOW + 9000 })).toEqual({ written: 0, unchanged: 2, noHome: 1, pages: 0, errors: [] })
    const r = push(v, people(), { now: NOW, everyone: true })
    expect(r.pages).toBe(3)
    expect(existsSync(path.join(v, 'TrustWeb', 'People', '.trustweb-generated'))).toBe(true)
    expect(push(v, people(), { now: NOW + 1, everyone: true }).pages).toBe(0)
  })
  it('never writes outside the vault or into non-markdown', () => {
    expect(safePath('/v', '../etc/passwd.md')).toBeNull()
    expect(safePath('/v', 'a/../../x.md')).toBeNull()
    expect(safePath('/v', 'notes/a.txt')).toBeNull()
    expect(safePath('/v', 42)).toBeNull()
    expect(safePath('/v', 'journals/a.md')).toBe(path.resolve('/v/journals/a.md'))
  })
})

describe('notes bridge: reads back', () => {
  it('changes: a ring edited after the block was written and bullets added inside it; code folders are never read', () => {
    const v = vault()
    push(v, people(), { now: NOW })
    const f = path.join(v, 'journals', '2026_07_11.md')
    writeFileSync(f, readFileSync(f, 'utf8').replace('ring: friend', 'ring: close').replace('<!-- trustweb:end tana-abc -->', '- 2026-10-02 Lent me the printer\n<!-- trustweb:end tana-abc -->'))
    utimesSync(f, new Date(NOW + 60_000), new Date(NOW + 60_000))
    expect(changes(v, people())).toEqual([{ id: 'tana-abc', path: 'journals/2026_07_11.md', ring: 'close', newLines: [{ text: 'Lent me the printer', date: '2026-10-02' }] }])
    utimesSync(f, new Date(NOW), new Date(NOW))
    expect(changes(v, people())[0].ring).toBeNull()
  })
})

describe('notes bridge: who may talk to it', () => {
  const cfg = { vault: '/v', port: 8263, token: 'secret-token-xyz' }
  it('loopback host, local origin, exact token; OPTIONS needs no token', () => {
    expect(allowed({ headers: { host: '127.0.0.1:8263', authorization: 'Bearer secret-token-xyz' } }, cfg)).toBeNull()
    expect(allowed({ headers: { host: 'localhost:8263', origin: 'http://127.0.0.1:5220', authorization: 'Bearer secret-token-xyz' } }, cfg)).toBeNull()
    expect(allowed({ headers: { host: 'evil.example.com', authorization: 'Bearer secret-token-xyz' } }, cfg)).toBe('host')
    expect(allowed({ headers: { host: '127.0.0.1:8263', origin: 'https://evil.example.com', authorization: 'Bearer secret-token-xyz' } }, cfg)).toBe('origin')
    expect(allowed({ headers: { host: '127.0.0.1:8263', authorization: 'Bearer wrong' } }, cfg)).toBe('token')
    expect(allowed({ headers: { host: '127.0.0.1:8263' } }, cfg)).toBe('token')
    expect(allowed({ headers: { host: '127.0.0.1:8263' }, method: 'OPTIONS' }, cfg)).toBeNull()
  })
  it('over HTTP: status, push, changes; a wrong token is 401', async () => {
    const v = vault()
    const c = { vault: v, port: 0, token: 't0k3n' }
    const server = await new Promise((resolve) => serve(c, resolve))
    const port = server.address().port
    const call = (p, body, token = 't0k3n') => fetch(`http://127.0.0.1:${port}${p}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5220' }, body: body ? JSON.stringify(body) : undefined })
    expect((await call('/status')).status).toBe(200)
    expect((await call('/status', null, 'nope')).status).toBe(401)
    const r = await (await call('/push', { people: people() })).json()
    expect(r.written).toBe(2)
    const pre = await call('/push', null); expect(pre.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5220')
    expect((await (await call('/changes', { people: people() })).json()).changes).toEqual([])
    expect((await call('/push', { people: 'x' })).status).toBe(400)
    server.close()
  })
})
