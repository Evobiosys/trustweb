/**
 * Voice notes, ON-DEVICE ONLY.
 *
 * The Web Speech API streams audio to a vendor server in most browsers, which
 * would break the promise on the consent line ("audio stays on this phone").
 * So the microphone is offered only where the browser can recognise speech
 * locally (SpeechRecognition.available({ processLocally: true }), Chromium's
 * on-device mode). Everywhere else the mic stays off and the UI says why;
 * typing always works. Nothing here records or stores audio itself.
 */

export enum VoiceSupport {
  Ready = 'ready',
  NeedsDownload = 'download',
  Unavailable = 'unavailable',
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  processLocally?: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

interface RecognitionCtor {
  new (): RecognitionLike
  available?(opts: { langs: string[]; processLocally: boolean }): Promise<string>
  install?(opts: { langs: string[]; processLocally: boolean }): Promise<boolean>
}

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const VOICE_LANG = 'en-US'

/** Cheap presence check with no call into the speech service. */
export function voiceApiPresent(): boolean {
  const C = ctor()
  return Boolean(C && typeof C.available === 'function')
}

export async function voiceSupport(): Promise<VoiceSupport> {
  const C = ctor()
  if (!C || typeof C.available !== 'function') return VoiceSupport.Unavailable
  try {
    const r = await C.available({ langs: [VOICE_LANG], processLocally: true })
    if (r === 'available') return VoiceSupport.Ready
    if (r === 'downloadable' || r === 'downloading') return VoiceSupport.NeedsDownload
  } catch { /* treat as unavailable */ }
  return VoiceSupport.Unavailable
}

/** Downloads the on-device model (needs a user gesture). */
export async function installVoice(): Promise<boolean> {
  const C = ctor()
  if (!C || typeof C.install !== 'function') return false
  try { return await C.install({ langs: [VOICE_LANG], processLocally: true }) } catch { return false }
}

/**
 * Starts on-device dictation. `onText` receives each finished phrase.
 * Returns a stop function.
 */
export function startDictation(onText: (text: string) => void, onEnd: (error?: string) => void): () => void {
  const C = ctor()
  if (!C) { onEnd('unavailable'); return () => {} }
  const r = new C()
  r.lang = VOICE_LANG
  r.continuous = true
  r.interimResults = false
  r.processLocally = true
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal && res[0]) onText(res[0].transcript.trim())
    }
  }
  r.onerror = (e) => onEnd(e.error)
  r.onend = () => onEnd()
  r.start()
  return () => r.stop()
}
