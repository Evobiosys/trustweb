/**
 * Meeting recording, ON THIS PHONE ONLY.
 *
 * MediaRecorder writes the audio into memory; nothing is uploaded and nothing
 * is transcribed here. The recording exists for the debrief afterwards: the
 * owner saves the audio file and transcribes it later on their own computer
 * (e.g. OmiCompanion). TrustWeb drops its in-memory copy when the notes are
 * saved or the draft is discarded.
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

/** File extension for the saved audio, from the container the browser chose. */
export function audioExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

export class MeetingRecorder {
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private began = 0

  get live(): boolean {
    return this.rec !== null && this.rec.state !== 'inactive'
  }

  /** Milliseconds since start, 0 when idle. */
  elapsed(now: number = Date.now()): number {
    return this.live ? now - this.began : 0
  }

  /** Asks for the microphone and starts recording. Rejects if the person or the browser refuses. */
  async start(): Promise<void> {
    if (this.live) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = pickMimeType()
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    this.chunks = []
    rec.ondataavailable = (e: BlobEvent): void => { if (e.data.size > 0) this.chunks.push(e.data) }
    this.stream = stream
    this.rec = rec
    this.began = Date.now()
    // A timeslice keeps memory in small chunks and leaves something usable if
    // the tab is closed abruptly in a later version that persists them.
    rec.start(1000)
  }

  /** Stops and returns the finished recording; null if nothing was recording. */
  stop(): Promise<Recording | null> {
    const rec = this.rec
    if (!rec || rec.state === 'inactive') return Promise.resolve(null)
    const startedAt = this.began
    return new Promise((resolve) => {
      rec.onstop = (): void => {
        const mimeType = rec.mimeType || this.chunks[0]?.type || 'audio/webm'
        const blob = new Blob(this.chunks, { type: mimeType })
        this.release()
        resolve({ blob, mimeType, startedAt, durationMs: Date.now() - startedAt })
      }
      rec.stop()
    })
  }

  /** Stops without keeping anything. */
  discard(): void {
    if (this.rec && this.rec.state !== 'inactive') {
      this.rec.onstop = null
      this.rec.stop()
    }
    this.release()
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.rec = null
    this.chunks = []
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
