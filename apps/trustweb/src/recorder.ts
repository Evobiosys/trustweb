/**
 * Meeting recording, ON THIS PHONE ONLY.
 *
 * MediaRecorder writes the audio into memory; nothing is uploaded and nothing
 * is transcribed here. Once the meeting is stored, its takes are kept on this
 * phone with it (audio_store.ts, capped) so it can be played again from any
 * transcript line; the owner can also save the audio file and transcribe it
 * later on their own computer (e.g. OmiCompanion). A discarded draft keeps nothing.
 *
 * getUserMedia needs a secure page: iOS Safari refuses it on plain http://
 * LAN URLs, which is why support is reported separately from "unavailable".
 */

export enum RecorderSupport {
  Ready = 'ready',
  NeedsSecurePage = 'insecure',
  Unavailable = 'unavailable',
}

export interface Recording {
  blob: Blob
  mimeType: string
  startedAt: number
  durationMs: number
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export function recorderSupport(): RecorderSupport {
  if (!window.isSecureContext) return RecorderSupport.NeedsSecurePage
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return RecorderSupport.Unavailable
  return RecorderSupport.Ready
}

function pickMimeType(): string {
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

/**
 * Speech at 32 kbit/s where the browser takes a bit rate (about 14.4 MB per
 * hour, what the hosted allowance assumes); a browser that refuses the
 * option records at its own rate.
 */
export const SPEECH_BITS_PER_SECOND = 32_000

function newRecorder(stream: MediaStream, mimeType: string): MediaRecorder {
  const opts: MediaRecorderOptions = { audioBitsPerSecond: SPEECH_BITS_PER_SECOND, ...(mimeType ? { mimeType } : {}) }
  try {
    return new MediaRecorder(stream, opts)
  } catch {
    return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  }
}

/** File extension for the saved audio, from the container the browser chose. */
export function audioExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

/**
 * Called once per take, however it ended: `expected` is false when the
 * browser or the system ended it (incoming call, microphone revoked, iOS
 * locking the screen), so the caller can say so. Chunks are never dropped
 * on that path.
 */
interface TakeState {
  startedAt: number
  stopping: boolean
  discarding: boolean
  /** When the current pause began, 0 while recording. */
  pausedAt: number
  pausedTotal: number
}

function recordedMs(t: TakeState, now: number): number {
  return now - t.startedAt - t.pausedTotal - (t.pausedAt ? now - t.pausedAt : 0)
}

export type TakeHandler = (take: Recording, expected: boolean) => void

export class MeetingRecorder {
  private rec: MediaRecorder | null = null
  private current: TakeState | null = null
  private waiter: (() => void) | null = null

  /** Recording or paused: a take is open. */
  get live(): boolean {
    return this.rec !== null && this.rec.state !== 'inactive'
  }

  get paused(): boolean {
    return this.rec?.state === 'paused'
  }

  /** Recorded milliseconds of the open take (paused time excluded), 0 when idle. */
  elapsed(now: number = Date.now()): number {
    return this.live && this.current ? recordedMs(this.current, now) : 0
  }

  pause(): void {
    if (this.rec?.state !== 'recording' || !this.current) return
    this.rec.pause()
    this.current.pausedAt = Date.now()
  }

  resume(): void {
    if (this.rec?.state !== 'paused' || !this.current) return
    this.rec.resume()
    this.current.pausedTotal += Date.now() - this.current.pausedAt
    this.current.pausedAt = 0
  }

  /** Asks for the microphone and starts recording. Rejects if the person or the browser refuses. */
  async start(onTake: TakeHandler): Promise<void> {
    if (this.live) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = pickMimeType()
    const rec = newRecorder(stream, mimeType)
    // Per-take locals: a late stop event from an earlier take must never touch
    // the chunks, stream or flags of the take that is running now.
    const chunks: Blob[] = []
    const startedAt = Date.now()
    const take: TakeState = { startedAt, stopping: false, discarding: false, pausedAt: 0, pausedTotal: 0 }
    rec.ondataavailable = (e: BlobEvent): void => { if (e.data.size > 0) chunks.push(e.data) }
    rec.onstop = (): void => {
      const type = rec.mimeType || chunks[0]?.type || 'audio/webm'
      const blob = new Blob(chunks, { type })
      stream.getTracks().forEach((t) => t.stop())
      if (this.rec === rec) { this.rec = null; this.current = null }
      const durationMs = recordedMs(take, Date.now())
      if (!take.discarding && blob.size > 0) onTake({ blob, mimeType: type, startedAt, durationMs }, take.stopping)
      const w = this.waiter
      this.waiter = null
      w?.()
    }
    // A track can end without stop(): the OS takes the mic, the person
    // revokes it, the phone locks. Close the take so its audio is kept.
    for (const t of stream.getAudioTracks()) {
      t.addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop() })
    }
    this.rec = rec
    this.current = take
    // A timeslice keeps memory in small chunks instead of one growing buffer.
    rec.start(1000)
  }

  /** Stops on purpose; resolves after the take has been handed to the TakeHandler. */
  stop(): Promise<void> {
    const rec = this.rec
    if (!rec || rec.state === 'inactive' || !this.current) return Promise.resolve()
    this.current.stopping = true
    return new Promise((resolve) => {
      this.waiter = resolve
      rec.stop()
    })
  }

  /** Stops without keeping anything. */
  discard(): void {
    if (this.rec && this.rec.state !== 'inactive' && this.current) {
      this.current.discarding = true
      this.rec.stop()
    }
  }
}

/** "4:07", "1:02:30". */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
