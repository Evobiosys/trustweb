/**
 * Meeting transcription for TrustWeb's Meeting view (SenseMeet capture step).
 *
 * Three engines behind one interface:
 *   TalkWeave  desktop only: the TalkWeave server on the same computer
 *              (reached through the same-origin prefix `/talkweave/`),
 *              which transcribes on this machine through the local ASR proxy.
 *   OnDevice   phones and any browser that can recognise speech locally:
 *              Web Speech with processLocally, exactly like speech.ts. Audio
 *              never leaves the phone; a browser that cannot do it locally
 *              gets None, never server-side recognition.
 *   None       nothing live: the UI says the meeting is transcribed later on
 *              your computer.
 *
 * Speakers are labelled by hand (setSpeaker). Nothing here detects who is
 * talking. The logic lives in meeting_transcriber_core.ts; this file only
 * supplies the real browser dependencies.
 */
import {
  type AudioSource,
  type FetchLike,
  type MeetingTranscriberCore,
  type Segment,
  TranscriberEngine,
  TranscriberStatus,
  createNoneCore,
  createOnDeviceCore,
  createTalkWeaveCore,
  encodeChunk,
  probeTalkWeave,
} from './meeting_transcriber_core'
import { startDictation, voiceSupport, VoiceSupport } from './speech'

export { TranscriberEngine, TranscriberStatus }
export type { Segment }

export interface MeetingTranscriber {
  readonly engine: TranscriberEngine
  /** Acquires its own microphone stream; rejects when access is denied. */
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): Promise<void>
  /** Manual speaker label (1, 2, ...). Never faked detection. */
  setSpeaker(n: number): void
  /** The same id may arrive again with final=true and/or updated text. */
  onSegment(cb: (s: Segment) => void): void
  onStatus(cb: (status: TranscriberStatus) => void): void
}

/** Same-origin prefix the dev server proxies to TalkWeave (127.0.0.1:8990). */
export const TALKWEAVE_BASE = '/talkweave'

const PROBE_TIMEOUT_MS = 2500
const SCRIPT_PROCESSOR_BUFFER = 4096

const browserFetch: FetchLike = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>

/** TalkWeave if it is up and has an ASR engine, else on-device, else nothing. */
export async function detectEngine(): Promise<TranscriberEngine> {
  if (typeof fetch === 'function' && await probeTalkWeave(TALKWEAVE_BASE, browserFetch, PROBE_TIMEOUT_MS)) {
    return TranscriberEngine.TalkWeave
  }
  // NeedsDownload counts as unavailable here: installing the on-device model
  // needs a tap, which is the UI's job (speech.ts installVoice).
  if (await voiceSupport() === VoiceSupport.Ready) return TranscriberEngine.OnDevice
  return TranscriberEngine.None
}

function micAudioSource(): AudioSource {
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let nodes: AudioNode[] = []
  let processor: ScriptProcessorNode | null = null
  return {
    async start(onChunk: (b: Uint8Array) => void): Promise<void> {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('microphone unavailable')
      }
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) throw new Error('audio capture unavailable')
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const audioCtx = new Ctor()
      ctx = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      processor = audioCtx.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 1, 1)
      // Routed through a zero-gain node: some browsers only run the processor
      // when it reaches the destination, and the raw mic must not be audible.
      const mute = audioCtx.createGain()
      mute.gain.value = 0
      processor.onaudioprocess = (e: AudioProcessingEvent): void => {
        onChunk(encodeChunk(e.inputBuffer.getChannelData(0), audioCtx.sampleRate))
      }
      source.connect(processor)
      processor.connect(mute)
      mute.connect(audioCtx.destination)
      nodes = [source, mute]
    },
    setEnabled(on: boolean): void {
      if (!stream) return
      for (const t of stream.getAudioTracks()) t.enabled = on
    },
    stop(): void {
      if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = null }
      for (const n of nodes) n.disconnect()
      nodes = []
      if (ctx) { const c = ctx; ctx = null; void c.close().catch(() => {}) }
      if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null }
    },
  }
}

/** Asks for the microphone, then lets go: Web Speech opens its own. */
async function requestMicOnce(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('microphone unavailable')
  }
  const s = await navigator.mediaDevices.getUserMedia({ audio: true })
  for (const t of s.getTracks()) t.stop()
}

export function createTranscriber(engine: TranscriberEngine): MeetingTranscriber {
  let core: MeetingTranscriberCore
  switch (engine) {
    case TranscriberEngine.TalkWeave:
      core = createTalkWeaveCore({ base: TALKWEAVE_BASE, fetchFn: browserFetch, audio: micAudioSource(), now: Date.now })
      break
    case TranscriberEngine.OnDevice:
      core = createOnDeviceCore({
        requestMic: requestMicOnce,
        supported: async () => (await voiceSupport()) === VoiceSupport.Ready,
        recognise: startDictation,
        now: Date.now,
      })
      break
    case TranscriberEngine.None:
      core = createNoneCore()
      break
  }
  return core
}
