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

const DAY_MS = 86_400_000 // only for the plausibility range of an LLM draft; calendar maths uses addDays
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

function readArea(raw: string, activity: string): { area?: string; radiusKm?: number } {
  const km = /\bwithin\s+(\d{1,3})\s*km\b|\b(\d{1,3})\s*km\b/i.exec(raw)
  const radiusKm = km ? Math.min(TOGETHER_RADIUS_KM_MAX, Number(km[1] ?? km[2])) : undefined
  const END = '(?=\\s+(?:before|by|until|on|this|next|tomorrow|today|tonight|vor|bis|am|within|with|mit|heute|morgen|together|zusammen)\\b|[,.;!?]|$)'
  // "near Wien 7" always names a place. After "in"/"im"/"am" a run of capitalised words or numbers is one ("in Wien 7", "am See"; a
  // German verb after it is not: "in Wien kochen"), and after a lower-case "in" the words up to a time or the end ("in the park").
  const near = new RegExp(`\\b(?:near|around|bei|in der nähe von|nahe)\\s+([^,.;!?]+?)${END}`, 'i').exec(raw)
  const prep = new RegExp(`(?<!\\b[Ii]\\s)\\b(?:[Ii][nm]|[Aa]m)\\s+([A-ZÄÖÜ][^\\s,.;!?]*(?:\\s+[A-ZÄÖÜ\\d][^\\s,.;!?]*)*)|\\bin\\s+([^,.;!?]+?)${END}`, 'g')
  const place = near?.[1] ?? [...raw.matchAll(prep)].map((m) => m[1] ?? m[2]).find((w) => !NOT_PLACE.test(w))
  // A capitalised German noun after the place is the activity, not part of it: "in Wien Padel spielen".
  const words = place?.trim().split(/\s+/) ?? []
  if (words.length > 1 && words[words.length - 1].toLowerCase() === activity) words.pop()
  const area = words.length ? clipText(words.join(' '), TOGETHER_AREA_MAX) : undefined
  return { ...(area ? { area } : {}), ...(radiusKm !== undefined ? { radiusKm } : {}) }
}

/** A generic leading verb is not the activity: "play padel" and "go hiking" are padel and hiking; "cook" stays cook. */
const LEAD = /^(?:(?:again|wieder|mal|gerne?)\s+)*(?:(?:play|playing|do|doing|go|going|join|try|have|practice|practise|make)\s+)?(?:(?:some|a|an|the|a game of|a round of|eine runde)\s+)?(?:(?:again|wieder|mal|gerne?)\s+)*/
const TRAIL = /\s+(?:zu\s+)?(?:spielen|machen|gehen)$/
/** The activity inside a phrase of the person's own words ("play padel" -> "padel"). */
export const activityOf = (phrase: string): string => phrase.replace(LEAD, '').replace(TRAIL, '').trim()
/** Where the wanted thing ends: the "together" words, a time or a place. */
const STOP = '(?:together|with(?:\\s+(?:me|someone|anyone|somebody))?|again|wieder|zusammen|mit|before|by|until|till|near|around|in|on|at|this|next|tomorrow|today|within|vor|bis|am|bei|nahe)'
const WANT = '(?:want(?:s)?\\s+to|wanna|would\\s+like\\s+to|looking\\s+to|möchte|moechte|möchten|will|wollen|lust\\s+(?:zu|auf))'
/** A request is a TOGETHER request only with one of these: without it "I would like to borrow a tent" stays an ordinary ask. */
const TOGETHER_MARK = /\b(?:together|with me|with us|who wants|who'?s up for|zusammen|mit mir|wer (?:will|mag|hat lust)|play(?:ing)?|spielen)\b/
/** Time words and "with me" are not part of the activity; taken out before it is read. */
const TIME_WORDS = new RegExp(`\\b(?:(?:before|by|until|till|vor|bis(?:\\s+zum)?|on|am|this|diese[nrs]?|next|nächsten?)\\s+(?:${WD}|weekend|wochenende|week|woche)|today|tomorrow|tonight|heute|morgen|mit mir|with me)\\b`, 'g')

/**
 * German puts the activity last, after time and place: "Ich möchte am Samstag in Wien kochen", "Hat jemand Lust, am Freitag Padel zu
 * spielen?". After the wish word, times (already out of `bare`), places and filler go; what is left must end in an infinitive.
 */
const DE_MARK = /\b(?:ich|wer|jemand|wir|lust|möchte|moechte|würde|zusammen)\b/
const DE_WANT = /\b(?:möchten?|moechte|will|wollen|würden?\s+gerne?|lust)\b,?\s+([^.;!?]+)/
const DE_DROP = new RegExp(`\\b(?:(?:in|im|am)\\s+(?:${COUNT}\\s+)*(?:${TIME_NOUN})|(?:in|im|am|beim?|nahe)\\s+[^\\s\\d,]+(?:\\s+\\d+)?|mit uns|zusammen|gerne?|mal|wieder|jemand|ich|wir)\\b`, 'g')
function readGermanTail(bare: string): string | undefined {
  if (!DE_MARK.test(bare)) return undefined
  const tail = DE_WANT.exec(bare)?.[1].replace(DE_DROP, ' ').replace(/[,\s]+/g, ' ').trim()
  return tail && tail.split(' ').length <= 3 && /(?:en|ern|eln)$/.test(tail) ? tail : undefined
}

/**
 * Reads one sentence of the pattern "I want to do X together, who wants to do it with me?" (X any activity: padel, hiking, cooking).
 * Returns null when it names no activity (nothing is guessed: the box then asks what to do). `now` is injected so tests and the clock agree.
 */
export function readTogetherRequest(text: string, now: number): TogetherRequest | null {
  const raw = text.trim()
  const t = raw.toLowerCase()
  const W = '([a-zäöüß][\\wäöüß-]*)'
  const bare = t.replace(TIME_WORDS, ' ').replace(/\s+/g, ' ')
  const de = readGermanTail(bare)
  const when = readDeadline(t, now)
  // Unmarked, only a German plan with one bare verb and a time or place counts ("Ich möchte am Samstag in Wien kochen"); one with an
  // object stays an ordinary ask ("Ich möchte eine Bohrmaschine ausleihen"). The dock shows the compiled sentence before it goes.
  const plan = de !== undefined && !de.includes(' ') && (when.beforeAt !== undefined || /\b(?:in|im|am|beim?|nahe)\s/.test(bare))
  if (!TOGETHER_MARK.test(t) && !plan) return null
  let phrase = de ?? new RegExp(`\\b${WANT}\\s+(.+?)(?=\\s+${STOP}\\b|[,.;!?]|$)`).exec(bare)?.[1]
    ?? new RegExp(`\\bplay(?:ing)?\\s+(?:some\\s+|a\\s+game\\s+of\\s+)?${W}`).exec(bare)?.[0]
    ?? new RegExp(`\\b${W}\\s+(?:(?:wieder|mal|gerne?)\\s+)?spielen\\b`).exec(bare)?.[0]
  if (!phrase?.trim()) return null
  phrase = phrase.trim()
  const activity = activityOf(phrase)
  if (!activity || NOT_ACTIVITY.has(activity)) return null
  const reach = readReach(t)
  return {
    activity: clipText(activity, TOGETHER_ACTIVITY_MAX),
    phrase: clipText(phrase, TOGETHER_ACTIVITY_MAX),
    ...when,
    ...readArea(raw, activity),
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

/** Default of draftOrPlain's `on`: off. The app turns it on only while the person has configured an endpoint (llm_endpoint.ts configured()). */
export const TOGETHER_LLM_DRAFT = false

/**
 * The ONE call site of acceptTogetherDraft: when the plain reading leaves the activity or the time empty (and only then) `ask` is
 * called once with the sentence; the draft is range-checked, the plain reading wins wherever it has a value, and a failed draft falls
 * back to the plain reading. `ask` is a user action's model call; this never reaches for one itself.
 */
export async function draftOrPlain(
  text: string, now: number, ask: (text: string) => Promise<unknown>, on: boolean = TOGETHER_LLM_DRAFT,
): Promise<TogetherRequest | null> {
  const plain = readTogetherRequest(text, now)
  if (!on || (plain && plain.beforeAt !== undefined)) return plain
  const draft = acceptTogetherDraft(await ask(text).catch(() => null), now)
  return draft ? { ...draft, ...plain } : plain
}
