/**
 * Server-side transcription on screen (wave 1733 round B, items 3 and 5): the
 * one-time consent, starting a job for a stored meeting, what a past meeting
 * says about its job and about the packs sent before its transcript was done,
 * and what happens at app open (a cut-off job reads "may still be charged";
 * early packs whose transcript is done go out now).
 *
 * The rules live in server_transcription.ts (the job) and late_pack.ts (the
 * packs); this file is the glue with thin hooks into main.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { aboutUrl, AboutPage } from './about'
import type { AudioStore } from './audio_store'
import { flushOutbox, transcriptStillComing } from './late_pack'
import type { SendDeps } from './late_pack'
import { TranscriberEngine } from './meeting_transcriber'
import { ServerJobState, TranscriptionChoice, transcriptionChoice } from './model'
import type { AppState, PastMeeting } from './model'
import { canStartJob, isJobRunning, runServerJob, settleInterruptedJobs } from './server_transcription'
import type { JobTake } from './server_transcription'
import { S } from './strings'
import type { SwissContext } from './swiss_context'
import { SwissError, transcribe } from './swiss_server'

export interface TranscriptionViewHooks {
  ctx: SwissContext
  state: () => AppState
  save: () => void
  audio: AudioStore
  openSheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  /** A job changed a meeting (its transcript or its state): screens that show it redraw. */
  onJobChange: (m: PastMeeting) => void
  /** Puts a sealed pack under its key (backup.ts backupNow). */
  uploadPack: SendDeps['upload']
  /** The name the packs say they are from. */
  fromName: () => string
  when: (at: number) => string
}

export interface TranscriptionView {
  /** Does a finished recording go to the server now (the choice, the yes, and the server)? */
  willTranscribe(liveEngine: TranscriberEngine | null): boolean
  /** Settings chose "The Swiss server": not switched on there yet, so live engines stand in. */
  serverOff(): boolean
  /** The one-time yes; `then` runs after a yes (at once when it was given before). */
  askConsent(then: () => void): void
  /** Sends the meeting's recording to the server (the takes in hand, or those kept on this phone). */
  start(m: PastMeeting, takes?: readonly JobTake[]): void
  /** The lines a past meeting shows about its job and its early packs. */
  meetingExtras(m: PastMeeting): (Node | null)[]
  /** Settings > Recording: a line saying whether the server's transcription is switched on. */
  settingsNote(): HTMLElement | null
  /** The yes was given (audio may go to the Swiss server, also under "Automatic"). */
  consented(): boolean
  /** Settings: take the yes back ("Automatic" then never uses the server; "The Swiss server" becomes "Automatic"). */
  withdrawButton(after: () => void): HTMLElement | null
  /** At app open: settle cut-off jobs, send the full packs that are due. */
  boot(): void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function createTranscriptionView(h: TranscriptionViewHooks): TranscriptionView {
  const consented = (): boolean => typeof h.state().serverTranscriptionConsentAt === 'number'

  function serverOn(): boolean {
    return h.ctx.enabled() && h.ctx.status()?.transcribe === true
  }

  /** The free transcription hours per person from the server's plan, or null when it did not say. */
  function freeHours(): number | null {
    const limit = h.ctx.status()?.plan?.transcription.secondsLimit ?? 0
    return limit > 0 ? Math.round((limit / 3600) * 10) / 10 : null
  }

  function willTranscribe(liveEngine: TranscriberEngine | null): boolean {
    if (!serverOn() || !consented()) return false
    const choice = transcriptionChoice(h.state())
    return choice === TranscriptionChoice.Server || (choice === TranscriptionChoice.Auto && liveEngine === TranscriberEngine.None)
  }

  function askConsent(then: () => void): void {
    if (consented()) { then(); return }
    h.openSheet([
      el('h3', {}, [S.consentTitle]),
      el('p', { class: 'meta', 'data-consent-body': '1' }, [S.consentBody(h.ctx.status()?.provider ?? null, freeHours())]),
      el('button', { class: 'btn btn-electric', 'data-consent': 'yes', onclick: () => { h.state().serverTranscriptionConsentAt = Date.now(); h.save(); h.closeSheet(); then() } }, [S.consentYes]),
      el('button', { class: 'btn btn-ghost', 'data-consent': 'no', onclick: h.closeSheet }, [S.consentNo]),
    ])
  }

  const sendDeps: SendDeps = { upload: (k, p) => h.uploadPack(k, p), sleep, now: Date.now, save: h.save }

  /** Early packs of this meeting whose transcript is now complete: their full version goes out. */
  async function flush(m: PastMeeting, finalise = false): Promise<void> {
    const sent = await flushOutbox(m, h.fromName(), sendDeps, finalise)
    if (sent) h.onJobChange(m)
  }

  async function takesFor(m: PastMeeting, given?: readonly JobTake[]): Promise<readonly JobTake[] | null> {
    if (given?.length) return given
    const kept = await h.audio.load(m.id)
    return kept?.takes.length ? kept.takes : null
  }

  function start(m: PastMeeting, given?: readonly JobTake[]): void {
    if (!canStartJob(m)) return
    const release = holdScreen()
    const job = runServerJob(m, () => takesFor(m, given), { account: h.ctx.account, transcribe, save: h.save, sleep, now: Date.now })
    // runServerJob marked the meeting running before its first await: show it at once.
    h.onJobChange(m)
    void job.then(async (state) => {
      release()
      h.onJobChange(m)
      if (state === ServerJobState.Done) await flush(m)
    })
  }

  /**
   * The answer of a call that is out is lost when the phone locks or the app
   * closes (and may still be charged), so the screen stays on while one runs,
   * taken again when the page comes back; the copy asks to keep TrustWeb open.
   */
  function holdScreen(): () => void {
    let lock: WakeLockSentinel | null = null
    let held = true
    const take = (): void => { void navigator.wakeLock?.request('screen').then((l) => { if (held) lock = l; else void l.release() }).catch(() => {}) }
    const onVisible = (): void => { if (document.visibilityState === 'visible' && held) take() }
    take()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      held = false
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
      lock = null
    }
  }

  function failureText(code: string | undefined): string {
    switch (code) {
      case SwissError.NotConfigured: return S.jobNotConfigured
      case SwissError.AllowanceReached: return S.jobAllowance
      case SwissError.Busy: return S.jobBusy
      case SwissError.BusyToday: return S.jobBusyToday
      case SwissError.RateLimited: return S.jobRateLimited
      case SwissError.TooLarge: return S.jobTooLong
      case SwissError.Unsupported: return S.jobUnsupported
      case SwissError.NotFound: return S.jobNoAudio
      default: return S.jobFailed
    }
  }

  function jobLines(m: PastMeeting): (Node | null)[] {
    const job = m.serverJob
    const runningHere = isJobRunning(m.id) || job?.state === ServerJobState.Running
    const tryButton = (label: string, warn?: string): HTMLElement => el('button', {
      class: 'btn btn-ghost btn-sm', 'data-job-start': m.id,
      onclick: () => { if (warn && !confirm(warn)) return; askConsent(() => start(m)) },
    }, [label])
    if (runningHere) return [el('p', { class: 'meta job-state', 'data-job': 'running' }, [S.jobRunning])]
    if (!job) {
      // Offered where the server transcribes, this meeting has no transcript yet, and its audio is kept here.
      return serverOn() && !m.transcript.length && !m.fromName ? [tryButton(S.jobStart)] : []
    }
    switch (job.state) {
      case ServerJobState.Done: return [el('p', { class: 'meta job-state', 'data-job': 'done' }, [m.roughTimes === true ? S.jobDoneRough : S.jobDone])]
      case ServerJobState.MaybeCharged:
        return [el('p', { class: 'warn job-state', 'data-job': 'maybe-charged' }, [S.jobMaybeCharged]), serverOn() ? tryButton(S.jobTryAgain, S.jobTryAgainCharged) : null]
      case ServerJobState.Failed:
        return [
          el('p', { class: 'warn job-state', 'data-job': 'failed', 'data-job-error': job.error ?? '' }, [failureText(job.error)]),
          job.error === SwissError.AllowanceReached ? el('a', { class: 'btn btn-ghost btn-sm', href: aboutUrl(AboutPage.Feedback), target: '_blank', rel: 'noopener noreferrer' }, [S.fairPrice]) : null,
          serverOn() && job.error !== SwissError.AllowanceReached && job.error !== SwissError.TooLarge ? tryButton(S.jobTryAgain) : null,
        ]
      case ServerJobState.Running: return []
    }
  }

  function outboxLines(m: PastMeeting): (Node | null)[] {
    const waiting = m.outbox?.length ?? 0
    const out: (Node | null)[] = []
    if (waiting) {
      out.push(el('p', { class: 'meta', 'data-outbox': String(waiting) }, [transcriptStillComing(m) ? S.outboxWaiting(waiting) : S.outboxDue(waiting)]))
      if (!transcriptStillComing(m)) {
        out.push(el('button', {
          class: 'btn btn-ghost btn-sm', 'data-outbox-send': '1',
          onclick: () => void flush(m, true).then(() => h.toast(m.outbox?.length ? S.outboxNotYet : S.outboxFinalised)),
        }, [m.serverJob?.state === ServerJobState.Done ? S.outboxSendNow : S.outboxSendAsIs]))
      }
    }
    if (m.fullSentAt && !waiting) out.push(el('p', { class: 'meta', 'data-full-sent': '1' }, [S.fullSent(h.when(m.fullSentAt))]))
    return out
  }

  function withdrawButton(after: () => void): HTMLElement | null {
    if (!consented()) return null
    return el('button', {
      class: 'btn btn-ghost btn-sm', 'data-consent-withdraw': '1',
      onclick: () => {
        const s = h.state()
        delete s.serverTranscriptionConsentAt
        if (transcriptionChoice(s) === TranscriptionChoice.Server) s.transcription = TranscriptionChoice.Auto
        h.save()
        h.toast(S.consentWithdrawn)
        after()
      },
    }, [S.consentWithdraw])
  }

  function settingsNote(): HTMLElement | null {
    if (!h.ctx.enabled()) return null
    const st = h.ctx.status()
    if (st === undefined) return null
    const text = st === null ? S.setServerUnknown : st.transcribe ? (consented() ? S.setServerOnYes : S.setServerOn) : S.setServerOff
    return el('p', { class: 'meta', 'data-server-transcribe': st?.transcribe ? 'on' : 'off' }, [text])
  }

  function boot(): void {
    const s = h.state()
    if (settleInterruptedJobs(s.meetings)) h.save()
    for (const m of s.meetings ?? []) {
      if (m?.outbox?.length && !transcriptStillComing(m) && m.serverJob?.state === ServerJobState.Done) void flush(m)
    }
  }

  return {
    willTranscribe,
    serverOff: () => h.ctx.enabled() && transcriptionChoice(h.state()) === TranscriptionChoice.Server && h.ctx.status()?.transcribe !== true,
    askConsent,
    start,
    meetingExtras: (m) => [...jobLines(m), ...outboxLines(m)],
    settingsNote,
    consented,
    withdrawButton,
    boot,
  }
}
