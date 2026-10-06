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

export function recFor(h: HostingState, meetingId: string): HostedRec | null {
  return h.recs.find((r) => r.meetingId === meetingId) ?? null
}

/** Kept on this phone, of a meeting still here, not on the server yet: newest first. */
export function toHost(h: HostingState, kept: readonly AudioEntry[], meetings: readonly PastMeeting[]): string[] {
  const here = new Set(meetings.map((m) => m.id))
  return [...kept].sort((a, b) => b.savedAt - a.savedAt).map((e) => e.id).filter((id) => here.has(id) && !recFor(h, id))
}

/** Every recording this phone knows of: kept here, hosted, or both. */
export function hostingRows(h: HostingState, kept: readonly AudioEntry[], meetings: readonly PastMeeting[]): HostingRow[] {
  const here = new Set(meetings.map((m) => m.id))
  const onPhone = new Set(kept.map((e) => e.id))
  const ids = [...new Set([...kept.map((e) => e.id), ...h.recs.map((r) => r.meetingId)])]
  const order = new Map(meetings.map((m, i) => [m.id, i]))
  return ids
    .map((id) => ({ meetingId: id, onPhone: onPhone.has(id), rec: recFor(h, id), meetingHere: here.has(id) }))
    .sort((a, b) => (order.get(a.meetingId) ?? 1e9) - (order.get(b.meetingId) ?? 1e9))
}

/**
 * The server's own list is the truth: a recording the phone thinks is hosted
 * but the server no longer has (removed after 90 days untouched, or from
 * another phone) is forgotten here. Returns whether anything changed.
 */
export function reconcile(h: HostingState, server: readonly HostedRecordingInfo[]): boolean {
  const there = new Set(server.map((r) => r.id))
  const before = h.recs.length
  h.recs = h.recs.filter((r) => there.has(r.rid))
  return h.recs.length !== before
}

const totalMs = (takes: readonly StoredTake[]): number => takes.reduce((n, t) => Math.max(n, t.offsetMs + t.durationMs), 0)

/** Meetings being uploaded right now: a second call for the same one never stores (and charges) it twice. */
const uploading = new Set<string>()

/** Seals and stores one kept recording under the hosted account. */
export async function hostOne(meetingId: string, deps: HostingDeps): Promise<HostOutcome> {
  const h = deps.hosting()
  if (recFor(h, meetingId) || uploading.has(meetingId)) return HostOutcome.Already
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
  try {
    const a = await deps.account()
    const rid = newRecordingId()
    const sealed = await sealRecording(a.encKey, rid, audio.takes)
    await deps.put(a, rid, seconds, sealed)
    h.recs.push({ meetingId, rid, seconds, bytes: sealed.size, at: deps.now() })
    deps.save()
    return HostOutcome.Hosted
  } catch (e) {
    if (e instanceof SwissServerError && e.code === SwissError.AllowanceReached) return HostOutcome.Allowance
    if (e instanceof SwissServerError && e.code === SwissError.TooLarge) return HostOutcome.TooLong
    return HostOutcome.Failed
  }
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
