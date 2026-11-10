// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Shared personal-preview record: the "newer wins" rule (src/dev_record_live.ts) and the dev endpoint (vite_dev_record.mjs). */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { liveIsNewer, seedLiveDevRecord } from '../../src/dev_record_live.ts'
import { liveRecordReply } from '../../vite_dev_record.mjs'

const REC = JSON.stringify({ v: 1, me: { id: 'x', displayName: 'J' }, people: [{ id: 'a', name: 'Ann' }], peers: [], inventory: [], log: [] })
const ok = { host: '127.0.0.1:5266' }

describe('liveIsNewer', () => {
  it('takes the live file when this origin never synced or the file is newer', () => {
    expect(liveIsNewer(2000, null)).toBe(true)
    expect(liveIsNewer(2000, 1000)).toBe(true)
  })
  it('keeps this origin when it is as new or newer, or the file has no time', () => {
    expect(liveIsNewer(1000, 1000)).toBe(false)
    expect(liveIsNewer(500, 1000)).toBe(false)
    expect(liveIsNewer(0, null)).toBe(false)
  })
})

describe('seedLiveDevRecord', () => {
  const store = () => { const m = new Map(); return { m, api: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } } }
  const reply = (text, at) => async () => ({ ok: true, status: 200, text: async () => text, headers: { get: () => String(at) } })
  afterEach(() => vi.unstubAllGlobals())
  it('replaces an older stored record, keeps it as .before-live, and reports a change once', async () => {
    const s = store(); vi.stubGlobal('localStorage', s.api); vi.stubGlobal('__TW_DEV_LIVE__', true)
    s.m.set('trustweb.v1.me', 'mine')
    expect(await seedLiveDevRecord('me', { fetch: reply(REC, 2000) })).toBe(true)
    expect(s.m.get('trustweb.v1.me')).toBe(REC)
    expect(s.m.get('trustweb.v1.me.before-live')).toBe('mine')
    expect(await seedLiveDevRecord('me', { fetch: reply(REC, 2000) })).toBe(false)
  })
  it('does nothing without the dev define, on 404, on a bad record, or when this origin is newer', async () => {
    const s = store(); vi.stubGlobal('localStorage', s.api)
    expect(await seedLiveDevRecord('me', { fetch: reply(REC, 2000) })).toBe(false)
    vi.stubGlobal('__TW_DEV_LIVE__', true)
    expect(await seedLiveDevRecord('me', { fetch: async () => ({ ok: false, status: 404 }) })).toBe(false)
    expect(await seedLiveDevRecord('me', { fetch: reply('{"v":2}', 2000) })).toBe(false)
    s.m.set('trustweb.v1.me.live-at', '3000')
    expect(await seedLiveDevRecord('me', { fetch: reply(REC, 2000) })).toBe(false)
    expect(s.m.get('trustweb.v1.me')).toBeUndefined()
  })
})

describe('liveRecordReply', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'twlive-'))
  const file = path.join(dir, 'dev-record.live.json')
  it('answers 404 while nothing was stored, then stores atomically and serves it with its time', () => {
    expect(liveRecordReply(file, 'GET', ok, '').code).toBe(404)
    const w = liveRecordReply(file, 'POST', ok, REC)
    expect(w.code).toBe(200)
    expect(readFileSync(file, 'utf8')).toBe(REC)
    const r = liveRecordReply(file, 'GET', ok, '')
    expect(r.body).toBe(REC)
    expect(Number(r.headers['X-TW-Live-At'])).toBe(Number(w.headers['X-TW-Live-At']))
    expect(Number(r.headers['X-TW-Live-At'])).toBeGreaterThan(0)
  })
  it('keeps the last 10 versions beside it, moves older ones to the archive folder (nothing is deleted), leaves other files alone', () => {
    writeFileSync(path.join(dir, 'dev-record.path'), 'keep')
    for (let i = 0; i < 14; i++) liveRecordReply(file, 'POST', ok, REC.replace('Ann', 'Ann' + i), { gapMs: 0 })
    const snaps = (d) => readdirSync(d).filter((n) => /^dev-record\.live\.\d+\.json$/.test(n))
    expect(snaps(dir).length).toBe(10)
    expect(snaps(path.join(dir, 'dev-record.live.archive')).length).toBeGreaterThanOrEqual(3)
    expect(readdirSync(dir)).toContain('dev-record.path')
  })
  it('snapshots at most once per gap, so an editing session does not fill the disk', () => {
    const d2 = mkdtempSync(path.join(tmpdir(), 'twlive-')); const f2 = path.join(d2, 'dev-record.live.json')
    for (let i = 0; i < 5; i++) liveRecordReply(f2, 'POST', ok, REC)
    expect(readdirSync(d2).filter((n) => /^dev-record\.live\.\d+\.json$/.test(n)).length).toBe(1)
  })
  it('rejects a foreign Host, any Origin, a bad method and an unreadable body', () => {
    expect(liveRecordReply(file, 'GET', { host: 'evil.example.com' }, '').code).toBe(403)
    expect(liveRecordReply(file, 'POST', { ...ok, origin: 'http://evil.example.com' }, REC).code).toBe(403)
    expect(liveRecordReply(file, 'POST', { ...ok, origin: 'http://127.0.0.1:5266' }, REC).code).toBe(200)
    expect(liveRecordReply(file, 'PUT', ok, REC).code).toBe(405)
    expect(liveRecordReply(file, 'POST', ok, '{"v":2}').code).toBe(400)
    expect(liveRecordReply(file, 'POST', ok, '{"v":1,"me":{},"people":"x"}').code).toBe(400)
  })
})

describe('liveRecordReply review hardening', () => {
  const fresh = () => { const d = mkdtempSync(path.join(tmpdir(), 'twlive-')); return path.join(d, 'dev-record.live.json') }
  it('an unparsable Origin ("null" from a sandboxed frame) is a 403, never a thrown error', () => {
    const f = fresh()
    expect(() => liveRecordReply(f, 'GET', { ...ok, origin: 'null' }, '')).not.toThrow()
    expect(liveRecordReply(f, 'GET', { ...ok, origin: 'null' }, '').code).toBe(403)
  })
  it('a client that is not on this machine is a 403 even with a loopback Host (tw_dev.sh --lan)', () => {
    const f = fresh()
    liveRecordReply(f, 'POST', ok, REC)
    expect(liveRecordReply(f, 'GET', ok, '', { remote: '192.168.1.20' }).code).toBe(403)
    expect(liveRecordReply(f, 'GET', ok, '', { remote: '::ffff:127.0.0.1' }).code).toBe(200)
    expect(liveRecordReply(f, 'GET', ok, '', { remote: '::1' }).code).toBe(200)
  })
  it('a stale tab (its base older than the file) gets 409 and never overwrites the newer record', () => {
    const f = fresh()
    const first = liveRecordReply(f, 'POST', ok, REC)
    const at = Number(first.headers['X-TW-Live-At'])
    const stale = liveRecordReply(f, 'POST', { ...ok, 'x-tw-live-base': String(at - 5000) }, REC.replace('Ann', 'Old'))
    expect(stale.code).toBe(409)
    expect(readFileSync(f, 'utf8')).toBe(REC)
    expect(liveRecordReply(f, 'POST', { ...ok, 'x-tw-live-base': String(at) }, REC.replace('Ann', 'New'), { gapMs: 0 }).code).toBe(200)
    expect(readFileSync(f, 'utf8')).toContain('New')
  })
})

describe('edit stream: state taken from a linked device (wave 40)', () => {
  const dir = () => mkdtempSync(path.join(tmpdir(), 'tw-adopt-'))
  const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  it('X-TW-Adopted turns the swap into one adopted-from-device line instead of one per person', () => {
    const d = dir(); const f = path.join(d, 'rec.json')
    const rec = (people) => JSON.stringify({ v: 1, me: { id: 'x', displayName: 'J' }, people, peers: [], inventory: [], log: [] })
    writeFileSync(f, rec([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }]))
    const adopted = encodeURIComponent(JSON.stringify({ device: 'Phone', people: 3, notes: 1, settings: 0 }))
    const r = liveRecordReply(f, 'POST', { ...ok, 'x-tw-adopted': adopted }, rec([{ id: 'c', name: 'Cy' }]), { gapMs: 0 })
    expect(r.code).toBe(200)
    expect(lines(path.join(d, 'dev-edits.jsonl'))).toMatchObject([{ kind: 'adopted-from-device', ids: [], after: { device: 'Phone', people: 3, notes: 1, settings: 0 } }])
  })
  it('a damaged X-TW-Adopted header falls back to the ordinary per-person lines', () => {
    const d = dir(); const f = path.join(d, 'rec.json')
    const rec = (people) => JSON.stringify({ v: 1, me: { id: 'x', displayName: 'J' }, people, peers: [], inventory: [], log: [] })
    writeFileSync(f, rec([{ id: 'a', name: 'Ann' }]))
    liveRecordReply(f, 'POST', { ...ok, 'x-tw-adopted': '%7Boops' }, rec([{ id: 'a', name: 'Ann B' }]), { gapMs: 0 })
    expect(lines(path.join(d, 'dev-edits.jsonl')).map((e) => e.kind)).toEqual(['rename'])
  })
})
