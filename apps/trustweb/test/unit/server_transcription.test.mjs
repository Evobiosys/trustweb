/**
 * Server-side transcription and the meeting link that fills in later (wave 1733
 * round B, items 3 and 5): the Swiss-server client's parsing and error mapping,
 * the hosted account derivation, the job runner's money rules (saved as running
 * before every call, no automatic retry after a timeout, 429 busy waited out,
 * done takes never sent again, an existing transcript never replaced), and the
 * early-pack outbox (A3) with its receiver-side update.
 */
import { ServerJobState } from '../../src/model.ts'
import {
  errorFor, fetchStatus, hostedAccount, isHostedSecret, newHostedSecret, newRecordingId, parseStatus, parseTranscript, parseUsage,
  putRecording, SwissError, SwissServerError, transcribe,
} from '../../src/swiss_server.ts'
import { canStartJob, linesFromResult, runServerJob, settleInterruptedJobs } from '../../src/server_transcription.ts'
import { addToOutbox, applyLatePack, flushOutbox, fullPackFor, lateStillWanted, LATE_KEEP_MS, OUTBOX_MAX, pollDelay, POLL_MAX_MS, SEND_BACKOFF_MS } from '../../src/late_pack.ts'
import { openRecording, sealRecording } from '../../src/hosted_recording.ts'
import { isMeetingPack } from '../../src/share.ts'
import { backupNow, newRandomKey } from '../../src/backup.ts'

const meeting = (extra = {}) => ({
  id: 'm1', about: 'Anna', kind: 'who', where: 'Impact Hub', startedAt: 1000, endedAt: 2000, durationMs: 5000, meeting: true,
  lines: [{ text: 'a note', tag: 'note' }], transcript: [], ...extra,
})
const take = (offsetMs, durationMs, mimeType = 'audio/webm') => ({ blob: new Blob([new Uint8Array(100)], { type: mimeType }), mimeType, offsetMs, durationMs })
const ACCOUNT = { account: 'a'.repeat(64), token: 'b'.repeat(64), encKey: null }
const result = (segments, text = segments.map((s) => s.text).join(' ')) => ({ text, segments, language: 'en', secondsCharged: 1 })

function deps(script, saves = []) {
  const calls = []
  return {
    calls, saves,
    d: {
      account: async () => ACCOUNT,
      transcribe: async (a, audio, seconds, mime, signal) => {
        calls.push({ seconds, mime, signalOk: signal instanceof AbortSignal })
        const next = script.shift()
        if (next instanceof Error) throw next
        return next
      },
      save: () => saves.push('save'),
      sleep: async () => {},
      now: () => 42,
    },
  }
}

describe('swiss_server parsing', () => {
  it('reads the status, hosting off reads all off', () => {
    expect(parseStatus({ hosted: false, transcribe: true, feedback: true, plan: null })).toEqual({ hosted: false, transcribe: false, feedback: true, plan: null })
    const on = parseStatus({ hosted: true, transcribe: false, feedback: false, plan: { secondsLimit: 36000, bytesLimit: 200000000 } })
    expect(on.hosted).toBe(true)
    expect(on.plan.secondsLimit).toBe(36000)
    expect(on.plan.transcription.secondsLimit).toBe(36000)
    expect(parseStatus('nope')).toBe(null)
  })
  it('reads usage defensively', () => {
    expect(parseUsage({ secondsLimit: 36000 })).toBe(null)
    const u = parseUsage({ plan: 'free', used: 3.25, limit: 10, secondsUsed: 11700, secondsLimit: 36000, bytesUsed: 1, bytesLimit: 2, transcription: { secondsUsed: 60, secondsLimit: 36000 } })
    expect(u.secondsUsed).toBe(11700)
    expect(u.transcription.secondsUsed).toBe(60)
  })
  it('keeps only well-formed segments, in order, trimmed', () => {
    const t = parseTranscript({ text: ' Hi. ', segments: [{ start: 4.2, end: 9, text: ' Two.' }, { start: 0, end: 4.2, text: 'One.' }, { start: 'x', end: 1, text: 'bad' }, { start: 1, end: 2, text: '   ' }] })
    expect(t.text).toBe('Hi.')
    expect(t.segments).toEqual([{ start: 0, end: 4.2, text: 'One.' }, { start: 4.2, end: 9, text: 'Two.' }])
    expect(parseTranscript({ segments: [] })).toBe(null)
  })
  it('maps error codes, and statuses where the code is unknown', () => {
    expect(errorFor(503, { error: 'not_configured' }, null).code).toBe(SwissError.NotConfigured)
    expect(errorFor(402, { error: 'allowance_reached' }, null).code).toBe(SwissError.AllowanceReached)
    expect(errorFor(429, { error: 'busy' }, 10).code).toBe(SwissError.Busy)
    expect(errorFor(429, { error: 'busy_today' }, 10).code).toBe(SwissError.BusyToday)
    expect(errorFor(429, { error: 'ip_daily_limit' }, 10).code).toBe(SwissError.BusyToday)
    expect(errorFor(504, { error: 'provider_timeout' }, null).code).toBe(SwissError.Timeout)
    expect(errorFor(408, null, null).code).toBe(SwissError.Timeout)
    expect(errorFor(507, null, null).code).toBe(SwissError.StorageFull)
    expect(errorFor(500, null, null).code).toBe(SwissError.Server)
  })
  it('a server that cannot be reached is null; one without hosting reads all off', async () => {
    expect(await fetchStatus(async () => { throw new TypeError('offline') })).toBe(null)
    expect(await fetchStatus(async () => new Response('x', { status: 503 }))).toEqual({ hosted: false, transcribe: false, feedback: false, plan: null })
  })
  it('sends the declared seconds and the bare content type; never an X-Read-Token', async () => {
    let seen = null
    const f = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ text: 'ok', segments: [] }), { status: 200 }) }
    await transcribe(ACCOUNT, new Blob(['x']), 61, 'audio/webm;codecs=opus', new AbortController().signal, f)
    expect(seen.url).toBe('/transcribe')
    expect(seen.init.headers['X-Audio-Seconds']).toBe('61')
    expect(seen.init.headers['Content-Type']).toBe('audio/webm')
    expect(seen.init.headers['X-Account']).toBe(ACCOUNT.account)
    await putRecording(ACCOUNT, newRecordingId(), 10, new Blob(['x']), async (url, init) => { seen = { url, init }; return new Response(null, { status: 204, headers: { 'X-Seconds-Used': '10' } }) })
    expect(Object.keys(seen.init.headers)).not.toContain('X-Read-Token')
    expect(seen.init.headers['X-Seconds']).toBe('10')
  })
  it('a 429 carries Retry-After into the error', async () => {
    const f = async () => new Response(JSON.stringify({ error: 'busy', retryAfter: 7 }), { status: 429, headers: { 'Retry-After': '9' } })
    const e = await transcribe(ACCOUNT, new Blob(['x']), 1, 'audio/webm', new AbortController().signal, f).catch((x) => x)
    expect(e).toBeInstanceOf(SwissServerError)
    expect(e.code).toBe(SwissError.Busy)
    expect(e.retryAfterS).toBe(9)
  })
  it('an aborted call (our 15 minutes) is a timeout, a refused connection is network', async () => {
    const abort = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    expect((await transcribe(ACCOUNT, new Blob(['x']), 1, 'a', new AbortController().signal, abort).catch((x) => x)).code).toBe(SwissError.Timeout)
    expect((await transcribe(ACCOUNT, new Blob(['x']), 1, 'a', new AbortController().signal, async () => { throw new TypeError('x') }).catch((x) => x)).code).toBe(SwissError.Network)
  })
})

describe('hosted account', () => {
  it('derives the same account and token from the same secret, different from another secret', async () => {
    const s = newHostedSecret()
    expect(isHostedSecret(s)).toBe(true)
    const a = await hostedAccount(s)
    const b = await hostedAccount(s)
    const c = await hostedAccount(newHostedSecret())
    expect(a.account).toMatch(/^[0-9a-f]{64}$/)
    expect(a.token).toMatch(/^[0-9a-f]{64}$/)
    expect(a.account).toBe(b.account)
    expect(a.token).toBe(b.token)
    expect(a.account).not.toBe(a.token)
    expect(c.account).not.toBe(a.account)
  })
  it('refuses anything that is not a secret', async () => {
    await expect(hostedAccount('xyz')).rejects.toThrow()
    expect(isHostedSecret('A'.repeat(64))).toBe(false)
  })
  it('seals a recording so only the same account and id open it', async () => {
    const a = await hostedAccount(newHostedSecret())
    const other = await hostedAccount(newHostedSecret())
    const rid = newRecordingId()
    const takes = [
      { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), mimeType: 'audio/webm', offsetMs: 0, durationMs: 1000 },
      { blob: new Blob([new Uint8Array([4, 5])], { type: 'audio/webm' }), mimeType: 'audio/webm', offsetMs: 1000, durationMs: 500 },
    ]
    const sealed = await sealRecording(a.encKey, rid, takes)
    const bytes = new Uint8Array(await sealed.arrayBuffer())
    expect(bytes[0]).toBe(1)
    const back = await openRecording(a.encKey, rid, await sealed.arrayBuffer())
    expect(back.map((t) => [t.offsetMs, t.durationMs, t.mimeType])).toEqual([[0, 1000, 'audio/webm'], [1000, 500, 'audio/webm']])
    expect([...new Uint8Array(await back[1].blob.arrayBuffer())]).toEqual([4, 5])
    await expect(openRecording(other.encKey, rid, await sealed.arrayBuffer())).rejects.toThrow()
    await expect(openRecording(a.encKey, newRecordingId(), await sealed.arrayBuffer())).rejects.toThrow()
    await expect(openRecording(a.encKey, rid, new ArrayBuffer(10))).rejects.toThrow()
  })
})

describe('the server job', () => {
  it('lines from the segments, on the recording timeline, speaker 1; a bare text is one line', () => {
    expect(linesFromResult(60_000, result([{ start: 0, end: 4.2, text: 'One.' }, { start: 4.2, end: 9, text: 'Two.' }])))
      .toEqual([{ speaker: 1, atMs: 60_000, text: 'One.' }, { speaker: 1, atMs: 64_200, text: 'Two.' }])
    expect(linesFromResult(500, result([], 'Only text'))).toEqual([{ speaker: 1, atMs: 500, text: 'Only text' }])
    expect(linesFromResult(0, result([], ''))).toEqual([])
  })
  it('transcribes every take in order and is saved as running before each call', async () => {
    const m = meeting()
    const states = []
    const { d, calls } = deps([result([{ start: 0, end: 1, text: 'First.' }]), result([{ start: 0.5, end: 1, text: 'Second.' }])])
    d.save = () => states.push(m.serverJob?.state + ':' + m.serverJob?.takesDone)
    const state = await runServerJob(m, async () => [take(0, 2000), take(2000, 61_500)], d)
    expect(state).toBe(ServerJobState.Done)
    expect(m.transcript).toEqual([{ speaker: 1, atMs: 0, text: 'First.' }, { speaker: 1, atMs: 2500, text: 'Second.' }])
    expect(calls.map((c) => c.seconds)).toEqual([2, 62])
    expect(calls.every((c) => c.signalOk)).toBe(true)
    expect(states).toEqual(['running:0', 'running:0', 'running:1', 'done:2'])
  })
  it('marks the meeting running BEFORE it awaits anything (a pack sent right after says "still arriving")', () => {
    const m = meeting({ id: 'never-loads' })
    const { d } = deps([result([])])
    void runServerJob(m, () => new Promise(() => {}), d)
    expect(m.serverJob.state).toBe(ServerJobState.Running)
    expect(canStartJob(m)).toBe(false)
  })
  it('a timeout or a dropped connection is never retried: may still be charged', async () => {
    for (const code of [SwissError.Timeout, SwissError.Network]) {
      const m = meeting()
      const { d, calls } = deps([new SwissServerError(code, 0), result([])])
      expect(await runServerJob(m, async () => [take(0, 1000)], d)).toBe(ServerJobState.MaybeCharged)
      expect(calls.length).toBe(1)
      expect(m.serverJob.error).toBe(code)
    }
  })
  it('a job answered 200 whose body never arrived whole, or a 500: may still be charged, never "failed" (review-app-b)', async () => {
    const torn = async () => new Response('{"text":"hal', { status: 200 })
    expect((await transcribe(ACCOUNT, new Blob(['x']), 1, 'audio/webm', new AbortController().signal, torn).catch((x) => x)).code).toBe(SwissError.Timeout)
    const fiveHundred = async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 })
    const e500 = await transcribe(ACCOUNT, new Blob(['x']), 1, 'audio/webm', new AbortController().signal, fiveHundred).catch((x) => x)
    const m = meeting({ id: 'm500' })
    const { d, calls } = deps([e500])
    expect(await runServerJob(m, async () => [take(0, 1000)], d)).toBe(ServerJobState.MaybeCharged)
    expect(calls.length).toBe(1)
    // a refusal the provider gave (502) or "not switched on" (503) stays failed: nothing was charged
    const m2 = meeting({ id: 'm502' })
    expect(await runServerJob(m2, async () => [take(0, 1000)], deps([new SwissServerError(SwissError.Provider, 502)]).d)).toBe(ServerJobState.Failed)
  })
  it('429 busy is waited out (Retry-After), a few times, then stops as failed', async () => {
    const m = meeting()
    const waits = []
    const { d, calls } = deps([new SwissServerError(SwissError.Busy, 429, 7), result([{ start: 0, end: 1, text: 'Hi.' }])])
    d.sleep = async (ms) => { waits.push(ms) }
    expect(await runServerJob(m, async () => [take(0, 1000)], d)).toBe(ServerJobState.Done)
    expect(waits).toEqual([7000])
    expect(calls.length).toBe(2)
    const m2 = meeting({ id: 'm2' })
    const busy = () => new SwissServerError(SwissError.Busy, 429, null)
    const r2 = deps([busy(), busy(), busy(), busy(), busy(), busy()])
    expect(await runServerJob(m2, async () => [take(0, 1000)], r2.d)).toBe(ServerJobState.Failed)
    expect(r2.calls.length).toBe(5)
    expect(m2.serverJob.error).toBe(SwissError.Busy)
  })
  it('not switched on, allowance reached: failed with the reason, nothing retried', async () => {
    for (const code of [SwissError.NotConfigured, SwissError.AllowanceReached, SwissError.BusyToday]) {
      const m = meeting({ id: 'x' + code })
      const { d, calls } = deps([new SwissServerError(code, 503)])
      expect(await runServerJob(m, async () => [take(0, 1000)], d)).toBe(ServerJobState.Failed)
      expect(calls.length).toBe(1)
      expect(m.serverJob.error).toBe(code)
    }
  })
  it('a try after a failure goes on from the next take: a done take is never sent (charged) again', async () => {
    const m = meeting()
    const first = deps([result([{ start: 0, end: 1, text: 'A.' }]), new SwissServerError(SwissError.Provider, 502)])
    expect(await runServerJob(m, async () => [take(0, 1000), take(1000, 1000)], first.d)).toBe(ServerJobState.Failed)
    expect(m.serverJob.takesDone).toBe(1)
    const second = deps([result([{ start: 0, end: 1, text: 'B.' }])])
    expect(await runServerJob(m, async () => [take(0, 1000), take(1000, 1000)], second.d)).toBe(ServerJobState.Done)
    expect(second.calls.length).toBe(1)
    expect(m.transcript.map((t) => t.text)).toEqual(['A.', 'B.'])
  })
  it('a take over an hour is refused before anything is sent', async () => {
    const m = meeting()
    const { d, calls } = deps([])
    expect(await runServerJob(m, async () => [take(0, 3_600_500)], d)).toBe(ServerJobState.Failed)
    expect(m.serverJob.error).toBe(SwissError.TooLarge)
    expect(calls.length).toBe(0)
  })
  it('no audio kept: failed, nothing sent', async () => {
    const m = meeting()
    const { d, calls } = deps([])
    expect(await runServerJob(m, async () => null, d)).toBe(ServerJobState.Failed)
    expect(m.serverJob.error).toBe(SwissError.NotFound)
    expect(calls.length).toBe(0)
  })
  it('never starts over a transcript the meeting already has, never twice, never after done', () => {
    expect(canStartJob(meeting({ transcript: [{ speaker: 1, atMs: 0, text: 'live' }] }))).toBe(false)
    expect(canStartJob(meeting({ serverJob: { state: 'done', at: 1, takesDone: 1 } }))).toBe(false)
    expect(canStartJob(meeting({ serverJob: { state: 'running', at: 1, takesDone: 0 } }))).toBe(false)
    expect(canStartJob(meeting({ serverJob: { state: 'failed', at: 1, takesDone: 1 }, transcript: [{ speaker: 1, atMs: 0, text: 'A.' }] }))).toBe(true)
    expect(canStartJob(meeting())).toBe(true)
  })
  it('a job found running at boot (the app closed mid-call) becomes "may still be charged", nothing else changes', () => {
    const list = [meeting({ serverJob: { state: 'running', at: 1, takesDone: 1 } }), meeting({ id: 'b', serverJob: { state: 'done', at: 1, takesDone: 2 } }), null, { id: 'odd' }]
    expect(settleInterruptedJobs(list, () => false)).toBe(true)
    expect(list[0].serverJob).toEqual({ state: 'maybe-charged', at: 1, takesDone: 1 })
    expect(list[1].serverJob.state).toBe('done')
    expect(settleInterruptedJobs(list, () => false)).toBe(false)
    expect(settleInterruptedJobs(undefined)).toBe(false)
  })
})

describe('the link that fills in later', () => {
  it('the full pack goes to the SAME slot under the same key with a FRESH IV every time (review-app-b: never a nonce reused)', async () => {
    const key = await newRandomKey()
    const puts = []
    const saved = globalThis.fetch
    globalThis.fetch = async (url, init) => { puts.push({ url, body: new Uint8Array(init.body) }); return new Response(null, { status: 204 }) }
    try {
      await backupNow(key, { v: 1, pending: true }, 'https://backup.test/backup')
      await backupNow(key, { v: 1 }, 'https://backup.test/backup')
    } finally {
      globalThis.fetch = saved
    }
    expect(puts[0].url).toBe(puts[1].url)
    expect(puts[0].url.startsWith('https://backup.test/backup/')).toBe(true)
    expect([...puts[0].body.slice(1, 13)].join()).not.toBe([...puts[1].body.slice(1, 13)].join())
  })
  const entry = (k, notes = ['n1']) => ({ keyText: k, title: 'Meeting with Anna', notes, at: 5 })
  const sendDeps = (fail = 0) => {
    const sent = []
    const waits = []
    let failures = fail
    return {
      sent, waits,
      d: {
        upload: async (keyText, pack) => { if (failures-- > 0) throw new Error('down'); sent.push({ keyText, pack }) },
        sleep: async (ms) => { waits.push(ms) },
        now: () => 99,
        save: () => {},
      },
    }
  }
  it('keeps each early key once, capped', () => {
    const m = meeting()
    addToOutbox(m, entry('k1'))
    addToOutbox(m, entry('k1'))
    expect(m.outbox.length).toBe(1)
    for (let i = 0; i < OUTBOX_MAX + 5; i++) addToOutbox(m, entry('k' + i))
    expect(m.outbox.length).toBe(OUTBOX_MAX)
  })
  it('the full pack carries the same notes and the transcript as it is now; it is a valid pack', () => {
    const m = meeting({ transcript: [{ speaker: 1, atMs: 0, text: 'Hi.' }] })
    const p = fullPackFor(m, 'Jakob', entry('k1', ['the note']))
    expect(p).toEqual({ v: 1, kind: 'meeting', from: 'Jakob', about: 'Anna', where: 'Impact Hub', startedAt: 1000, durationMs: 5000, notes: ['the note'], transcript: [{ speaker: 1, atMs: 0, text: 'Hi.' }] })
    expect(isMeetingPack(p)).toBe(true)
    expect(isMeetingPack({ ...p, pending: true })).toBe(true)
    expect(isMeetingPack({ ...p, pending: 'yes' })).toBe(false)
  })
  it('nothing goes out while the transcript is still coming; then every early pack is replaced and its key dropped', async () => {
    const m = meeting({ serverJob: { state: 'running', at: 1, takesDone: 0 } })
    addToOutbox(m, entry('k1'))
    addToOutbox(m, entry('k2'))
    const s = sendDeps()
    expect(await flushOutbox(m, 'Jakob', s.d)).toBe(0)
    m.serverJob.state = 'done'
    m.transcript = [{ speaker: 1, atMs: 0, text: 'Done.' }]
    expect(await flushOutbox(m, 'Jakob', s.d)).toBe(2)
    expect(s.sent.map((x) => x.keyText)).toEqual(['k1', 'k2'])
    expect(s.sent.every((x) => x.pack.pending === undefined && x.pack.transcript.length === 1)).toBe(true)
    expect(m.outbox).toBe(undefined)
    expect(m.fullSentAt).toBe(99)
  })
  it('retries with backoff (the PUT is idempotent), and keeps the key when the server stays away', async () => {
    const m = meeting({ serverJob: { state: 'done', at: 1, takesDone: 1 } })
    addToOutbox(m, entry('k1'))
    const flaky = sendDeps(2)
    expect(await flushOutbox(m, 'Jakob', flaky.d)).toBe(1)
    expect(flaky.waits).toEqual(SEND_BACKOFF_MS.slice(0, 2))
    addToOutbox(m, entry('k2'))
    const down = sendDeps(99)
    expect(await flushOutbox(m, 'Jakob', down.d)).toBe(0)
    expect(m.outbox.map((e) => e.keyText)).toEqual(['k2'])
  })
  it('the sender can send it as it is when the transcription failed', async () => {
    const m = meeting({ serverJob: { state: 'failed', at: 1, takesDone: 0 } })
    addToOutbox(m, entry('k1'))
    const s = sendDeps()
    expect(await flushOutbox(m, 'Jakob', s.d, true)).toBe(1)
    expect(s.sent[0].pack.pending).toBe(undefined)
    expect(m.outbox).toBe(undefined)
  })
  it('the receiver polls from 15 s backing off to 60 s', () => {
    expect(pollDelay(0)).toBe(15_000)
    expect(pollDelay(1)).toBe(30_000)
    expect(pollDelay(5)).toBe(POLL_MAX_MS)
  })
  it('a kept meeting takes the full transcript, then stops looking; a still pending one remembers the version', () => {
    const m = meeting({ late: { keyText: 'TW1R-x', etag: '"a"', since: 1 } })
    const pack = { v: 1, kind: 'meeting', from: 'Anna', about: '', where: '', startedAt: 1, durationMs: 1, notes: [], transcript: [{ speaker: 1, atMs: 0, text: 'Part.' }], pending: true }
    expect(applyLatePack(m, pack, '"b"')).toBe(true)
    expect(m.late.etag).toBe('"b"')
    expect(m.transcript.length).toBe(1)
    expect(applyLatePack(m, { ...pack, pending: undefined, transcript: [{ speaker: 1, atMs: 0, text: 'Part.' }, { speaker: 1, atMs: 9, text: 'Rest.' }] }, '"c"')).toBe(true)
    expect(m.late).toBe(undefined)
    expect(m.transcript.length).toBe(2)
    expect(m.lines).toEqual([{ text: 'a note', tag: 'note' }])
    expect(applyLatePack(m, pack, '"d"')).toBe(false)
  })
  it('looks for a week, then stops', () => {
    expect(lateStillWanted({ keyText: 'k', since: 0 }, LATE_KEEP_MS - 1)).toBe(true)
    expect(lateStillWanted({ keyText: 'k', since: 0 }, LATE_KEEP_MS)).toBe(false)
    expect(lateStillWanted(undefined, 0)).toBe(false)
  })
})
