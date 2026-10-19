/**
 * Wave 16, "I want to do X together, who wants to do it with me" (padel was the first X; Jakob 2026-10-18 16:04, voice memo): one sentence becomes a structured together request, and a
 * request becomes an ordinary ask (hops.ts reach) that the existing matcher answers against other people's availability items. The
 * request never carries a place on the wire beyond the area words the person chose (I1: where someone plays stays on their phone
 * until they answer yes).
 *
 * readTogetherRequest() is a deterministic reader (English + German); it works with no LLM at all (DECISIONS.md D-together-reader).
 * Pure and DOM-free.
 */
import { clipText } from './kept_list'

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
  /** Free area words ("Wien 7", "near Schwedenplatz"); sent as words, never as coordinates. */
  area?: string
  radiusKm?: number
  /** Friend degree as ask reach: 1 = direct contacts, 2 = friends of friends ... up to HOP_CAP. */
  reach?: number
}

/** Words that follow "play" / precede "spielen" without naming what is played. */
const NOT_ACTIVITY = new Set(['play', 'playing', 'spielen', 'in', 'be', 'again', 'wieder', 'with', 'a', 'the', 'some', 'bis', 'vor', 'am', 'mal', 'gern', 'gerne', 'to', 'before', 'by', 'on'])
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

/** Local midnight `n` calendar days after the day of `t` (setDate, so a clock change never shifts the midnight; DAY_MS would). */
const addDays = (t: number, n: number): number => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() + n); return d.getTime() }

/** "before Thursday" -> Thursday 00:00. Also "by", "until", "vor", "bis", "on Friday", "tomorrow", "this week", "weekend". */
function readDeadline(t: string, now: number): { beforeAt?: number; fromAt?: number } {
  const today = startOfDay(now)
  const wd = new RegExp(`\\b(?:before|by|until|till|vor|bis(?:\\s+zum)?)\\s+(?:next\\s+|nächsten?\\s+)?(${WD})\\b`).exec(t)
  if (wd) return { beforeAt: nextWeekday(now, WEEKDAYS[wd[1]]) }
  const on = new RegExp(`\\b(?:on|am|this|diesen?|next|nächsten?)\\s+(${WD})\\b`).exec(t)
  if (on) {
    const day = nextWeekday(now, WEEKDAYS[on[1]])
    return { fromAt: day, beforeAt: addDays(day, 1) }
  }
  if (/\b(?:today|heute)\b/.test(t)) return { beforeAt: addDays(today, 1) }
  if (/\b(?:tomorrow|morgen)\b/.test(t)) return { fromAt: addDays(today, 1), beforeAt: addDays(today, 2) }
  if (/\b(?:this weekend|am wochenende|dieses wochenende|weekend)\b/.test(t)) {
    const dow = new Date(today).getDay()
    // On a Saturday or Sunday the weekend is the one that is running, not the next.
    const sat = dow === 6 ? today : dow === 0 ? addDays(today, -1) : nextWeekday(now, 6)
    return { fromAt: Math.max(today, sat), beforeAt: addDays(sat, 2) }
  }
  if (/\b(?:this week|diese woche|within a week|next 7 days)\b/.test(t)) return { beforeAt: addDays(today, 7) }
  return {}
}

function readReach(t: string): number | undefined {
  if (/\b(?:friends of friends|freunde von freunden|2nd degree|second degree)\b/.test(t)) return 2
  if (/\b(?:3rd degree|third degree)\b/.test(t)) return 3
  if (/\b(?:only|just|nur)\s+(?:my\s+|meine\s+)?(?:direct|friends|freunde|contacts)\b/.test(t)) return 1
  return undefined
}

/** Words after "in"/"am"/"im" that name a time, not a place: "in the morning", "in 3 days", "am Samstag", "im Januar", "in der Früh". */
const TIME_NOUN = `${WD}|morning|afternoon|evening|night|days?|weeks?|hours?|months?|year|weekend|january|february|march|april|may|june|july|august|september|october|november|december|januar|februar|märz|mai|juni|juli|oktober|dezember|früh|fruh|morgen|vormittag|nachmittag|abend|nacht|wochen?|tag(?:en)?|stunden?|monat(?:en)?|jahr|wochenende`
const COUNT = '(?:the|a|an|one|two|three|few|couple of|der|die|das|dem|den|einer|einem|ein|zwei|drei|paar|\\d+)'
const NOT_PLACE = new RegExp(`^(?:${COUNT}\\s+)*(?:${TIME_NOUN})\\b`, 'i')

function readArea(raw: string): { area?: string; radiusKm?: number } {
  const km = /\bwithin\s+(\d{1,3})\s*km\b|\b(\d{1,3})\s*km\b/i.exec(raw)
  const radiusKm = km ? Math.min(TOGETHER_RADIUS_KM_MAX, Number(km[1] ?? km[2])) : undefined
  const END = '(?=\\s+(?:before|by|until|on|this|next|tomorrow|today|tonight|vor|bis|am|within|with|mit|heute|morgen|together|zusammen)\\b|[,.;!?]|$)'
  // "near Wien 7" always names a place. After "in"/"im"/"am" a run of capitalised words or numbers is one ("in Wien 7", "am See"; a
  // German verb after it is not: "in Wien kochen"), and after a lower-case "in" the words up to a time or the end ("in the park").
  const near = new RegExp(`\\b(?:near|around|bei|in der nähe von|nahe)\\s+([^,.;!?]+?)${END}`, 'i').exec(raw)
  const prep = new RegExp(`(?<!\\b[Ii]\\s)\\b(?:[Ii][nm]|[Aa]m)\\s+([A-ZÄÖÜ][^\\s,.;!?]*(?:\\s+[A-ZÄÖÜ\\d][^\\s,.;!?]*)*)|\\bin\\s+([^,.;!?]+?)${END}`, 'g')
  const place = near?.[1] ?? [...raw.matchAll(prep)].map((m) => m[1] ?? m[2]).find((w) => !NOT_PLACE.test(w))
  const area = place ? clipText(place.trim(), TOGETHER_AREA_MAX) : undefined
  return { ...(area ? { area } : {}), ...(radiusKm !== undefined ? { radiusKm } : {}) }
}

/** A generic leading verb is not the activity: "play padel" and "go hiking" are padel and hiking; "cook" stays cook. */
const LEAD = /^(?:(?:again|wieder|mal|gerne?)\s+)*(?:(?:play|playing|do|doing|go|going|join|try|have|practice|practise|make)\s+)?(?:(?:some|a|an|the|a game of|a round of|eine runde)\s+)?(?:(?:again|wieder|mal|gerne?)\s+)*/
const TRAIL = /\s+(?:spielen|machen|gehen)$/
/** Where the wanted thing ends: the "together" words, a time or a place. */
const STOP = '(?:together|with(?:\\s+(?:me|someone|anyone|somebody))?|again|wieder|zusammen|mit|before|by|until|till|near|around|in|on|at|this|next|tomorrow|today|within|vor|bis|am|bei|nahe)'
const WANT = '(?:want(?:s)?\\s+to|wanna|would\\s+like\\s+to|looking\\s+to|möchte|moechte|möchten|will|wollen|lust\\s+(?:zu|auf))'
/** A request is a TOGETHER request only with one of these: without it "I would like to borrow a tent" stays an ordinary ask. */
const TOGETHER_MARK = /\b(?:together|with me|with us|who wants|who'?s up for|zusammen|mit mir|wer (?:will|mag|hat lust)|play(?:ing)?|spielen)\b/
/** Time words and "with me" are not part of the activity; taken out before it is read. */
const TIME_WORDS = new RegExp(`\\b(?:(?:before|by|until|till|vor|bis(?:\\s+zum)?|on|am|this|diese[nrs]?|next|nächsten?)\\s+(?:${WD}|weekend|wochenende|week|woche)|today|tomorrow|tonight|heute|morgen|mit mir|with me)\\b`, 'g')

/**
 * Reads one sentence of the pattern "I want to do X together, who wants to do it with me?" (X any activity: padel, hiking, cooking).
 * Returns null when it names no activity (nothing is guessed: the box then asks what to do). `now` is injected so tests and the clock agree.
 */
export function readTogetherRequest(text: string, now: number): TogetherRequest | null {
  const raw = text.trim()
  const t = raw.toLowerCase()
  if (!TOGETHER_MARK.test(t)) return null
  const W = '([a-zäöüß][\\wäöüß-]*)'
  const bare = t.replace(TIME_WORDS, ' ').replace(/\s+/g, ' ')
  let phrase = new RegExp(`\\b${WANT}\\s+(.+?)(?=\\s+${STOP}\\b|[,.;!?]|$)`).exec(bare)?.[1]
    ?? new RegExp(`\\bplay(?:ing)?\\s+(?:some\\s+|a\\s+game\\s+of\\s+)?${W}`).exec(bare)?.[0]
    ?? new RegExp(`\\b${W}\\s+(?:(?:wieder|mal|gerne?)\\s+)?spielen\\b`).exec(bare)?.[0]
  if (!phrase?.trim()) return null
  phrase = phrase.trim()
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
