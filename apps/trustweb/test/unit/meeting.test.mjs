/**
 * Unit tests for the meeting transcriber core and SenseMeet logic.
 * The TalkWeave server is replaced by an in-memory fake that speaks the
 * same protocol (see meeting_transcriber_core.ts header), so the adapter's
 * real code path runs: start order, speaker turns, pause accounting,
 * stale-stream recovery, offline handling.
 */
import {
  ActiveClock, SegmentBook, TurnTracker, TranscriberEngine, TranscriberStatus,
  createNoneCore, createOnDeviceCore, createTalkWeaveCore, downsampleTo16k, floatToPcm16Bytes,
  parseSseBlock, probeTalkWeave,
} from '../../src/meeting_transcriber_core.ts'
import { formatClock, layerComments, meetingToNoteText, meetingToText, settledSegments } from '../../src/sensemeet.ts'
import { extractLines } from '../../src/notes.ts'

const seg = (id, speaker, text, atMs, final = true) => ({ id, speaker, text, atMs, final })
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------ fake TalkWeave
function fakeTalkWeave(opts = {}) {
  const state = { streams: new Map(), audioBytes: 0, flushes: 0, stops: 0, started: 0, nextId: 1, startStatus: opts.startStatus ?? 200 }
  const enc = new TextEncoder()
  function emit(id, event, data) {
    const s = state.streams.get(id)
    if (!s) return
    const block = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    if (s.waiter) { const w = s.waiter; s.waiter = null; w({ done: false, value: block }) } else s.queue.push(block)
  }
  const json = (status, body) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, body: null })
  const fetchFn = async (url, init = {}) => {
    const path = url.replace('http://tw', '')
    const m = init.method ?? 'GET'
    if (m === 'POST' && path === '/api/mic/start') {
      if (state.startStatus !== 200) return json(state.startStatus, { ok: false })
      const id = 's' + state.nextId++
      state.started++
      state.streams.set(id, { queue: [], waiter: null, window: { text: '', t0: 0 }, chunks: 0 })
      return json(200, { ok: true, streamId: id })
    }
    let mm
    if (m === 'POST' && (mm = /^\/api\/mic\/audio\/(.+)$/.exec(path))) {
      const s = state.streams.get(mm[1])
      if (!s) return json(404, { ok: false })
      s.chunks += 1
      state.audioBytes += init.body.length
      const n = s.chunks
      // like TalkWeave: each tick re-decodes the window and sends a partial
      emit(mm[1], 'partial', { tStart: s.window.t0, tEnd: s.window.t0 + n, text: `words ${n}`, final: false })
      return json(200, { ok: true })
    }
    if (m === 'POST' && (mm = /^\/api\/mic\/flush\/(.+)$/.exec(path))) {
      const s = state.streams.get(mm[1])
      if (!s) return json(404, { ok: false })
      state.flushes++
      const text = s.chunks > 0 ? `words ${s.chunks} done` : ''
      emit(mm[1], 'final', { tStart: s.window.t0, tEnd: s.window.t0 + s.chunks, text, final: true })
      s.window = { text: '', t0: s.window.t0 + 10 }
      s.chunks = 0
      return json(200, { ok: true })
    }
    if (m === 'POST' && (mm = /^\/api\/mic\/stop\/(.+)$/.exec(path))) { state.stops++; state.streams.delete(mm[1]); return json(200, { ok: true }) }
    if (m === 'GET' && (mm = /^\/api\/mic\/stream\/(.+)$/.exec(path))) {
      const s = state.streams.get(mm[1])
      if (!s) return json(404, { ok: false })
      const reader = {
        read: () => new Promise((resolve, reject) => {
          if (init.signal?.aborted) return reject(new Error('aborted'))
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          if (s.queue.length) return resolve({ done: false, value: s.queue.shift() })
          s.waiter = resolve
        }),
      }
      return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, json: async () => ({}), body: { getReader: () => reader } }
    }
    throw new Error('fake: unhandled ' + m + ' ' + path)
  }
  return { state, fetchFn, sweep: () => state.streams.clear() }
}

function fakeAudio(opts = {}) {
  const a = { onChunk: null, enabled: true, stopped: false, started: 0 }
  a.source = {
    start: async (cb) => { if (opts.deny) throw new Error('NotAllowedError'); a.started++; a.onChunk = cb },
    setEnabled: (on) => { a.enabled = on },
    stop: () => { a.stopped = true },
  }
  a.feed = (n = 1) => { for (let i = 0; i < n; i++) if (a.enabled && !a.stopped) a.onChunk(new Uint8Array(3200)) }
  return a
}

function makeTw(over = {}) {
  const tw = fakeTalkWeave(over.tw)
  const audio = fakeAudio(over.audio)
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms) => { t += ms } }
  const core = createTalkWeaveCore({ base: 'http://tw', fetchFn: tw.fetchFn, audio: audio.source, now: clock.now, settleMs: 5, ...over.deps })
  const segs = []
  const statuses = []
  core.onSegment((s) => segs.push(s))
  core.onStatus((s) => statuses.push(s))
  return { tw, audio, clock, core, segs, statuses }
}

// --------------------------------------------------------------- pure pieces
describe('ActiveClock', () => {
  it('runs 1:1 without pauses', () => {
    expect(new ActiveClock().activeAt(5000)).toBe(5000)
  })
  it('subtracts closed pauses and clamps inside a pause', () => {
    const c = new ActiveClock()
    c.pause(10_000)
    expect(c.isPaused()).toBe(true)
    expect(c.resume(25_000)).toBe(15_000)
    expect(c.activeAt(5_000)).toBe(5_000)
    expect(c.activeAt(10_000)).toBe(10_000)
    expect(c.activeAt(18_000)).toBe(10_000) // inside the pause: frozen at pause start
    expect(c.activeAt(30_000)).toBe(15_000)
  })
  it('handles several pauses and an open pause', () => {
    const c = new ActiveClock()
    c.pause(1000); c.resume(2000)
    c.pause(5000); c.resume(8000)
    expect(c.activeAt(10_000)).toBe(10_000 - 1000 - 3000)
    c.pause(12_000)
    expect(c.activeAt(20_000)).toBe(12_000 - 4000)
  })
  it('ignores a double pause and a resume without pause', () => {
    const c = new ActiveClock()
    expect(c.resume(100)).toBe(0)
    c.pause(100); c.pause(500)
    expect(c.resume(1100)).toBe(1000)
  })
})

describe('TurnTracker', () => {
  it('applies the first choice at once when no window is open', () => {
    const t = new TurnTracker(1)
    expect(t.request(2, false)).toBe(false)
    expect(t.label(false)).toBe(2)
  })
  it('keeps the old speaker for the utterance in flight and promotes on final', () => {
    const t = new TurnTracker(1)
    expect(t.request(2, true)).toBe(true) // caller flushes
    expect(t.label(false)).toBe(1)        // late partial still speaker 1
    expect(t.label(true)).toBe(1)         // the flushed final is speaker 1
    expect(t.label(false)).toBe(2)        // next window is speaker 2
  })
  it('does not ask for a flush for the speaker already open, or a second request', () => {
    const t = new TurnTracker(1)
    expect(t.request(1, true)).toBe(false)
    expect(t.request(2, true)).toBe(true)
    expect(t.request(1, true)).toBe(false) // flush already on its way
    t.label(true)
    expect(t.openSpeaker).toBe(1)          // switched back before the final
  })
  it('settle applies a pending switch', () => {
    const t = new TurnTracker(1)
    t.request(2, true); t.settle()
    expect(t.openSpeaker).toBe(2)
  })
})

describe('SegmentBook', () => {
  it('emits updates, dedupes identical re-sends, freezes finals', () => {
    const out = []
    const b = new SegmentBook((s) => out.push(s))
    b.upsert(seg('a', 1, 'hel', 0, false))
    b.upsert(seg('a', 1, 'hel', 0, false))
    b.upsert(seg('a', 1, 'hello', 0, false))
    b.upsert(seg('a', 1, 'hello there', 0, true))
    b.upsert(seg('a', 1, 'late echo', 0, false))
    expect(out.map((s) => [s.text, s.final])).toEqual([['hel', false], ['hello', false], ['hello there', true]])
  })
  it('closeAll finalises open ones with their last text', () => {
    const out = []
    const b = new SegmentBook((s) => out.push(s))
    b.upsert(seg('a', 1, 'one', 0, false))
    b.upsert(seg('b', 2, 'two', 5, true))
    b.closeAll()
    expect(out[out.length - 1]).toEqual(seg('a', 1, 'one', 0, true))
    expect(out.length).toBe(3)
  })
})

describe('audio math and SSE parsing', () => {
  it('downsamples 48k to 16k by length and passes 16k through', () => {
    const x = new Float32Array(4800).fill(0.5)
    expect(downsampleTo16k(x, 48000).length).toBe(1600)
    expect(downsampleTo16k(x, 16000)).toBe(x)
  })
  it('encodes PCM16 little-endian with clamping', () => {
    const b = floatToPcm16Bytes(new Float32Array([0, 1, -1, 2]))
    const v = new DataView(b.buffer)
    expect([v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true)]).toEqual([0, 32767, -32768, 32767])
  })
  it('parses an SSE block and rejects half blocks', () => {
    expect(parseSseBlock('event: final\ndata: {"a":1}')).toEqual({ event: 'final', data: '{"a":1}' })
    expect(parseSseBlock('data: x')).toBeNull()
  })
})

// ------------------------------------------------------------------ TalkWeave
describe('TalkWeave adapter', () => {
  it('start opens a stream; partials update one id, flush finalises it', async () => {
    const { core, tw, audio, segs, statuses } = makeTw()
    await core.start()
    expect(statuses).toEqual([TranscriberStatus.Listening])
    audio.feed(2)
    await tick(5)
    await core.stop()
    const ids = new Set(segs.map((s) => s.id))
    expect(ids.size).toBe(1)
    expect(segs[segs.length - 1].final).toBe(true)
    expect(segs[segs.length - 1].text).toBe('words 2 done')
    expect(segs.filter((s) => !s.final).length).toBeGreaterThan(0)
    expect(tw.state.stops).toBe(1)
    expect(statuses[statuses.length - 1]).toBe(TranscriberStatus.Idle)
  })

  it('manual speaker switch: in-flight utterance keeps the old speaker', async () => {
    const { core, audio, segs } = makeTw()
    await core.start()
    audio.feed(2)
    await tick(5)
    core.setSpeaker(2)
    await tick(10)
    audio.feed(3)
    await tick(5)
    await core.stop()
    const finals = segs.filter((s) => s.final)
    expect(finals.map((s) => s.speaker)).toEqual([1, 2])
    expect(finals[0].text).toBe('words 2 done')
    expect(finals[1].text).toBe('words 3 done')
    expect(new Set(finals.map((s) => s.id)).size).toBe(2)
  })

  it('a speaker chosen before any audio applies at once and never flushes', async () => {
    const { core, tw, audio, segs } = makeTw()
    await core.start()
    core.setSpeaker(2)
    audio.feed(1)
    await tick(5)
    expect(tw.state.flushes).toBe(0)
    await core.stop()
    expect(segs[segs.length - 1].speaker).toBe(2)
  })

  it('pause drops audio, flushes, keeps the stream; atMs excludes the pause', async () => {
    const { core, tw, audio, clock, segs, statuses } = makeTw()
    await core.start()
    clock.advance(1000)
    audio.feed(1)
    await tick(5)
    core.pause()
    expect(statuses[statuses.length - 1]).toBe(TranscriberStatus.Paused)
    await tick(10)
    expect(tw.state.flushes).toBe(1)
    const before = tw.state.audioBytes
    audio.feed(3) // muted, nothing may reach the server
    await tick(5)
    expect(tw.state.audioBytes).toBe(before)
    clock.advance(60_000) // one minute paused
    core.resume()
    expect(statuses[statuses.length - 1]).toBe(TranscriberStatus.Listening)
    expect(tw.state.started).toBe(1) // short pause: same stream
    clock.advance(500)
    audio.feed(1)
    await tick(5)
    await core.stop()
    const second = segs.filter((s) => s.final)[1]
    // The fake server's window 2 starts at t=10 s on its own clock, which
    // falls inside the pause (raw 1 000 to 61 000), so it maps to the moment
    // the pause began: 1 000 active ms, not 10 000.
    expect(second.atMs).toBe(1000)
  })

  it('a pause past the stale limit opens a fresh stream, with atMs still on the active clock', async () => {
    const { core, tw, audio, clock, segs } = makeTw()
    await core.start()
    clock.advance(2000)
    audio.feed(1)
    await tick(5)
    core.pause()
    await tick(10)
    clock.advance(200_000)
    tw.sweep() // TalkWeave swept the idle stream
    core.resume()
    await tick(10)
    expect(tw.state.started).toBe(2)
    audio.feed(1)
    await tick(5)
    await core.stop()
    const finals = segs.filter((s) => s.final)
    expect(finals.length).toBe(2)
    expect(finals[0].id).not.toBe(finals[1].id)
    expect(finals[1].atMs).toBeGreaterThanOrEqual(2000)
    expect(finals[1].atMs).toBeLessThan(5000) // not 200 s later
  })

  it('a 404 on audio reopens the stream instead of going offline', async () => {
    const { core, tw, audio } = makeTw()
    await core.start()
    tw.sweep()
    audio.feed(1)
    await tick(20)
    expect(tw.state.started).toBe(2)
    await core.stop()
  })

  it('stop() during a reopen does not leave a stream running', async () => {
    const tw = fakeTalkWeave()
    const audio = fakeAudio()
    let slowStarts = false
    const fetchFn = async (url, init) => {
      const res = await tw.fetchFn(url, init)
      if (slowStarts && url.endsWith('/api/mic/start')) await tick(30)
      return res
    }
    const core = createTalkWeaveCore({ base: 'http://tw', fetchFn, audio: audio.source, now: Date.now, settleMs: 5 })
    await core.start()
    audio.feed(1)
    await tick(5)
    tw.sweep()
    slowStarts = true
    audio.feed(1) // 404 -> reopen begins, mic/start is slow
    await tick(5)
    await core.stop() // stop while the reopen is in flight
    await tick(60)
    expect(tw.state.started).toBe(2)
    expect(tw.state.streams.size).toBe(0) // the late stream was stopped, not leaked
  })

  it('a reopen that succeeds after an Offline spell goes back to Listening', async () => {
    const { core, tw, audio, statuses } = makeTw()
    await core.start()
    audio.feed(1)
    await tick(5)
    tw.state.startStatus = 503
    tw.sweep()
    audio.feed(1) // 404 -> reopen -> 503 -> Offline
    await tick(20)
    expect(statuses[statuses.length - 1]).toBe(TranscriberStatus.Offline)
    tw.state.startStatus = 200
    tw.sweep()
    audio.feed(1) // 404 again -> reopen succeeds
    await tick(20)
    expect(statuses[statuses.length - 1]).toBe(TranscriberStatus.Listening)
    await core.stop()
  })

  it('audio is buffered while the stream opens', async () => {
    const tw = fakeTalkWeave()
    const audio = fakeAudio()
    const slow = async (url, init) => { if (url.endsWith('/api/mic/start')) await tick(20); return tw.fetchFn(url, init) }
    const core = createTalkWeaveCore({ base: 'http://tw', fetchFn: slow, audio: audio.source, now: Date.now, settleMs: 5 })
    const p = core.start()
    await tick(2)
    audio.feed(2) // before mic/start answered
    await p
    await tick(10)
    expect(tw.state.audioBytes).toBe(2 * 3200)
    await core.stop()
  })

  it('mic denial rejects start and posts nothing to TalkWeave', async () => {
    const { core, tw, statuses } = makeTw({ audio: { deny: true } })
    await expect(core.start()).rejects.toThrow('NotAllowedError')
    expect(tw.state.started).toBe(0)
    expect(statuses).toEqual([TranscriberStatus.Error])
  })

  it('TalkWeave without an ASR engine (503): Offline, mic released, start resolves', async () => {
    const { core, audio, statuses } = makeTw({ tw: { startStatus: 503 } })
    await core.start()
    expect(statuses).toEqual([TranscriberStatus.Offline])
    expect(audio.stopped).toBe(true)
    await core.stop()
  })

  it('an empty final does not invent a segment, but closes an open one with its last text', async () => {
    const { core, audio, segs } = makeTw()
    await core.start()
    core.setSpeaker(2) // no audio yet: no flush, no segment
    expect(segs.length).toBe(0)
    audio.feed(1)
    await tick(5)
    await core.stop()
    expect(segs.every((s) => s.text !== '')).toBe(true)
  })

  it('probeTalkWeave accepts only a JSON answer with an engine', async () => {
    const res = (ok, type, body) => async () => ({ ok, status: ok ? 200 : 503, headers: { get: () => type }, json: async () => body, body: null })
    expect(await probeTalkWeave('/talkweave', res(true, 'application/json', { ok: true, available: true, modelPresent: true }), 100)).toBe(true)
    expect(await probeTalkWeave('/talkweave', res(true, 'application/json', { ok: true, available: true, modelPresent: false }), 100)).toBe(false)
    expect(await probeTalkWeave('/talkweave', res(true, 'text/html', {}), 100)).toBe(false) // SPA fallback
    expect(await probeTalkWeave('/talkweave', res(false, 'application/json', {}), 100)).toBe(false)
    expect(await probeTalkWeave('/talkweave', async () => { throw new Error('down') }, 100)).toBe(false)
  })
})

// ------------------------------------------------------------------ on-device
describe('on-device adapter', () => {
  function makeOd(over = {}) {
    let t = 0
    const rec = { runs: 0, onText: null, onEnd: null, stops: 0 }
    const core = createOnDeviceCore({
      requestMic: over.requestMic ?? (async () => {}),
      supported: over.supported ?? (async () => true),
      recognise: (onText, onEnd) => { rec.runs++; rec.onText = onText; rec.onEnd = onEnd; return () => { rec.stops++ } },
      now: () => t,
      restartDelayMs: 1,
    })
    const segs = []
    const statuses = []
    core.onSegment((s) => segs.push(s))
    core.onStatus((s) => statuses.push(s))
    return { core, rec, segs, statuses, at: (ms) => { t = ms } }
  }

  it('turns phrases into final segments with the manual speaker and active time', async () => {
    const { core, rec, segs, at } = makeOd()
    await core.start()
    at(2000); rec.onText('hello there')
    core.setSpeaker(2)
    at(4000); rec.onText('hi')
    core.pause(); at(10_000); core.resume()
    at(11_000); rec.onText('after the break')
    expect(segs.map((s) => [s.speaker, s.text, s.atMs, s.final])).toEqual([
      [1, 'hello there', 2000, true], [2, 'hi', 4000, true], [2, 'after the break', 5000, true],
    ])
    expect(new Set(segs.map((s) => s.id)).size).toBe(3)
  })

  it('restarts after a silence timeout, not after stop', async () => {
    const { core, rec } = makeOd()
    await core.start()
    rec.onEnd('no-speech'); rec.onEnd() // onerror then onend
    await tick(10)
    expect(rec.runs).toBe(2)
    await core.stop()
    rec.onEnd()
    await tick(10)
    expect(rec.runs).toBe(2)
  })

  it('a permission or capture error mid-meeting is Error, not a restart loop', async () => {
    for (const code of ['not-allowed', 'audio-capture']) {
      const { core, rec, statuses } = makeOd()
      await core.start()
      rec.onEnd(code)
      await tick(10)
      expect(rec.runs).toBe(1)
      expect(statuses[statuses.length - 1]).toBe(TranscriberStatus.Error)
    }
  })

  it('start rejects on mic denial or when local recognition is missing', async () => {
    await expect(makeOd({ requestMic: async () => { throw new Error('denied') } }).core.start()).rejects.toThrow('denied')
    await expect(makeOd({ supported: async () => false }).core.start()).rejects.toThrow('not available')
  })

  it('None starts Offline and yields nothing', async () => {
    const core = createNoneCore()
    const st = []
    core.onStatus((s) => st.push(s))
    await core.start()
    expect(core.engine).toBe(TranscriberEngine.None)
    expect(st).toEqual([TranscriberStatus.Offline])
  })
})

// -------------------------------------------------------------------- SenseMeet
describe('sensemeet', () => {
  it('formats clocks, with hours past 60 minutes', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(75_400)).toBe('01:15')
    expect(formatClock(59 * 60_000 + 59_000)).toBe('59:59')
    expect(formatClock(3_600_000)).toBe('1:00:00')
    expect(formatClock(-5)).toBe('00:00')
  })

  it('settles: latest version per id, finals only, empty dropped, sorted by time', () => {
    const out = settledSegments([
      seg('b', 2, 'second', 9000, true),
      seg('a', 1, 'fir', 1000, false),
      seg('a', 1, 'first', 1000, true),
      seg('c', 1, 'still live', 12_000, false),
      seg('d', 1, '   ', 14_000, true),
    ])
    expect(out.map((s) => s.id)).toEqual(['a', 'b'])
    expect(out[0].text).toBe('first')
  })

  it('meetingToText: header plus Speaker n (mm:ss) lines', () => {
    const startedAt = new Date(2026, 9, 5, 14, 30).getTime()
    const text = meetingToText({ who: 'Anna', where: 'Cafe Prueckel', startedAt }, [
      seg('a', 1, 'Nice to meet  you.', 3000),
      seg('b', 2, 'Likewise, I run a food co-op.', 9000),
    ])
    expect(text.split('\n')).toEqual([
      'Meeting with Anna at Cafe Prueckel on 2026-10-05 14:30',
      'Speaker 1 (00:03): Nice to meet you.',
      'Speaker 2 (00:09): Likewise, I run a food co-op.',
    ])
  })

  it('meetingToText: no who/where, and localisable labels', () => {
    const t = meetingToText({ who: '', where: '', startedAt: new Date(2026, 0, 2, 3, 4).getTime() }, [seg('a', 3, 'Hi', 0)], {
      speaker: (n) => `Sprecher ${n}`,
      header: (_m, date) => `Gespraech ${date}`,
    })
    expect(t).toBe('Gespraech 2026-01-02 03:04\nSprecher 3 (00:00): Hi')
    expect(meetingToText({ who: '', where: '', startedAt: 0 }, []).startsWith('Meeting on ')).toBe(true)
  })

  it('meetingToNoteText feeds extractLines: one clean line per utterance, no clock fragments', () => {
    const text = meetingToNoteText([
      seg('a', 1, 'Anna is looking for a carpenter', 1000),
      seg('b', 2, 'I know someone who can help with that.', 5000),
      seg('c', 1, 'You should talk to Berta', 9000),
    ])
    expect(text.split('\n').length).toBe(3)
    const lines = extractLines(text).map((l) => l.text)
    expect(lines).toEqual([
      'Anna is looking for a carpenter',
      'I know someone who can help with that',
      'You should talk to Berta',
    ])
    expect(lines.some((l) => /Speaker|\d\d:\d\d/.test(l))).toBe(false)
  })

  it('layerComments: immutable record, clarification beside it, original untouched', () => {
    const segs = Object.freeze([Object.freeze(seg('a', 1, 'I live in Graz', 1000)), Object.freeze(seg('b', 2, 'ok', 2000))])
    const comments = [
      { segmentId: 'a', text: 'She meant Gratz, the street', clarified: false, at: 5 },
      { segmentId: 'a', text: 'Lives in Graz, Styria', clarified: true, at: 9 },
      { segmentId: 'zzz', text: 'orphan', clarified: true, at: 1 },
    ]
    const layered = layerComments(segs, comments)
    expect(layered.length).toBe(2)
    expect(layered[0].said.text).toBe('I live in Graz')
    expect(layered[0].comments.map((c) => c.at)).toEqual([5, 9])
    expect(layered[0].clarified.text).toBe('Lives in Graz, Styria')
    expect(layered[1].clarified).toBeNull()
  })
})
