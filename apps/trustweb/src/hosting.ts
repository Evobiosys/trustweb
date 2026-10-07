/**
 * Recordings hosted on the Swiss server (wave 1733 round B, item 4; contract
 * I4, amendment A5): the audio this phone keeps (audio_store.ts) can also be
 * stored, sealed on the phone (hosted_recording.ts), under the person's hosted
 * account, within the free allowance (10 hours in all, 1 hour per recording).
 * Nothing on the phone is ever removed for it, and at the allowance the
 * recording simply stays on this phone only.
 *
 * Restore: the record (and so the backup) carries the hosted account's secret
 * and the list of what is hosted, so a restored phone can fetch every hosted
 * recording back; recordings that were only on the old phone are not covered.
 *
 * DOM-free: the unit tests drive it with fakes.
 */
import type { StoredAudio, StoredTake } from './audio_store'
import type { AudioEntry } from './audio_plan'
import { openRecording, sealRecording } from './hosted_recording'
import type { HostedRec, HostingState, PastMeeting } from './model'
import { declaredSeconds, MAX_SECONDS_PER_CALL, newRecordingId, SwissError, SwissServerError } from './swiss_server'
import type { HostedAccount, HostedRecordingInfo, Usage } from './swiss_server'

/** What hosting one recording came to. A fixed set. */
export enum HostOutcome {
  Hosted = 'hosted',
  /** Already on the server. */
  Already = 'already',
  /** The free allowance is used up (402): it stays on this phone only. */
  Allowance = 'allowance',
  /** Longer than an hour: the server takes at most one hour per recording. */
  TooLong = 'too-long',
  /** No audio kept for it on this phone (dropped by the caps, or never recorded). */
  NoAudio = 'no-audio',
  Failed = 'failed',
}

export interface HostingDeps {
  account: () => Promise<HostedAccount>
  hosting: () => HostingState
  loadAudio: (meetingId: string) => Promise<StoredAudio | null>
  saveAudio: (meetingId: string, takes: readonly StoredTake[]) => Promise<void>
  put: (a: HostedAccount, rid: string, seconds: number, sealed: Blob) => Promise<number | null>
  get: (a: HostedAccount, rid: string) => Promise<ArrayBuffer>
  remove: (a: HostedAccount, rid: string) => Promise<void>
  save: () => void
  now: () => number
}

/** One recording as the hosting sheet lists it. */
export interface HostingRow {
  meetingId: string
  /** Kept on this phone (audio_store.ts). */
  onPhone: boolean
  /** Stored on the Swiss server. */
  rec: HostedRec | null
  /** The meeting is still in this phone's record. */
  meetingHere: boolean
}

/** "3.25 of 10": hours used and the allowance in hours, from the usage body (never hard-coded). */
export function hoursOf(u: Pick<Usage, 'secondsUsed' | 'secondsLimit'>): { used: number; limit: number } {
  return { used: Math.round((u.secondsUsed / 3600) * 100) / 100, limit: Math.round((u.secondsLimit / 3600) * 100) / 100 }
}

/**
 * The allowance in recordings AND hours (Jakob, wave 2, P10: count recordings,
 * not gigabytes): recordings kept there of the "10 recordings of up to 1 hour"
 * the plan allows, and hours used. The server still counts seconds and bytes;
 * everything comes from its numbers.
 */
export function allowanceOf(u: Pick<Usage, 'secondsUsed' | 'secondsLimit' | 'recordings' | 'maxSecondsPerRecording'> & Partial<Pick<Usage, 'maxRecordings'>>): { recordings: number; recordingsLimit: number; hoursUsed: number; hoursLimit: number } {
  const { used, limit } = hoursOf(u)
  const perRecording = u.maxSecondsPerRecording > 0 ? u.maxSecondsPerRecording : 3600
  // The count the server enforces (contract v1.5: maxRecordings = limit); only a server that does not say gets the derived one.
  const recordingsLimit = typeof u.maxRecordings === 'number' && u.maxRecordings > 0 ? Math.floor(u.maxRecordings) : Math.round(u.secondsLimit / perRecording)
  return { recordings: Math.max(0, Math.floor(u.recordings)), recordingsLimit, hoursUsed: used, hoursLimit: limit }
}

/** Is the free allowance used up, by count (the allowance since wave 2) or by hours (the guard beside it)? */
export function allowanceReached(u: Pick<Usage, 'secondsUsed' | 'secondsLimit' | 'recordings' | 'maxSecondsPerRecording'> & Partial<Pick<Usage, 'maxRecordings'>>): boolean {
  const a = allowanceOf(u)
  return (a.recordingsLimit > 0 && a.recordings >= a.recordingsLimit) || (u.secondsLimit > 0 && u.secondsUsed >= u.secondsLimit)
}

export function recFor(h: HostingState, meetingId: string): HostedRec | null {
  return h.recs.find((r) => r.meetingId === meetingId) ?? null
}

/** Stored on the server for sure (not an upload whose answer never came). */
function storedRec(h: HostingState, meetingId: string): HostedRec | null {
  const r = recFor(h, meetingId)
  return r && !r.pending ? r : null
}

/** Kept on this phone, of a meeting still here, not stored on the server yet (or its answer was lost): newest first. */
export function toHost(h: HostingState, kept: readonly AudioEntry[], meetings: readonly PastMeeting[]): string[] {
  const here = new Set(meetings.map((m) => m.id))
  return [...kept].sort((a, b) => b.savedAt - a.savedAt).map((e) => e.id).filter((id) => here.has(id) && !storedRec(h, id))
}

/** Every recording this phone knows of: kept here, hosted, or both. */
export function hostingRows(h: HostingState, kept: readonly AudioEntry[], meetings: readonly PastMeeting[]): HostingRow[] {
  const here = new Set(meetings.map((m) => m.id))
  const onPhone = new Set(kept.map((e) => e.id))
  const ids = [...new Set([...kept.map((e) => e.id), ...h.recs.map((r) => r.meetingId)])]
  const order = new Map(meetings.map((m, i) => [m.id, i]))
  return ids
    .map((id) => ({ meetingId: id, onPhone: onPhone.has(id), rec: storedRec(h, id), meetingHere: here.has(id) }))
    .sort((a, b) => (order.get(a.meetingId) ?? 1e9) - (order.get(b.meetingId) ?? 1e9))
}

/**
 * The server's own list is the truth: a recording the phone thinks is hosted
 * but the server no longer has (removed after 90 days untouched, or from
 * another phone) is forgotten here; an upload whose answer was lost is stored
 * if the server lists it, and otherwise stays waiting to be sent again under
 * the same id. Returns whether anything changed.
 */
export function reconcile(h: HostingState, server: readonly HostedRecordingInfo[]): boolean {
  const there = new Set(server.map((r) => r.id))
  let changed = false
  for (const r of h.recs) {
    if (r.pending && there.has(r.rid)) { delete r.pending; changed = true }
  }
  const before = h.recs.length
  h.recs = h.recs.filter((r) => r.pending || there.has(r.rid))
  return changed || h.recs.length !== before
}

/** Recordings the server holds under this account that this phone knows nothing of (shown, so they can be removed). */
export function unknownOnServer(h: HostingState, server: readonly HostedRecordingInfo[]): string[] {
  const known = new Set(h.recs.map((r) => r.rid))
  return server.map((r) => r.id).filter((id) => !known.has(id))
}

const totalMs = (takes: readonly StoredTake[]): number => takes.reduce((n, t) => Math.max(n, t.offsetMs + t.durationMs), 0)

/** Meetings being uploaded right now: a second call for the same one never stores (and charges) it twice. */
const uploading = new Set<string>()

/** Seals and stores one kept recording under the hosted account. */
export async function hostOne(meetingId: string, deps: HostingDeps): Promise<HostOutcome> {
  const h = deps.hosting()
  if (storedRec(h, meetingId) || uploading.has(meetingId)) return HostOutcome.Already
  uploading.add(meetingId)
  try {
    return await upload(h, meetingId, deps)
  } finally {
    uploading.delete(meetingId)
  }
}

async function upload(h: HostingState, meetingId: string, deps: HostingDeps): Promise<HostOutcome> {
  const audio = await deps.loadAudio(meetingId)
  if (!audio?.takes.length) return HostOutcome.NoAudio
  const seconds = declaredSeconds(totalMs(audio.takes))
  if (seconds > MAX_SECONDS_PER_CALL) return HostOutcome.TooLong
  let rec: HostedRec | null = null
  try {
    const a = await deps.account()
    // An earlier upload whose answer was lost goes again under its own id (the server replaces, never stores twice).
    const earlier = recFor(h, meetingId)
    const rid = earlier?.pending ? earlier.rid : newRecordingId()
    const sealed = await sealRecording(a.encKey, rid, audio.takes)
    rec = earlier?.pending ? earlier : { meetingId, rid, seconds, bytes: sealed.size, at: deps.now(), pending: true }
    Object.assign(rec, { seconds, bytes: sealed.size, at: deps.now() })
    if (!earlier) h.recs.push(rec)
    // Saved BEFORE the upload: a lost answer (or a closed app) never leaves a copy on the server this phone does not know of.
    deps.save()
    await deps.put(a, rid, seconds, sealed)
    delete rec.pending
    deps.save()
    return HostOutcome.Hosted
  } catch (e) {
    if (rec && answeredNo(e)) {
      // The server answered and stored nothing: nothing waits under that id.
      const gone = rec
      h.recs = h.recs.filter((r) => r !== gone)
      deps.save()
    }
    if (e instanceof SwissServerError && e.code === SwissError.AllowanceReached) return HostOutcome.Allowance
    if (e instanceof SwissServerError && e.code === SwissError.TooLarge) return HostOutcome.TooLong
    return HostOutcome.Failed
  }
}

/** The server answered the upload with a refusal (so it stored nothing), as opposed to an answer lost on the way. */
function answeredNo(e: unknown): boolean {
  if (!(e instanceof SwissServerError)) return false
  return e.status >= 400 && e.status < 500 && e.code !== SwissError.Timeout
}

/**
 * Hosts what is waiting, one after the other, newest first; stops at the
 * allowance (nothing after it would fit either). Returns what happened.
 */
export async function hostAll(ids: readonly string[], deps: HostingDeps, progress: (done: number, total: number) => void = () => {}): Promise<{ hosted: number; stoppedBy: HostOutcome | null }> {
  let hosted = 0
  for (let i = 0; i < ids.length; i++) {
    const r = await hostOne(ids[i], deps)
    if (r === HostOutcome.Hosted) hosted++
    progress(i + 1, ids.length)
    if (r === HostOutcome.Allowance) return { hosted, stoppedBy: r }
  }
  return { hosted, stoppedBy: null }
}

/** Removes one recording from the server; the copy on this phone stays. */
export async function unhost(meetingId: string, deps: HostingDeps): Promise<boolean> {
  const h = deps.hosting()
  const rec = recFor(h, meetingId)
  if (!rec) return true
  try {
    await deps.remove(await deps.account(), rec.rid)
  } catch {
    return false
  }
  h.recs = h.recs.filter((r) => r !== rec)
  deps.save()
  return true
}

/** Fetches a hosted recording back onto this phone (a restored phone, or audio the caps dropped). */
export async function fetchBack(meetingId: string, deps: HostingDeps): Promise<boolean> {
  const rec = recFor(deps.hosting(), meetingId)
  if (!rec) return false
  try {
    const a = await deps.account()
    const takes = await openRecording(a.encKey, rec.rid, await deps.get(a, rec.rid))
    if (!takes.length) return false
    await deps.saveAudio(meetingId, takes)
    return true
  } catch {
    return false
  }
}
