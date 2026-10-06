/**
 * Server-side transcription of a kept recording (wave 1733 round B, item 5;
 * contract I5 and services-api-contract.txt v1.3 section 4). The audio of
 * each take goes to POST /transcribe, one take after the other; the answer's
 * segments become the meeting's transcript lines (speaker 1, the moment =
 * the take's offset + the segment's start), so the chain of proof (items
 * linked to a line and a moment) works for server transcripts too.
 *
 * Money rules, from the contract:
 *   - the job state is SAVED as "running" before every call, so a reload or a
 *     closed app never sends the audio again by itself: it reads "may still be
 *     charged" and the person decides;
 *   - a timeout or a dropped connection is never retried automatically (an
 *     accepted job is charged even when its answer is lost);
 *   - 429 busy (the paid slot and its short queue are full; nothing charged)
 *     is the only answer retried by itself, after Retry-After, a few times;
 *   - a take already transcribed is never sent again: a new try goes on from
 *     the next take (`takesDone`).
 * DOM-free: the unit tests drive it with a fake server.
 */
import { ServerJobState } from './model'
import type { PastMeeting, ServerJob, TranscriptLine } from './model'
import { declaredSeconds, MAX_SECONDS_PER_CALL, SwissError, SwissServerError, TRANSCRIBE_TIMEOUT_MS } from './swiss_server'
import type { HostedAccount, TranscribeResult } from './swiss_server'

/** One take as the job needs it (audio_store.ts StoredTake has this shape). */
export interface JobTake {
  blob: Blob
  mimeType: string
  offsetMs: number
  durationMs: number
}

export interface JobDeps {
  account: () => Promise<HostedAccount>
  transcribe: (a: HostedAccount, audio: Blob, seconds: number, mimeType: string, signal: AbortSignal) => Promise<TranscribeResult>
  /** Persists the record (the job state is saved before every call). */
  save: () => void
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** The app allows 15 minutes per call (contract v1.3); tests shorten it. */
  timeoutMs?: number
}

/** How often 429 busy is waited out before the job stops as "busy, try again later". */
export const BUSY_RETRIES = 4
const BUSY_WAIT_DEFAULT_S = 10
const BUSY_WAIT_MAX_S = 120

const running = new Set<string>()

/** Is a job for this meeting running in this tab right now? */
export function isJobRunning(meetingId: string): boolean {
  return running.has(meetingId)
}

/** The answer's segments as transcript lines on the recording's timeline; a bare text becomes one line at the take's start. */
export function linesFromResult(offsetMs: number, r: TranscribeResult): TranscriptLine[] {
  if (r.segments.length) return r.segments.map((s) => ({ speaker: 1, atMs: Math.round(offsetMs + s.start * 1000), text: s.text }))
  return r.text ? [{ speaker: 1, atMs: Math.round(offsetMs), text: r.text }] : []
}

/**
 * A job found "running" at boot was cut off (the app closed or reloaded mid-call):
 * its answer is lost and it may have been charged. Never re-sent by itself.
 * Returns whether anything changed.
 */
export function settleInterruptedJobs(meetings: readonly PastMeeting[] | undefined, runningNow: (id: string) => boolean = isJobRunning): boolean {
  let changed = false
  for (const m of meetings ?? []) {
    if (m?.serverJob?.state === ServerJobState.Running && !runningNow(m.id)) {
      m.serverJob = { ...m.serverJob, state: ServerJobState.MaybeCharged }
      changed = true
    }
  }
  return changed
}

/**
 * Can this meeting's recording be sent to the server (again)? Never while a
 * call is out, never once done, and never over a transcript it already has
 * (a live one, or one another phone sent): a job only ever adds lines.
 */
export function canStartJob(m: PastMeeting): boolean {
  if (isJobRunning(m.id) || m.serverJob?.state === ServerJobState.Running || m.serverJob?.state === ServerJobState.Done) return false
  return (m.serverJob?.takesDone ?? 0) > 0 || !Array.isArray(m.transcript) || m.transcript.length === 0
}

function codeOf(e: unknown): SwissError {
  return e instanceof SwissServerError ? e.code : SwissError.Network
}

/** Lost answers (timeout, dropped connection): may be charged. Everything else the server refused: not charged. */
function stateFor(code: SwissError): ServerJobState {
  return code === SwissError.Timeout || code === SwissError.Network ? ServerJobState.MaybeCharged : ServerJobState.Failed
}

async function callOnce(a: HostedAccount, take: JobTake, deps: JobDeps): Promise<TranscribeResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS)
  try {
    return await deps.transcribe(a, take.blob, declaredSeconds(take.durationMs), take.mimeType, ctl.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** One take, waiting out "busy" a few times (nothing is charged on a 429 busy). */
async function transcribeTake(a: HostedAccount, take: JobTake, deps: JobDeps): Promise<TranscribeResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(a, take, deps)
    } catch (e) {
      if (!(e instanceof SwissServerError) || e.code !== SwissError.Busy || attempt >= BUSY_RETRIES) throw e
      await deps.sleep(Math.min(BUSY_WAIT_MAX_S, e.retryAfterS ?? BUSY_WAIT_DEFAULT_S) * 1000)
    }
  }
}

function setJob(m: PastMeeting, job: ServerJob, deps: JobDeps): void {
  m.serverJob = job
  deps.save()
}

/**
 * Transcribes the takes of `m` not done yet, appending their lines to its
 * transcript. The meeting is marked running and saved BEFORE anything is
 * awaited (so a pack sent right after says "still arriving"); `loadTakes`
 * then supplies the audio (the takes in hand, or those kept on this phone).
 * Returns the final state (also saved on the meeting).
 */
export async function runServerJob(m: PastMeeting, loadTakes: () => Promise<readonly JobTake[] | null>, deps: JobDeps): Promise<ServerJobState> {
  if (!canStartJob(m)) return m.serverJob?.state ?? ServerJobState.Failed
  running.add(m.id)
  const done0 = m.serverJob?.takesDone ?? 0
  setJob(m, { state: ServerJobState.Running, at: deps.now(), takesDone: done0 }, deps)
  try {
    if (!Array.isArray(m.transcript)) m.transcript = []
    const takes = await loadTakes().catch(() => null)
    if (!takes?.length) {
      setJob(m, { state: ServerJobState.Failed, at: deps.now(), takesDone: done0, error: SwissError.NotFound }, deps)
      return ServerJobState.Failed
    }
    const start = Math.min(done0, takes.length)
    let a: HostedAccount
    try {
      a = await deps.account()
    } catch {
      setJob(m, { state: ServerJobState.Failed, at: deps.now(), takesDone: start, error: SwissError.Network }, deps)
      return ServerJobState.Failed
    }
    for (let i = start; i < takes.length; i++) {
      const take = takes[i]
      if (declaredSeconds(take.durationMs) > MAX_SECONDS_PER_CALL) {
        setJob(m, { state: ServerJobState.Failed, at: deps.now(), takesDone: i, error: SwissError.TooLarge }, deps)
        return ServerJobState.Failed
      }
      setJob(m, { state: ServerJobState.Running, at: deps.now(), takesDone: i }, deps)
      try {
        const r = await transcribeTake(a, take, deps)
        m.transcript = [...m.transcript, ...linesFromResult(take.offsetMs, r)]
      } catch (e) {
        const code = codeOf(e)
        setJob(m, { state: stateFor(code), at: deps.now(), takesDone: i, error: code }, deps)
        return stateFor(code)
      }
    }
    setJob(m, { state: ServerJobState.Done, at: deps.now(), takesDone: takes.length }, deps)
    return ServerJobState.Done
  } finally {
    running.delete(m.id)
  }
}
