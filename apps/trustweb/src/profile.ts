/**
 * My TrustWeb profile (wave 7, Jakob 2026-10-14: "which should have special explicit agreements besides norms that you share
 * implicitly like 'first text, don't call' ... and what people share on their trustweb profile"). What I share by default is what I
 * can OFFER (my My Resources lines, shown read-only) plus how to reach me: contact norms, my favourite way to connect, one line of
 * intro. Every entry is dated and marked "by me" or "by AI" (AI is a placeholder flag only: nothing writes it yet); an entry is
 * stale after 90 days.
 *
 * Wire (like contact_share.ts): ONE short text inside the encrypted chat envelope of a paired peer, only after the owner ticked
 * "share my profile" (never in the clear connect-ack, never relayed, I1/I8):
 *     <app url>?profile=1#p=<JSON: {n:[[norm,text]],f,i,at}>
 * Everything received is untrusted: bounded, stripped of control and bidi characters, unknown norms dropped. A build that does not
 * know the text shows it as one chat line, as with hello.ts. Pure and DOM-free.
 */
import { fingerprint, stripUnsafe } from './safe_text'

export enum Norm {
  TextFirst = 'text-first',
  CallMe = 'call-me',
  NoLate = 'no-late',
  VoiceNotes = 'voice-notes',
  Custom = 'custom',
}
export const NORMS: readonly Norm[] = [Norm.TextFirst, Norm.CallMe, Norm.NoLate, Norm.VoiceNotes, Norm.Custom]

export type Author = 'me' | 'ai'
export const STALE_AFTER_MS = 90 * 24 * 3600 * 1000
export const PROFILE_PARAM = 'profile'
const TEXT_MAX = 40
const INTRO_MAX = 100
const NORMS_MAX = 5
const PROFILE_TEXT_MAX = 480

export interface Dated { text: string; at: number; by: Author }
/** A norm; `text` is the free text (the whole norm for Custom, an optional note on a pick). */
export interface NormEntry extends Dated { norm: Norm }
export interface MyProfile { norms: NormEntry[]; favourite?: Dated; intro?: Dated }
/** What travels and what a connected person's card keeps: no per-entry dates, one date for the set. */
export interface SharedProfile { norms: Array<{ norm: Norm; text: string }>; favourite?: string; intro?: string; at: number }

export const isNorm = (v: unknown): v is Norm => NORMS.includes(v as Norm)
export const isStale = (at: number, now: number): boolean => now - at > STALE_AFTER_MS
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? [...stripUnsafe(v).replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '')

/** Adds a norm; false when it adds nothing (duplicate, empty custom, or the limit). */
export function addNorm(p: MyProfile, norm: Norm, text: string, now: number): boolean {
  const t = clean(text, TEXT_MAX)
  if (!isNorm(norm) || (norm === Norm.Custom && !t) || p.norms.length >= NORMS_MAX) return false
  if (p.norms.some((n) => n.norm === norm && n.text === t)) return false
  p.norms.push({ norm, text: t, at: now, by: 'me' })
  return true
}

export function removeNorm(p: MyProfile, index: number): void {
  p.norms.splice(index, 1)
}

/** Sets or clears (empty text) the favourite way or the intro. */
export function setOne(p: MyProfile, key: 'favourite' | 'intro', text: string, now: number): void {
  const t = clean(text, key === 'intro' ? INTRO_MAX : TEXT_MAX)
  if (t) p[key] = { text: t, at: now, by: 'me' }
  else delete p[key]
}

/** What would be shared, or null for an empty profile. Dated by the newest entry. */
export function toShared(p: MyProfile | undefined): SharedProfile | null {
  if (!p) return null
  const all: Dated[] = [...p.norms, ...(p.favourite ? [p.favourite] : []), ...(p.intro ? [p.intro] : [])]
  if (!all.length) return null
  return {
    norms: p.norms.map((n) => ({ norm: n.norm, text: n.text })), favourite: p.favourite?.text, intro: p.intro?.text,
    at: Math.max(...all.map((d) => d.at)),
  }
}

export function profileText(appUrl: string, s: SharedProfile): string {
  const body = { n: s.norms.map((n) => [n.norm, n.text]), ...(s.favourite ? { f: s.favourite } : {}), ...(s.intro ? { i: s.intro } : {}), at: s.at }
  return `${appUrl}?${PROFILE_PARAM}=1#p=${encodeURIComponent(JSON.stringify(body))}`
}

/** The text to send, or null for an empty profile; drops the intro, then the favourite way, then the last norms until it fits one message. */
export function buildProfileText(appUrl: string, p: MyProfile | undefined): string | null {
  const s = toShared(p)
  if (!s) return null
  for (;;) {
    const text = profileText(appUrl, s)
    if (text.length <= PROFILE_TEXT_MAX) return text
    if (s.intro) delete s.intro
    else if (s.favourite) delete s.favourite
    else if (s.norms.length) s.norms.pop()
    else return null
  }
}

export const isProfileText = (appUrl: string, text: string): boolean => typeof text === 'string' && text.startsWith(`${appUrl}?${PROFILE_PARAM}=1#`)

/** The untrusted-input boundary: null for anything that is not a usable profile. Never throws. */
export function parseProfileText(appUrl: string, text: string, now: number): SharedProfile | null {
  const prefix = `${appUrl}?${PROFILE_PARAM}=1#p=`
  if (typeof text !== 'string' || !text.startsWith(prefix) || text.length > PROFILE_TEXT_MAX + 20) return null
  try {
    const o = JSON.parse(decodeURIComponent(text.slice(prefix.length))) as Record<string, unknown>
    const norms = (Array.isArray(o.n) ? o.n : []).slice(0, NORMS_MAX).flatMap((e): SharedProfile['norms'] => {
      const [norm, t] = Array.isArray(e) ? e : []
      const text2 = clean(t, TEXT_MAX)
      return isNorm(norm) && (norm !== Norm.Custom || text2) ? [{ norm, text: text2 }] : []
    })
    const favourite = clean(o.f, TEXT_MAX) || undefined
    const intro = clean(o.i, INTRO_MAX) || undefined
    if (!norms.length && !favourite && !intro) return null
    const at = typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0 ? Math.min(o.at, now) : now
    return { norms, favourite, intro, at }
  } catch {
    return null
  }
}

export interface ProfileCarrier { theirProfile?: SharedProfile }

/** Stores a received profile on a person. True when the card changed (idempotent). */
export function receiveProfileText(appUrl: string, person: ProfileCarrier, text: string, now: number): boolean {
  const next = parseProfileText(appUrl, text, now)
  if (!next || JSON.stringify(person.theirProfile) === JSON.stringify(next)) return false
  person.theirProfile = next
  return true
}

export const profileFingerprint = (appUrl: string, p: MyProfile | undefined): string | null => {
  const t = buildProfileText(appUrl, p)
  return t === null ? null : fingerprint(t)
}

/** Boot repair: a stored profile that is not the expected shape is dropped. True when the state changed. Never throws. */
export function repairProfile(state: { profile?: unknown }): boolean {
  const p = state.profile as Partial<MyProfile> | undefined
  if (p === undefined) return false
  const ok = typeof p === 'object' && p !== null && Array.isArray(p.norms) && p.norms.every((n) => n && isNorm(n.norm) && typeof n.text === 'string' && typeof n.at === 'number')
    && [p.favourite, p.intro].every((d) => d === undefined || (typeof d.text === 'string' && typeof d.at === 'number'))
  if (ok) return false
  delete state.profile
  return true
}
