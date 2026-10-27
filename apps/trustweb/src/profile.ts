/**
 * My TrustWeb profile (wave 7, Jakob 2026-10-14: "which should have special explicit agreements besides norms that you share
 * implicitly like 'first text, don't call' ... and what people share on their trustweb profile"). What I share by default is what I
 * can OFFER (my My Resources lines, shown read-only) plus how to reach me: contact norms, my favourite way to connect, one line of
 * intro. Every entry is dated and marked "by me" or "by AI" (AI is a placeholder flag only: nothing writes it yet); an entry is
 * stale after 90 days.
 *
 * Wire (like contact_share.ts): ONE short text inside the encrypted chat envelope of a paired peer, only after the owner ticked
 * "share my profile" (never in the clear connect-ack, never relayed, I1/I8):
 *     <app url>?profile=1#p=<JSON: {n:[[norm,text]],f,i,p,at}>
 * The picture (wave 19, a small JPEG data URL) is too long for that text: it travels beside it in the same envelope (ChatEnvelope.pic)
 * and `p:1` says one comes along. Older builds ignore the field; a build that does not know `p` still parses the rest.
 * Everything received is untrusted: bounded, stripped of control and bidi characters, unknown norms dropped. A build that does not
 * know the text shows it as one chat line, as with hello.ts. Pure and DOM-free.
 */
import { Ring, ringSlot } from './model'
import type { Person } from './model'
import { stripUnsafe } from './safe_text'
import { isJpegDataUrl } from '../../demo/src/types'

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
/**
 * Wave 19 (Jakob 2026-10-23: "which sections to share with whom"): a ring and every ring closer to me, or nobody. Messenger links are
 * not part of the profile (they leave only as the answer to an explicit request, contact_request.ts), so they have no audience here.
 */
export type ProfileAudience = 'close' | 'friend' | 'acquaintance' | 'public' | 'nobody'
export const PROFILE_AUDIENCES: readonly ProfileAudience[] = ['close', 'friend', 'acquaintance', 'public', 'nobody']
/** Wave 20: the one-line sections besides favourite and intro (`website`, `offers` = what I offer, paid, `working` = what I work on and seek investment for, `address`). */
export type OneKey = 'favourite' | 'intro' | 'website' | 'offers' | 'working' | 'address'
export const ONE_MAX: Record<OneKey, number> = { favourite: TEXT_MAX, intro: INTRO_MAX, website: 60, offers: INTRO_MAX, working: INTRO_MAX, address: 60 }
export type ProfileSection = 'norms' | 'picture' | OneKey
export const PROFILE_SECTIONS: readonly ProfileSection[] = ['norms', 'favourite', 'intro', 'picture', 'website', 'offers', 'working', 'address']
/** Before wave 19 a tap sent the whole profile to anyone connected: acquaintances and closer keep seeing every section by default. */
export const DEFAULT_AUDIENCE: ProfileAudience = 'acquaintance'
/** Wave 20: website, offers and working default to the public profile (anyone who reaches me through my public address), the address to friends. */
const SECTION_DEFAULT: Partial<Record<ProfileSection, ProfileAudience>> = { website: 'public', offers: 'public', working: 'public', address: 'friend', picture: 'friend' }
/** Who might reach me with my picture (Jakob 2026-10-23): friends and closer unless changed. */
export const DEFAULT_PICTURE_AUDIENCE: ProfileAudience = 'friend'
/** `pictureId`: the picture in image_store.ts (this phone only), `pictureAt` when it was set. */
export interface MyProfile { norms: NormEntry[]; favourite?: Dated; intro?: Dated; website?: Dated; offers?: Dated; working?: Dated; address?: Dated; pictureId?: string; pictureAt?: number; audience?: Partial<Record<ProfileSection, ProfileAudience>> }
/** What travels and what a connected person's card keeps: no per-entry dates, one date for the set. */
export interface SharedProfile { norms: Array<{ norm: Norm; text: string }>; favourite?: string; intro?: string; website?: string; offers?: string; working?: string; address?: string; picture?: string; at: number }

const ONE_KEYS = Object.keys(ONE_MAX) as OneKey[]

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

/** Sets or clears (empty text) a one-line section. */
export function setOne(p: MyProfile, key: OneKey, text: string, now: number): void {
  const t = clean(text, ONE_MAX[key])
  if (t) p[key] = { text: t, at: now, by: 'me' }
  else delete p[key]
}

/** What would be shared, or null for an empty profile. Dated by the newest entry. `picture`: the share-size data URL of my picture, when it may go. */
export function toShared(p: MyProfile | undefined, picture?: string): SharedProfile | null {
  if (!p) return null
  const all = [...p.norms.map((n) => n.at), ...ONE_KEYS.flatMap((k) => (p[k] ? [p[k]!.at] : [])), ...(picture ? [p.pictureAt ?? 0] : [])]
  if (!all.length) return null
  return {
    norms: p.norms.map((n) => ({ norm: n.norm, text: n.text })), ...Object.fromEntries(ONE_KEYS.flatMap((k) => (p[k] ? [[k, p[k]!.text]] : []))), picture,
    at: Math.max(...all),
  }
}

/**
 * Wave 20 (Jakob 2026-10-23, Tana hBIzFBewt1RL): the trust zones, most intimate wins: close > friend > acquaintance > intending/public.
 * An audience reaches its zone and every closer one; `public` (people who reached me through trustweb.one/<name>, who land on
 * Intending) and `intending` share the lowest reach. Unsorted and None have no zone: they get nothing.
 */
export type Zone = 'close' | 'friend' | 'acquaintance' | 'intending' | 'public'
const REACH: Record<Exclude<ProfileAudience, 'nobody'> | Zone, number> = { close: 3, friend: 2, acquaintance: 1, intending: 0, public: 0 }
const isAudience = (v: unknown): v is ProfileAudience => PROFILE_AUDIENCES.includes(v as ProfileAudience)
export const audienceOf = (p: MyProfile, section: ProfileSection): ProfileAudience => p.audience?.[section] ?? SECTION_DEFAULT[section] ?? DEFAULT_AUDIENCE

/** A person's zone: Family counts as the ring of its closeness (ringSlot); Intending who reached me through my public address is `public`. */
export function zoneOf(who: Pick<Person, 'ring'> & Partial<Pick<Person, 'fields' | 'reachedOut'>>): Zone | null {
  const r = ringSlot({ ring: who.ring, fields: who.fields })
  if (r === Ring.Intending) return who.reachedOut === 'received' ? 'public' : 'intending'
  return r === Ring.Close || r === Ring.Friend || r === Ring.Acquaintance ? r : null
}

/** What a zone may see of my profile, or null for nothing. `picture`: my share-size picture as a data URL (image_store.ts), sent only where its audience admits. */
export function sliceFor(my: MyProfile | undefined, zone: Zone | null, picture?: string): SharedProfile | null {
  if (!my || !zone) return null
  const open = (k: ProfileSection): boolean => { const a = audienceOf(my, k); return a !== 'nobody' && REACH[zone] >= REACH[a] }
  return toShared({ ...Object.fromEntries(ONE_KEYS.filter(open).map((k) => [k, my[k]])), norms: open('norms') ? my.norms : [], pictureAt: my.pictureAt }, open('picture') ? picture : undefined)
}

export const profileFor = (my: MyProfile | undefined, who: Parameters<typeof zoneOf>[0], picture?: string): SharedProfile | null => sliceFor(my, zoneOf(who), picture)

/** The reach to record when the slice of `zone` should go out automatically now: the first time, or when the person moved to a closer zone than any sent before; null otherwise (never on moving outward, nothing is recalled). */
export const autoSendRank = (sent: number | undefined, zone: Zone): number | null => (sent === undefined || REACH[zone] > sent ? REACH[zone] : null)

/** The short key of each one-line section on the wire. */
const WIRE: Record<OneKey, string> = { favourite: 'f', intro: 'i', website: 'w', offers: 'o', working: 'k', address: 'a' }
export function profileText(appUrl: string, s: SharedProfile): string {
  const body = { n: s.norms.map((n) => [n.norm, n.text]), ...Object.fromEntries(ONE_KEYS.flatMap((k) => (s[k] ? [[WIRE[k], s[k]]] : []))), ...(s.picture ? { p: 1 } : {}), at: s.at }
  return `${appUrl}?${PROFILE_PARAM}=1#p=${encodeURIComponent(JSON.stringify(body))}`
}

/** Dropped in this order when the text is too long for one message (what a stranger most needs stays longest). */
const DROP_ORDER: readonly OneKey[] = ['intro', 'favourite', 'address', 'working', 'offers', 'website']

/** The text to send (to `who`, a person or a zone, when given: only what they may see), or null for an empty profile; drops the one-line sections in DROP_ORDER, then the last norms until it fits one message. */
export function buildProfileText(appUrl: string, p: MyProfile | undefined, who?: Parameters<typeof zoneOf>[0] | Zone, picture?: string): string | null {
  const s = who ? (typeof who === 'string' ? sliceFor(p, who, picture) : profileFor(p, who, picture)) : toShared(p, picture)
  if (!s) return null
  for (;;) {
    const text = profileText(appUrl, s)
    if (text.length <= PROFILE_TEXT_MAX) return text
    const k = DROP_ORDER.find((key) => s[key])
    if (k) delete s[k]
    else if (s.norms.length) s.norms.pop()
    else return null
  }
}

export const isProfileText = (appUrl: string, text: string): boolean => typeof text === 'string' && text.startsWith(`${appUrl}?${PROFILE_PARAM}=1#`)

/** The untrusted-input boundary: null for anything that is not a usable profile. `pic`: the picture beside the text, kept only as a small JPEG data URL. `p:1` alone parses (the picture may still arrive); receiveProfileText rejects the empty card. Never throws. */
export function parseProfileText(appUrl: string, text: string, now: number, pic?: string): SharedProfile | null {
  const prefix = `${appUrl}?${PROFILE_PARAM}=1#p=`
  if (typeof text !== 'string' || !text.startsWith(prefix) || text.length > PROFILE_TEXT_MAX + 20) return null
  try {
    const o = JSON.parse(decodeURIComponent(text.slice(prefix.length))) as Record<string, unknown>
    const norms = (Array.isArray(o.n) ? o.n : []).slice(0, NORMS_MAX).flatMap((e): SharedProfile['norms'] => {
      const [norm, t] = Array.isArray(e) ? e : []
      const text2 = clean(t, TEXT_MAX)
      return isNorm(norm) && (norm !== Norm.Custom || text2) ? [{ norm, text: text2 }] : []
    })
    const ones = Object.fromEntries(ONE_KEYS.flatMap((k) => { const t = clean(o[WIRE[k]], ONE_MAX[k]); return t ? [[k, t]] : [] }))
    const picture = isJpegDataUrl(pic) ? pic : undefined
    if (!norms.length && !Object.keys(ones).length && !picture && o.p !== 1) return null
    const at = typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0 ? Math.min(o.at, now) : now
    return { norms, ...ones, ...(picture ? { picture } : {}), at }
  } catch {
    return null
  }
}

export interface ProfileCarrier { theirProfile?: SharedProfile }

/** Stores a received profile on a person. True when the card changed (idempotent). */
export function receiveProfileText(appUrl: string, person: ProfileCarrier, text: string, now: number, pic?: string): boolean {
  const next = parseProfileText(appUrl, text, now, pic)
  if (!next || (!next.norms.length && !ONE_KEYS.some((k) => next[k]) && !next.picture) || JSON.stringify(person.theirProfile) === JSON.stringify(next)) return false
  person.theirProfile = next
  return true
}

/** Boot repair: a stored profile that is not the expected shape is dropped. True when the state changed. Never throws. */
export function repairProfile(state: { profile?: unknown }): boolean {
  const p = state.profile as Partial<MyProfile> | undefined
  if (p === undefined) return false
  const ok = typeof p === 'object' && p !== null && Array.isArray(p.norms) && p.norms.every((n) => n && isNorm(n.norm) && typeof n.text === 'string' && typeof n.at === 'number')
    && ONE_KEYS.map((k) => p[k]).every((d) => d === undefined || (typeof d.text === 'string' && typeof d.at === 'number'))
  if (!ok) { delete state.profile; return true }
  // A bad picture id or an unknown audience goes on its own (the section falls back to the default); the profile stays.
  let changed = false
  if (p.pictureId !== undefined && typeof p.pictureId !== 'string') { delete p.pictureId; delete p.pictureAt; changed = true }
  const a: unknown = p.audience
  if (a === undefined) return changed
  const entries = typeof a === 'object' && a !== null ? Object.entries(a) : []
  const kept = entries.filter(([k, v]) => PROFILE_SECTIONS.includes(k as ProfileSection) && isAudience(v))
  if (entries.length && kept.length === entries.length) return changed
  if (kept.length) p.audience = Object.fromEntries(kept)
  else delete p.audience
  return true
}
