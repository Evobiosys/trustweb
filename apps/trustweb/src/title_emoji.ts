// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d (item 3, Jakob 2026-11-18: "emoji based on algorithmically chosen, not LLM chosen, based on the title"): the emoji shown before an
 * event or resource title. The lowercased title is cut into words; the first word (by position) that a keyword of TABLE starts (or, for keywords of
 * four letters and more, ends: German compounds like "Sommerfest") picks its emoji. Keywords of three letters or fewer match only the whole word.
 * No match: a pick from NEUTRAL by a stable hash of the title, so the same title always shows the same emoji. Pure, node-safe. S.* titles stay
 * untouched: the emoji is prepended at render. Setting ui.titleEmoji (Settings > Appearance, on by default; off is stored as `titleEmojiOff`).
 */
const TABLE: readonly (readonly [string, readonly string[]])[] = [
  ['🎄', ['christmas', 'weihnacht', 'advent', 'xmas']],
  ['❄️', ['winter', 'schnee', 'snow', 'ski', 'frost']],
  ['☀️', ['summer', 'sommer', 'sonne', 'sun']],
  ['🌱', ['spring', 'frühling', 'fruehling']],
  ['🍂', ['autumn', 'herbst']],
  ['🎂', ['birthday', 'geburtstag']],
  ['🛠️', ['workshop', 'werkstatt']],
  ['🧘', ['retreat', 'yoga', 'meditat']],
  ['🍲', ['dinner', 'food', 'potluck', 'brunch', 'lunch', 'kochen', 'cook', 'recipe', 'rezept', 'essen']],
  ['🎵', ['music', 'musik', 'concert', 'konzert', 'choir', 'chor', 'jam', 'sing']],
  ['🥾', ['hike', 'hiking', 'wander', 'walk', 'spazier']],
  ['🌿', ['garden', 'garten', 'permacult']],
  ['📚', ['book', 'buch', 'bücher', 'reading', 'library', 'bibliothek', 'lesen']],
  ['💻', ['code', 'coding', 'hack', 'programm', 'dev']],
  ['⭕', ['meeting', 'circle', 'kreis', 'treffen', 'council']],
  ['🎉', ['party', 'feier', 'celebrat']],
  ['🧺', ['market', 'markt']],
  ['🎤', ['talk', 'lecture', 'vortrag', 'keynote', 'panel']],
  ['💃', ['dance', 'tanz']],
  ['👨‍👩‍👧', ['kids', 'kinder', 'family', 'familie']],
  ['🚀', ['launch']],
  ['🔧', ['repair', 'reparatur']],
  ['🎪', ['festival', 'fest']],
  ['📄', ['pdf', 'doc', 'document', 'dokument']],
  ['🎬', ['video', 'film', 'movie']],
  ['🔗', ['link', 'url']],
  ['🧰', ['tool', 'werkzeug']],
  ['📍', ['place', 'location', 'ort']],
  ['💶', ['money', 'geld', 'euro']],
  ['🚲', ['bike', 'bicycle', 'fahrrad', 'rad']],
  ['🚗', ['car', 'auto']],
  ['🏠', ['room', 'zimmer', 'raum', 'house', 'haus', 'wohnung', 'flat']],
]

/** The fallback set (no keyword matched). */
export const NEUTRAL: readonly string[] = ['✨', '🌟', '🔷', '🌀', '🔶', '💠', '🌈', '🍀']

const SHORT = 3
const matchStart = (word: string, kw: string): boolean => (kw.length <= SHORT ? word === kw || word === `${kw}s` : word.startsWith(kw))
const matchEnd = (word: string, kw: string): boolean => kw.length > SHORT && word.endsWith(kw)

function lookup(word: string): string | undefined {
  for (const test of [matchStart, matchEnd]) for (const [emoji, kws] of TABLE) if (kws.some((k) => test(word, k))) return emoji
  return undefined
}

/** FNV-1a, 32 bit: the same text, the same number. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (const c of text) { h ^= c.codePointAt(0) ?? 0; h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}

export function titleEmoji(title: string): string {
  const norm = title.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!norm) return ''
  for (const word of norm.split(/[^\p{L}\p{N}]+/u)) {
    const e = word ? lookup(word) : undefined
    if (e) return e
  }
  return NEUTRAL[hash(norm) % NEUTRAL.length]
}

export const emojiTitle = (title: string, on: boolean): string => {
  const e = on ? titleEmoji(title) : ''
  return e ? `${e} ${title}` : title
}

/** Settings > Appearance "Emoji before titles": on unless the record says off. */
export const emojiOn = (r: object): boolean => (r as { titleEmojiOff?: unknown }).titleEmojiOff !== true
