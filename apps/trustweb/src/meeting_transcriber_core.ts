/**
 * Meeting transcription, engine-independent core.
 *
 * Everything here takes its side effects (clock, fetch, microphone,
 * speech recognition) as injected dependencies, so the unit tests and the
 * live TalkWeave probe drive exactly the code the phone and desktop run.
 * meeting_transcriber.ts is the thin wiring layer that supplies the real
 * browser dependencies and exports the public interface.
 *
 * TalkWeave protocol (read from TalkWeave's server/lib/router.mjs and
 * app/src/lib/mic_engine.ts, reused as is, nothing weakened):
 *   POST {base}/api/mic/start           -> {ok, streamId}   (503 when no ASR engine)
 *   POST {base}/api/mic/audio/{id}      -> raw PCM16LE mono 16 kHz bytes
 *   GET  {base}/api/mic/stream/{id}     -> SSE: `partial` / `final` events,
 *                                          data {tStart, tEnd, text, final}
 *   POST {base}/api/mic/flush/{id}      -> closes the current window (final)
 *   POST {base}/api/mic/stop/{id}       -> tears the stream down
 *   GET  {base}/api/whisper/available   -> {ok, available, modelPresent, engine}
 * A `partial` replaces the previous partial's text for the same window; a
 * `final` closes the window. TalkWeave has no diarization: speakers are
 * labelled by hand, and a speaker switch is a turn boundary (flush).
 */

export enum TranscriberEngine { TalkWeave = 'talkweave', OnDevice = 'on-device', None = 'none' }

export enum TranscriberStatus {
  Idle = 'idle',
  Listening = 'listening',
  Paused = 'paused',
  Offline = 'offline',
  Error = 'error',
}

export interface Segment { id: string; speaker: number; text: string; atMs: number; final: boolean }

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null
}>

/** A microphone that delivers 16 kHz mono PCM16 little-endian chunks. */
export interface AudioSource {
  /** Acquires the microphone. Rejects when access is denied. */
  start(onChunk: (pcm16le: Uint8Array) => void): Promise<void>
  /** Mutes or unmutes capture without releasing the microphone. */
  setEnabled(on: boolean): void
  stop(): void
}

export const TARGET_SAMPLE_RATE = 16000

// ---------------------------------------------------------------- audio math

/** Linear-interpolation downsample to 16 kHz (adequate for speech recognition). */
export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (!Number.isFinite(inputRate) || inputRate <= 0 || inputRate === TARGET_SAMPLE_RATE) return input
  const ratio = inputRate / TARGET_SAMPLE_RATE
  const outLen = Math.max(0, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const lo = Math.floor(src)
    const hi = Math.min(lo + 1, input.length - 1)
    const frac = src - lo
    out[i] = input[lo] * (1 - frac) + input[hi] * frac
  }
  return out
}

/** Float samples in [-1, 1] to PCM16 little-endian bytes, clamping overdrive. */
export function floatToPcm16Bytes(input: Float32Array): Uint8Array {
  const bytes = new Uint8Array(input.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
  }
  return bytes
}

export function encodeChunk(input: Float32Array, inputRate: number): Uint8Array {
  return floatToPcm16Bytes(downsampleTo16k(input, inputRate))
}

// -------------------------------------------------------------- active clock

interface PauseSpan { from: number; to: number | null }

/**
 * Meeting time that does not run while paused. `atMs` of every segment is
 * "active recording time": milliseconds of listening since start(),
 * pauses excluded. All inputs are raw milliseconds since start().
 */
export class ActiveClock {
  private spans: PauseSpan[] = []

  /** Open a pause at `raw`. A second pause while paused is ignored. */
  pause(raw: number): void {
    if (this.isPaused()) return
    this.spans.push({ from: raw, to: null })
  }

  /** Close the open pause at `raw`. Returns how long it lasted (0 if not paused). */
  resume(raw: number): number {
    const open = this.spans[this.spans.length - 1]
    if (!open || open.to !== null) return 0
    open.to = Math.max(open.from, raw)
    return open.to - open.from
  }

  isPaused(): boolean {
    const last = this.spans[this.spans.length - 1]
    return Boolean(last && last.to === null)
  }

  /** Active milliseconds at raw time `raw` (pauses before it subtracted). */
  activeAt(raw: number): number {
    let paused = 0
    for (const s of this.spans) {
      if (raw <= s.from) break
      const end = s.to === null ? raw : Math.min(s.to, raw)
      paused += Math.max(0, end - s.from)
    }
    return Math.max(0, raw - paused)
  }
}

// ------------------------------------------------------------ speaker turns

/**
 * Manual speaker labelling with turn boundaries. The speaker in effect for
 * the utterance in flight keeps their label until the server window closes
 * (`final`); a switch is promoted only then. The first choice before any
 * window is open applies immediately. No detection happens here.
 */
export class TurnTracker {
  private open: number
  private pending: number | null = null

  constructor(initial: number) { this.open = initial }

  get openSpeaker(): number { return this.open }

  /**
   * Request a speaker. Returns true when the caller should close the
   * current window (flush) so the old speaker's utterance is finalised.
   */
  request(speaker: number, windowMayBeOpen: boolean): boolean {
    if (!windowMayBeOpen) {
      this.open = speaker
      this.pending = null
      return false
    }
    const alreadyPending = this.pending !== null
    if (speaker === this.open && !alreadyPending) return false
    this.pending = speaker
    return !alreadyPending
  }

  /** Speaker for the event being processed; promotes a pending switch on `final`. */
  label(final: boolean): number {
    const label = this.open
    if (final && this.pending !== null) {
      this.open = this.pending
      this.pending = null
    }
    return label
  }

  /** The window is gone (stream reopened): apply a pending switch now. */
  settle(): void {
    if (this.pending !== null) {
      this.open = this.pending
      this.pending = null
    }
  }
}

// ------------------------------------------------------------ segment book

/** Remembers each segment by id so a re-sent id updates in place. */
export class SegmentBook {
  private byId = new Map<string, Segment>()

  constructor(private readonly emit: (s: Segment) => void) {}

  get(id: string): Segment | undefined { return this.byId.get(id) }

  /** Insert or update; emits only when something changed. Finalised ids are frozen. */
  upsert(next: Segment): void {
    const prev = this.byId.get(next.id)
    if (prev && prev.final) return
    if (prev && prev.text === next.text && prev.final === next.final && prev.speaker === next.speaker) return
    this.byId.set(next.id, next)
    this.emit(next)
  }

  /** Close one open segment with its last known text. */
  finalize(id: string): void {
    const prev = this.byId.get(id)
    if (!prev || prev.final) return
    this.upsert({ ...prev, final: true })
  }

  /** Close every open segment (stop, or the stream was lost). */
  closeAll(): void {
    for (const s of Array.from(this.byId.values())) if (!s.final) this.finalize(s.id)
  }
}

// ---------------------------------------------------------------- SSE parse

export function parseSseBlock(block: string): { event: string; data: string } | null {
  let event: string | null = null
  let data: string | null = null
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data = line.slice('data:'.length).trim()
  }
  return event === null || data === null ? null : { event, data }
}

// ---------------------------------------------------------- shared plumbing

type Emitter<T> = { on(cb: (v: T) => void): void; emit(v: T): void }

function emitter<T>(): Emitter<T> {
  const cbs: ((v: T) => void)[] = []
  return {
    on: (cb) => { cbs.push(cb) },
    emit: (v) => { for (const cb of cbs) { try { cb(v) } catch { /* a bad listener never stops transcription */ } } },
  }
}

export interface MeetingTranscriberCore {
  readonly engine: TranscriberEngine
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): Promise<void>
  setSpeaker(n: number): void
  onSegment(cb: (s: Segment) => void): void
  onStatus(cb: (status: TranscriberStatus) => void): void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- TalkWeave

export interface TalkWeaveDeps {
  /** Same-origin prefix in the app ('/talkweave'), or a full URL in the probe. */
  base: string
  fetchFn: FetchLike
  audio: AudioSource
  now: () => number
  /** A paused stream older than this is assumed swept by TalkWeave (its stale limit is 120 s). */
  staleAfterMs?: number
  /** How long stop() waits for the final flush before giving up. */
  flushTimeoutMs?: number
  /** Grace for the last SSE event to arrive after a flush response. */
  settleMs?: number
  initialSpeaker?: number
}

const PRE_START_BUFFER_BYTES = TARGET_SAMPLE_RATE * 2 * 10

/**
 * Availability probe against TalkWeave: usable only when the server answers
 * JSON `{ok:true, available:true, modelPresent:true}` (a static host or an
 * SPA fallback answers 200 with HTML for unknown paths, which must not count).
 */
export async function probeTalkWeave(base: string, fetchFn: FetchLike, timeoutMs: number): Promise<boolean> {
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController()
  const timer = setTimeout(() => ctl?.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${base}/api/whisper/available`, ctl ? { signal: ctl.signal } : undefined)
    if (!res.ok) return false
    const type = res.headers.get('content-type') ?? ''
    if (type.indexOf('json') < 0) return false
    const body = (await res.json()) as { ok?: unknown; available?: unknown; modelPresent?: unknown } | null
    return Boolean(body && body.ok === true && body.available === true && body.modelPresent === true)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export interface TalkWeaveCandidate { base: string; timeoutMs: number }

/**
 * Walks the candidate bases in order and returns the first whose probe
 * succeeds, or null. Candidates are tried one after another, never in
 * parallel: the same-origin proxy must win over a direct connection, and a
 * direct connection to the loopback address is only attempted when the first
 * answers nothing usable.
 */
export async function discoverTalkWeave(candidates: readonly TalkWeaveCandidate[], fetchFn: FetchLike): Promise<string | null> {
  for (const c of candidates) {
    if (await probeTalkWeave(c.base, fetchFn, c.timeoutMs)) return c.base
  }
  return null
}

export function createTalkWeaveCore(deps: TalkWeaveDeps): MeetingTranscriberCore {
  const staleAfterMs = deps.staleAfterMs ?? 90_000
  const flushTimeoutMs = deps.flushTimeoutMs ?? 10_000
  const settleMs = deps.settleMs ?? 200
  const segments = emitter<Segment>()
  const statuses = emitter<TranscriberStatus>()
  const book = new SegmentBook((s) => segments.emit(s))
  const clock = new ActiveClock()
  const tracker = new TurnTracker(deps.initialSpeaker ?? 1)

  let status: TranscriberStatus = TranscriberStatus.Idle
  let started = false
  let stopped = false
  let meetingStart = 0
  let streamId: string | null = null
  let streamSeq = 0
  let streamStartRaw = 0
  let sse: AbortController | null = null
  // True once any audio has been sent: from then on a speaker switch must
  // close the window (flush) so the utterance in flight keeps its speaker.
  let audioSent = false
  let reopening: Promise<void> | null = null
  let queue: Promise<void> = Promise.resolve()
  let preStart: Uint8Array[] = []
  let preStartBytes = 0

  const raw = (): number => deps.now() - meetingStart

  function setStatus(next: TranscriberStatus): void {
    if (status === next) return
    status = next
    statuses.emit(next)
  }

  /** Serialise requests so audio chunks and flushes reach TalkWeave in order. */
  function enqueue(job: () => Promise<void>): Promise<void> {
    queue = queue.then(job, job).catch(() => { /* best effort, status handles loss */ })
    return queue
  }

  function handleEvent(final: boolean, d: { tStart: number; text: string }, seq: number): void {
    // Speaker bookkeeping runs before the empty-text drop, so a switch is
    // never skipped by a quiet window.
    const label = tracker.label(final)
    const id = `tw-${seq}-${Math.round(d.tStart * 1000)}`
    const text = d.text.trim()
    const open = book.get(id)
    if (text === '') {
      if (final && open) book.finalize(id)
      return
    }
    const atMs = Math.round(clock.activeAt(streamStartRaw + d.tStart * 1000))
    book.upsert({ id, speaker: open ? open.speaker : label, text, atMs, final })
  }

  function dispatchBlock(block: string, seq: number): void {
    const parsed = parseSseBlock(block)
    if (!parsed) return
    let data: unknown
    try { data = JSON.parse(parsed.data) } catch { return }
    if (!data || typeof data !== 'object') return
    const d = data as Record<string, unknown>
    if (typeof d.tStart !== 'number' || typeof d.text !== 'string') return
    handleEvent(parsed.event === 'final', { tStart: d.tStart, text: d.text }, seq)
  }

  async function consumeSse(id: string, seq: number, ctl: AbortController): Promise<void> {
    try {
      const res = await deps.fetchFn(`${deps.base}/api/mic/stream/${id}`, { signal: ctl.signal })
      if (!res.ok || !res.body) throw new Error('stream refused')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const b of blocks) dispatchBlock(b, seq)
      }
    } catch { /* abort or drop, handled below */ }
    // The connection ended. A deliberate abort (stop, reopen) replaced or
    // cleared `sse`; anything else means the engine went away.
    if (!stopped && sse === ctl) {
      setStatus(TranscriberStatus.Offline)
    }
  }

  /** Opens a fresh TalkWeave stream. Returns false when TalkWeave refuses. */
  async function openStream(): Promise<boolean> {
    let id: string | null = null
    try {
      const res = await deps.fetchFn(`${deps.base}/api/mic/start`, { method: 'POST' })
      if (res.ok) {
        const body = (await res.json()) as { streamId?: unknown } | null
        if (body && typeof body.streamId === 'string') id = body.streamId
      }
    } catch { /* offline */ }
    if (!id) return false
    if (stopped) {
      // stop() ran while this stream was being opened: do not leave it running.
      try { await deps.fetchFn(`${deps.base}/api/mic/stop/${id}`, { method: 'POST' }) } catch { /* nothing to undo */ }
      return false
    }
    if (sse) { const old = sse; sse = null; old.abort() }
    book.closeAll()
    tracker.settle()
    streamSeq += 1
    streamId = id
    streamStartRaw = raw()
    const ctl = new AbortController()
    sse = ctl
    void consumeSse(id, streamSeq, ctl)
    return true
  }

  function postChunk(bytes: Uint8Array): void {
    const id = streamId
    if (!id) return
    void enqueue(async () => {
      const res = await deps.fetchFn(`${deps.base}/api/mic/audio/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes,
      })
      if (res.status === 404 && id === streamId) void reopen()
    })
    audioSent = true
  }

  function flush(): Promise<void> {
    const id = streamId
    if (!id) return Promise.resolve()
    return enqueue(async () => {
      const res = await deps.fetchFn(`${deps.base}/api/mic/flush/${id}`, { method: 'POST' })
      if (res.status === 404 && id === streamId) await reopen()
    })
  }

  function reopen(): Promise<void> {
    if (reopening) return reopening
    reopening = (async () => {
      const ok = await openStream()
      if (stopped) return
      if (!ok) setStatus(TranscriberStatus.Offline)
      // A reopen that succeeds after an Offline spell brings the meeting back.
      else if (status === TranscriberStatus.Offline) setStatus(TranscriberStatus.Listening)
    })().finally(() => { reopening = null })
    return reopening
  }

  function onChunk(bytes: Uint8Array): void {
    if (stopped || status === TranscriberStatus.Paused) return
    if (!streamId) {
      preStart.push(bytes)
      preStartBytes += bytes.length
      while (preStartBytes > PRE_START_BUFFER_BYTES && preStart.length > 1) {
        preStartBytes -= (preStart.shift() as Uint8Array).length
      }
      return
    }
    postChunk(bytes)
  }

  return {
    engine: TranscriberEngine.TalkWeave,

    async start(): Promise<void> {
      if (started) return
      started = true
      meetingStart = deps.now()
      // Microphone first: a denial rejects before any server stream exists.
      try {
        await deps.audio.start(onChunk)
      } catch (err) {
        started = false
        setStatus(TranscriberStatus.Error)
        throw err
      }
      const ok = await openStream()
      if (!ok) {
        deps.audio.stop()
        stopped = true
        setStatus(TranscriberStatus.Offline)
        return
      }
      setStatus(TranscriberStatus.Listening)
      const buffered = preStart
      preStart = []
      preStartBytes = 0
      for (const b of buffered) postChunk(b)
    },

    pause(): void {
      if (!started || stopped || status !== TranscriberStatus.Listening) return
      clock.pause(raw())
      deps.audio.setEnabled(false)
      setStatus(TranscriberStatus.Paused)
      // Close the window so the utterance in flight is finalised. The SSE
      // connection stays open: closing it would stop the server stream.
      void flush()
    },

    resume(): void {
      if (!started || stopped || status !== TranscriberStatus.Paused) return
      const pausedFor = clock.resume(raw())
      deps.audio.setEnabled(true)
      setStatus(TranscriberStatus.Listening)
      // TalkWeave sweeps streams without audio for 120 s: start a new one.
      if (pausedFor >= staleAfterMs) void reopen()
    },

    async stop(): Promise<void> {
      if (!started || stopped) return
      stopped = true
      deps.audio.stop()
      const id = streamId
      if (id) {
        if (status !== TranscriberStatus.Paused && status !== TranscriberStatus.Offline) {
          const closing = enqueue(async () => {
            await deps.fetchFn(`${deps.base}/api/mic/flush/${id}`, { method: 'POST' })
          }).then(() => sleep(settleMs))
          await Promise.race([closing, sleep(flushTimeoutMs)])
        }
        const old = sse
        sse = null
        old?.abort()
        try { await deps.fetchFn(`${deps.base}/api/mic/stop/${id}`, { method: 'POST' }) } catch { /* swept already */ }
      }
      streamId = null
      book.closeAll()
      setStatus(TranscriberStatus.Idle)
    },

    setSpeaker(n: number): void {
      if (stopped) return
      // Before any audio there is no window: the choice applies at once.
      if (tracker.request(n, audioSent)) void flush()
    },

    onSegment: (cb) => segments.on(cb),
    onStatus: (cb) => statuses.on(cb),
  }
}

// ---------------------------------------------------------------- on-device

export interface OnDeviceDeps {
  /** Acquires then releases the microphone: rejects when access is denied. */
  requestMic: () => Promise<void>
  /** On-device speech available (processLocally), checked once at start(). */
  supported: () => Promise<boolean>
  /**
   * Starts recognition. `onText` gets each finished phrase; `onEnd` fires
   * when the recognizer stops (silence timeouts included). Returns stop().
   */
  recognise: (onText: (text: string) => void, onEnd: (error?: string) => void) => () => void
  now: () => number
  initialSpeaker?: number
  restartDelayMs?: number
}

// audio-capture: no microphone, or another app holds it: restarting cannot help.
const FATAL_RECOGNITION_ERRORS = ['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture']

export function createOnDeviceCore(deps: OnDeviceDeps): MeetingTranscriberCore {
  const segments = emitter<Segment>()
  const statuses = emitter<TranscriberStatus>()
  const book = new SegmentBook((s) => segments.emit(s))
  const clock = new ActiveClock()
  const restartDelayMs = deps.restartDelayMs ?? 300

  let status: TranscriberStatus = TranscriberStatus.Idle
  let started = false
  let stopped = false
  let meetingStart = 0
  let speaker = deps.initialSpeaker ?? 1
  let generation = 0
  let counter = 0
  let stopRecognition: (() => void) | null = null

  const raw = (): number => deps.now() - meetingStart

  function setStatus(next: TranscriberStatus): void {
    if (status === next) return
    status = next
    statuses.emit(next)
  }

  function listen(): void {
    generation += 1
    const mine = generation
    let ended = false
    stopRecognition = deps.recognise(
      (text) => {
        if (mine !== generation || stopped || status !== TranscriberStatus.Listening) return
        const clean = text.trim()
        if (clean === '') return
        counter += 1
        // The microphone cannot say when the phrase began, so atMs is when
        // it finished; the speaker is whoever is selected at that moment.
        book.upsert({ id: `od-${mine}-${counter}`, speaker, text: clean, atMs: Math.round(clock.activeAt(raw())), final: true })
      },
      (error) => {
        // A recognizer reports both onerror and onend: act once per run.
        if (ended || mine !== generation) return
        ended = true
        if (stopped || status === TranscriberStatus.Paused) return
        if (error && FATAL_RECOGNITION_ERRORS.indexOf(error) >= 0) {
          setStatus(TranscriberStatus.Error)
          return
        }
        // Silence timeouts end continuous recognition: start the next run.
        setTimeout(() => { if (!stopped && status === TranscriberStatus.Listening && mine === generation) listen() }, restartDelayMs)
      },
    )
  }

  return {
    engine: TranscriberEngine.OnDevice,

    async start(): Promise<void> {
      if (started) return
      started = true
      meetingStart = deps.now()
      try {
        await deps.requestMic()
        if (!(await deps.supported())) throw new Error('on-device speech recognition is not available')
      } catch (err) {
        started = false
        setStatus(TranscriberStatus.Error)
        throw err
      }
      setStatus(TranscriberStatus.Listening)
      listen()
    },

    pause(): void {
      if (!started || stopped || status !== TranscriberStatus.Listening) return
      clock.pause(raw())
      setStatus(TranscriberStatus.Paused)
      generation += 1
      stopRecognition?.()
      stopRecognition = null
    },

    resume(): void {
      if (!started || stopped || status !== TranscriberStatus.Paused) return
      clock.resume(raw())
      setStatus(TranscriberStatus.Listening)
      listen()
    },

    async stop(): Promise<void> {
      if (!started || stopped) return
      stopped = true
      generation += 1
      stopRecognition?.()
      stopRecognition = null
      book.closeAll()
      setStatus(TranscriberStatus.Idle)
    },

    setSpeaker(n: number): void { speaker = n },
    onSegment: (cb) => segments.on(cb),
    onStatus: (cb) => statuses.on(cb),
  }
}

// --------------------------------------------------------------------- none

export function createNoneCore(): MeetingTranscriberCore {
  const statuses = emitter<TranscriberStatus>()
  const segments = emitter<Segment>()
  return {
    engine: TranscriberEngine.None,
    async start(): Promise<void> { statuses.emit(TranscriberStatus.Offline) },
    pause(): void {},
    resume(): void {},
    async stop(): Promise<void> {},
    setSpeaker(): void {},
    onSegment: (cb) => segments.on(cb),
    onStatus: (cb) => statuses.on(cb),
  }
}
