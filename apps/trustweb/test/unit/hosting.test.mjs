/**
 * Recordings hosted on the Swiss server (wave 1733 round B, item 4): what
 * waits to be hosted, the rows the sheet lists, the server's list as the
 * truth, hours used of the allowance (never hard-coded), and hosting one
 * recording: sealed, at most an hour, never twice at once, the allowance as a
 * plain outcome, fetched back intact on a new phone.
 */
import { fetchBack, hostAll, hostingRows, HostOutcome, hostOne, hoursOf, reconcile, toHost, unhost } from '../../src/hosting.ts'
import { hostedAccount, newHostedSecret, SwissError, SwissServerError } from '../../src/swiss_server.ts'

const entry = (id, savedAt) => ({ id, savedAt, bytes: 100 })
const meeting = (id) => ({ id, about: id, kind: 'what', where: '', startedAt: 1, endedAt: 2, durationMs: 1000, meeting: false, lines: [], transcript: [] })
const takes = (ms) => [{ blob: new Blob([new Uint8Array([7, 8, 9])], { type: 'audio/webm' }), mimeType: 'audio/webm', offsetMs: 0, durationMs: ms }]

async function setup({ audio = { m1: takes(2000) }, put } = {}) {
  const account = await hostedAccount(newHostedSecret())
  const hosting = { secret: 'x', on: true, recs: [] }
  const server = new Map()
  const saved = new Map()
  const calls = { put: 0, saves: 0 }
  const deps = {
    account: async () => account,
    hosting: () => hosting,
    loadAudio: async (id) => (audio[id] ? { meetingId: id, savedAt: 1, bytes: 3, takes: audio[id] } : null),
    saveAudio: async (id, t) => { saved.set(id, t) },
    put: put ?? (async (a, rid, seconds, sealed) => { calls.put++; await new Promise((r) => setTimeout(r, 5)); server.set(rid, await sealed.arrayBuffer()); return seconds }),
    get: async (a, rid) => server.get(rid),
    remove: async (a, rid) => { server.delete(rid) },
    save: () => { calls.saves++ },
    now: () => 77,
  }
  return { deps, hosting, server, saved, calls }
}

describe('hosting: planning', () => {
  it('hours used of the allowance come from the server numbers', () => {
    expect(hoursOf({ secondsUsed: 11_700, secondsLimit: 36_000 })).toEqual({ used: 3.25, limit: 10 })
    expect(hoursOf({ secondsUsed: 0, secondsLimit: 72_000 })).toEqual({ used: 0, limit: 20 })
  })
  it('waits to be hosted: kept here, meeting still here, not hosted yet, newest first', () => {
    const h = { secret: 'x', on: true, recs: [{ meetingId: 'b', rid: 'r', seconds: 1, bytes: 1, at: 1 }] }
    expect(toHost(h, [entry('a', 1), entry('b', 2), entry('c', 3), entry('gone', 4)], [meeting('a'), meeting('b'), meeting('c')])).toEqual(['c', 'a'])
  })
  it('lists every recording: kept here, hosted, both, and a deleted meeting still on the server', () => {
    const h = { secret: 'x', on: true, recs: [{ meetingId: 'b', rid: 'r1', seconds: 1, bytes: 1, at: 1 }, { meetingId: 'gone', rid: 'r2', seconds: 1, bytes: 1, at: 1 }, { meetingId: 'c', rid: 'r3', seconds: 1, bytes: 1, at: 1 }] }
    const rows = hostingRows(h, [entry('a', 1), entry('b', 2)], [meeting('a'), meeting('b'), meeting('c')])
    expect(rows.map((r) => [r.meetingId, r.onPhone, Boolean(r.rec), r.meetingHere])).toEqual([
      ['a', true, false, true], ['b', true, true, true], ['c', false, true, true], ['gone', false, true, false],
    ])
  })
  it('the server list is the truth: what it no longer has is forgotten here', () => {
    const h = { secret: 'x', on: true, recs: [{ meetingId: 'a', rid: 'r1', seconds: 1, bytes: 1, at: 1 }, { meetingId: 'b', rid: 'r2', seconds: 1, bytes: 1, at: 1 }] }
    expect(reconcile(h, [{ id: 'r2', bytes: 1, seconds: 1, stored: '' }])).toBe(true)
    expect(h.recs.map((r) => r.rid)).toEqual(['r2'])
    expect(reconcile(h, [{ id: 'r2', bytes: 1, seconds: 1, stored: '' }])).toBe(false)
  })
})

describe('hosting: one recording', () => {
  it('seals and stores it, notes it, and fetches it back intact on another phone', async () => {
    const { deps, hosting, server, saved } = await setup()
    expect(await hostOne('m1', deps)).toBe(HostOutcome.Hosted)
    expect(hosting.recs).toEqual([{ meetingId: 'm1', rid: hosting.recs[0].rid, seconds: 2, bytes: hosting.recs[0].bytes, at: 77 }])
    expect(hosting.recs[0].rid).toMatch(/^[0-9a-f]{32}$/)
    const stored = new Uint8Array(server.get(hosting.recs[0].rid))
    expect(stored[0]).toBe(1)
    expect([...stored].join(',')).not.toContain('7,8,9')
    expect(await hostOne('m1', deps)).toBe(HostOutcome.Already)
    expect(await fetchBack('m1', deps)).toBe(true)
    expect([...new Uint8Array(await saved.get('m1')[0].blob.arrayBuffer())]).toEqual([7, 8, 9])
  })
  it('never uploads (and charges) the same meeting twice at once', async () => {
    const { deps, calls } = await setup()
    const [a, b] = await Promise.all([hostOne('m1', deps), hostOne('m1', deps)])
    expect([a, b].sort()).toEqual([HostOutcome.Already, HostOutcome.Hosted].sort())
    expect(calls.put).toBe(1)
  })
  it('over an hour: refused before anything is sent; no audio: said so', async () => {
    const { deps, calls } = await setup({ audio: { long: takes(3_600_001) } })
    expect(await hostOne('long', deps)).toBe(HostOutcome.TooLong)
    expect(await hostOne('none', deps)).toBe(HostOutcome.NoAudio)
    expect(calls.put).toBe(0)
  })
  it('the allowance is a plain outcome; hosting several stops there, nothing on the phone touched', async () => {
    let n = 0
    const put = async () => { if (++n > 1) throw new SwissServerError(SwissError.AllowanceReached, 402); return 1 }
    const { deps, hosting } = await setup({ audio: { a: takes(1000), b: takes(1000), c: takes(1000) }, put })
    const r = await hostAll(['a', 'b', 'c'], deps)
    expect(r).toEqual({ hosted: 1, stoppedBy: HostOutcome.Allowance })
    expect(hosting.recs.map((x) => x.meetingId)).toEqual(['a'])
    expect(n).toBe(2)
  })
  it('removing from the server keeps it on the phone; a failure keeps the entry', async () => {
    const { deps, hosting, server } = await setup()
    await hostOne('m1', deps)
    expect(await unhost('m1', deps)).toBe(true)
    expect(hosting.recs).toEqual([])
    expect(server.size).toBe(0)
    await hostOne('m1', deps)
    deps.remove = async () => { throw new Error('offline') }
    expect(await unhost('m1', deps)).toBe(false)
    expect(hosting.recs.length).toBe(1)
  })
})
