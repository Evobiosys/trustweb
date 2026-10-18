/**
 * Wave 16, "I want to do X together, who wants to do it with me" (padel was the first X; Jakob 2026-10-18 16:04, voice memo): one sentence becomes a structured together request, and a
 * request becomes an ordinary ask (hops.ts reach) that the existing matcher answers against other people's availability items. The
 * request never carries a place on the wire beyond the area words the person chose (I1: where someone plays stays on their phone
 * until they answer yes).
 *
 * Two readers fill the SAME preset shape, so the cheapest model is enough and none is required:
 *   - readTogetherRequest(): a deterministic reader (English + German); works with no LLM at all.
 *   - acceptTogetherDraft(): checks whatever a local or hosted LLM returned for that shape; anything out of range is dropped, never
 *     trusted, and a draft that fails entirely falls back to the deterministic reader.
 * Pure and DOM-free.
 */
import { clipText, isRecord } from './kept_list'
import { HOP_CAP } from '../../demo/src/types'

export const TOGETHER_ACTIVITY_MAX = 40
export const TOGETHER_AREA_MAX = 80
export const TOGETHER_RADIUS_KM_MAX = 100
export const TOGETHER_RADIUS_KM_DEFAULT = 10

/** What the person means, in the fixed shape every reader fills. `undefined` fields mean "not said": prefs fill them (together_prefs.ts). */
export interface TogetherRequest {
  /** Lower-case activity, generic verb dropped: "padel", "hiking", "cook". */
  activity: string
  /** The person's own words for it ("play padel", "go hiking"); the ask shows these. Absent: the activity. */
  phrase?: string
  /** Latest day the person wants to have played by, as local midnight at the START of that day (the ask runs until it). */
  beforeAt?: number
  /** Earliest moment (now by default); only set when the sentence names a start ("from Monday"). */
  fromAt?: number
  /** Free area words ("Wien 7", "near Schwedenplatz"); resolved by a LocationPicker, never sent as coordinates. */
  area?: string
  radiusKm?: number
  /** Friend degree as ask reach: 1 = direct contacts, 2 = friends of friends ... up to HOP_CAP. */
  reach?: number
}

const DAY_MS = 86_400_000
/** Words that follow "play" / precede "spielen" without naming what is played. */
const NOT_ACTIVITY = new Set(['again', 'wieder', 'with', 'a', 'the', 'some', 'bis', 'vor', 'am', 'mal', 'gern', 'gerne', 'to', 'before', 'by', 'on'])
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, sonntag: 0, monday: 1, mon: 1, montag: 1, tuesday: 2, tue: 2, tues: 2, dienstag: 2,
  wednesday: 3, wed: 3, mittwoch: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, donnerstag: 4, friday: 5, fri: 5, freitag: 5,
  saturday: 6, sat: 6, samstag: 6, sonnabend: 6,
}
const WD = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|')

const startOfDay = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

/** The next occurrence of weekday `wd` strictly after today (local midnight). "Thursday" said on a Thursday means next week's. */
function nextWeekday(now: number, wd: number): number {
  const today = startOfDay(now)
  const ahead = ((wd - new Date(today).getDay() + 7) % 7) || 7
  const d = new Date(today)
  d.setDate(d.getDate() + ahead) // calendar days, so a clock change never shifts the midnight
  return d.getTime()
}

/** "before Thursday" -> Thursday 00:00. Also "by", "until", "vor", "bis", "tomorrow", "this week", "weekend". */
function readDeadline(t: string, now: number): { beforeAt?: number; fromAt?: number } {
  const wd = new RegExp(`\\b(?:before|by|until|till|vor|bis(?:\\s+zum)?)\\s+(?:next\\s+|nächsten?\\s+)?(${WD})\\b`).exec(t)
  if (wd) return { beforeAt: nextWeekday(now, WEEKDAYS[wd[1]]) }
  const on = new RegExp(`\\b(?:on|am|this|diesen?|next|nächsten?)\\s+(${WD})\\b`).exec(t)
  if (on) {
    const day = nextWeekday(now, WEEKDAYS[on[1]])
    return { fromAt: day, beforeAt: day + DAY_MS }
  }
  if (/\b(?:today|heute)\b/.test(t)) return { beforeAt: startOfDay(now) + DAY_MS }
  if (/\b(?:tomorrow|morgen)\b/.test(t)) return { fromAt: startOfDay(now) + DAY_MS, beforeAt: startOfDay(now) + 2 * DAY_MS }
  if (/\b(?:this weekend|am wochenende|dieses wochenende|weekend)\b/.test(t)) {
    const sat = nextWeekday(now, 6)
    return { fromAt: new Date(now).getDay() === 6 || new Date(now).getDay() === 0 ? startOfDay(now) : sat, beforeAt: sat + 2 * DAY_MS }
  }
  if (/\b(?:this week|diese woche|within a week|next 7 days)\b/.test(t)) return { beforeAt: startOfDay(now) + 7 * DAY_MS }
  return {}
}

function readReach(t: string): number | undefined {
  if (/\b(?:friends of friends|freunde von freunden|2nd degree|second degree)\b/.test(t)) return 2
  if (/\b(?:3rd degree|third degree)\b/.test(t)) return 3
  if (/\b(?:only|just|nur)\s+(?:my\s+|meine\s+)?(?:direct|friends|freunde|contacts)\b/.test(t)) return 1
  return undefined
}

function readArea(raw: string): { area?: string; radiusKm?: number } {
  const km = /\bwithin\s+(\d{1,3})\s*km\b|\b(\d{1,3})\s*km\b/i.exec(raw)
  const radiusKm = km ? Math.min(TOGETHER_RADIUS_KM_MAX, Number(km[1] ?? km[2])) : undefined
  const near = /\b(?:near|around|in|bei|in der nähe von|nahe)\s+([^,.;!?]+?)(?=\s+(?:before|by|until|on|this|next|tomorrow|today|vor|bis|am|within|with|mit)\b|[,.;!?]|$)/i.exec(raw)
  const area = near ? clipText(near[1].trim(), TOGETHER_AREA_MAX) : undefined
  return { ...(area ? { area } : {}), ...(radiusKm !== undefined ? { radiusKm } : {}) }
}

/** A generic leading verb is not the activity: "play padel" and "go hiking" are padel and hiking; "cook" stays cook. */
const LEAD = /^(?:(?:again|wieder|mal|gerne?)\s+)*(?:(?:play|playing|do|doing|go|going|join|try|have|practice|practise|make)\s+)?(?:(?:some|a|an|the|a game of|a round of|eine runde)\s+)?(?:(?:again|wieder|mal|gerne?)\s+)*/
const TRAIL = /\s+(?:spielen|machen|gehen)$/
/** Where the wanted thing ends: the "together" words, a time or a place. */
const STOP = '(?:together|with(?:\\s+(?:me|someone|anyone|somebody))?|again|wieder|zusammen|mit|before|by|until|till|near|around|in|on|at|this|next|tomorrow|today|within|vor|bis|am|bei|nahe)'
const WANT = '(?:want(?:s)?\\s+to|wanna|would\\s+like\\s+to|like\\s+to|looking\\s+to|need\\s+someone\\s+to|someone\\s+to|möchte|moechte|möchten|will|wollen|lust\\s+(?:zu|auf))'

/**
 * Reads one sentence of the pattern "I want to do X together, who wants to do it with me?" (X any activity: padel, hiking, cooking).
 * Returns null when it names no activity (nothing is guessed: the box then asks what to do). `now` is injected so tests and the clock agree.
 */
export function readTogetherRequest(text: string, now: number): TogetherRequest | null {
  const raw = text.trim()
  const t = raw.toLowerCase()
  const W = '([a-zäöüß][\\wäöüß-]*)'
  const phrase = new RegExp(`\\b${WANT}\\s+(.+?)(?=\\s+${STOP}\\b|[,.;!?]|$)`).exec(t)?.[1]
    ?? new RegExp(`\\bplay(?:ing)?\\s+(?:some\\s+|a\\s+game\\s+of\\s+)?${W}`).exec(t)?.[0]
    ?? new RegExp(`\\b${W}\\s+(?:(?:wieder|mal|gerne?)\\s+)?spielen\\b`).exec(t)?.[0]
  if (!phrase) return null
  const activity = phrase.replace(LEAD, '').replace(TRAIL, '').trim()
  if (!activity || NOT_ACTIVITY.has(activity)) return null
  const reach = readReach(t)
  return {
    activity: clipText(activity, TOGETHER_ACTIVITY_MAX),
    phrase: clipText(phrase, TOGETHER_ACTIVITY_MAX),
    ...readDeadline(t, now),
    ...readArea(raw),
    ...(reach !== undefined ? { reach } : {}),
  }
}

const finiteIn = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined

/**
 * Checks what an LLM returned for the TogetherRequest shape (an object, or a JSON string). Unknown keys are ignored, out-of-range values
 * dropped. Null when no usable activity came back, so the caller falls back to readTogetherRequest().
 */
export function acceptTogetherDraft(draft: unknown, now: number): TogetherRequest | null {
  let d = draft
  if (typeof d === 'string') {
    try { d = JSON.parse(d) } catch { return null }
  }
  if (!isRecord(d) || typeof d.activity !== 'string' || !d.activity.trim()) return null
  const horizon = now + 365 * DAY_MS
  const area = typeof d.area === 'string' && d.area.trim() ? clipText(d.area.trim(), TOGETHER_AREA_MAX) : undefined
  const beforeAt = finiteIn(d.beforeAt, now - DAY_MS, horizon)
  const fromAt = finiteIn(d.fromAt, now - DAY_MS, horizon)
  const radiusKm = finiteIn(d.radiusKm, 1, TOGETHER_RADIUS_KM_MAX)
  const reach = finiteIn(d.reach, 1, HOP_CAP)
  return {
    activity: clipText(d.activity.trim().toLowerCase(), TOGETHER_ACTIVITY_MAX),
    ...(typeof d.phrase === 'string' && d.phrase.trim() ? { phrase: clipText(d.phrase.trim(), TOGETHER_ACTIVITY_MAX) } : {}),
    ...(beforeAt !== undefined ? { beforeAt } : {}),
    ...(fromAt !== undefined ? { fromAt } : {}),
    ...(area ? { area } : {}),
    ...(radiusKm !== undefined ? { radiusKm } : {}),
    ...(reach !== undefined && Number.isInteger(reach) ? { reach } : {}),
  }
}

/** The JSON shape a model is told to fill (the whole prompt contract: the model interprets, the code decides). */
export const TOGETHER_DRAFT_SHAPE =
  '{"activity": string, "phrase"?: string, "beforeAt"?: epoch ms, "fromAt"?: epoch ms, "area"?: string, "radiusKm"?: number 1-100, "reach"?: integer 1-6}'
