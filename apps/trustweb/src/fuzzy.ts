/**
 * Forgiving token matching for TrustWeb asks (wave 6, N2). Pure and DOM-free;
 * it knows nothing about hops, degrees or rings, only about words.
 *
 * Two uses, one vocabulary:
 *  1. expandAskTerms / lineNeighbours widen the term list that apps/demo's
 *     exact matcher (match/lexical.ts) scores, so the live matcher turns
 *     forgiving without a change to it: a term that fires still counts one.
 *  2. scoreTokens ranks a line against an ask by similarity (exact above
 *     written-together/apart above plural above synonym above typo), for
 *     callers that want an order or a measurable false-positive rate.
 *
 * What counts as "the same word" (strongest first):
 *   1.00 equal after normalising (case, umlaut folding, punctuation)
 *   0.95 written together or apart ("Communityhof" / "Community hof",
 *        "Steuerberater" / "Steuer Berater"), either direction
 *   0.90 plural or feminine form ("bicycles" / "bicycle", "Steuerberaterin")
 *   0.75 synonym ("bicycles" / "bike", "accountant" / "tax advisor")
 *   0.65 to 0.90 typo: edit distance 1 from 5 letters (5 letters: omission,
 *        doubling or swap only, never a substitution), 2 from 9 letters (then
 *        the first two and the last two letters must agree, so "accountant" is
 *        not "accounting"), or two vowel-for-vowel slips from 7 letters
 *        ("bycicle" / "bicycle"); the first letter must agree; tokens with
 *        digits never fuzz
 *   0.66 character-bigram overlap of 0.85 or more between tokens of 10+ letters
 * Anything below MATCH_THRESHOLD (0.65) is no match; scoreTokens returns 0.
 */
import { normalize, tokenize } from '../../demo/src/match/normalize'
import { splitCompound } from '../../demo/src/match/compound'

/** A pair counts as the same word from this similarity up. */
export const MATCH_THRESHOLD = 0.65
/** At most this many terms leave expandAskTerms (the asker's own words come first). */
export const MAX_EXPANDED_TERMS = 64
/** At most this many words of the holder's own lines are added as neighbours of an ask. */
export const MAX_LINE_NEIGHBOURS = 24

const SIM_EXACT = 1
const SIM_JOINED = 0.95
const SIM_FORM = 0.9
const SIM_SYNONYM = 0.75
const SIM_SYNONYM_TYPO = 0.68
const SIM_NGRAM = 0.66
const TYPO_SLOPE = 1.4

const MIN_TYPO_LEN = 5
const LONG_TYPO_LEN = 9
const VOWEL_PAIR_LEN = 7
const NGRAM_MIN_LEN = 10
const NGRAM_MIN_DICE = 0.85
const SPLIT_MIN_LEN = 8
const SPLIT_MIN_PART = 3
const MAX_SPLITS_PER_TOKEN = 10
const MAX_JOINED_LEN = 24
const MIN_PART_LEN_ADDED = 6
const MAX_VOCABULARY = 5000

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y'])

// ---------------------------------------------------------------------------
// Synonyms
// ---------------------------------------------------------------------------

/**
 * Synonym groups. A word that equals any member (after normalising) is the
 * same thing as every member. Phrases are allowed ("tax advisor"); the exact
 * matcher treats a term with a space as a phrase.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['motorbike', 'motorbikes', 'motorcycle', 'motorcycles', 'motorrad', 'moped', 'scooter'],
  ['room', 'rooms', 'flat', 'apartment', 'place to stay', 'couch', 'wohnung', 'zimmer'],
  ['bicycle', 'bicycles', 'bike', 'bikes', 'fahrrad', 'fahrraeder', 'velo'],
  ['job', 'jobs', 'position', 'role', 'opening', 'vacancy', 'hiring', 'hire', 'stelle'],
  ['funding', 'fund', 'funds', 'grant', 'grants', 'funder', 'funders', 'foerderung'],
  ['car', 'cars', 'auto'],
  ['drill', 'bohrmaschine'],
  ['ladder', 'leiter'],
  ['loudspeaker', 'loudspeakers', 'speaker', 'speakers', 'lautsprecher', 'boxen'],
  ['intro', 'intros', 'introduction', 'introductions'],
  ['accountant', 'accountants', 'tax advisor', 'tax adviser', 'tax consultant', 'steuerberater', 'steuerberaterin', 'steuerberatung'],
]

const GROUPS: readonly (readonly string[])[] = SYNONYM_GROUPS.map((g) => g.map((w) => normalize(w)))

const GROUP_OF: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>()
  GROUPS.forEach((g, i) => { for (const w of g) if (!m.has(w)) m.set(w, i) })
  return m
})()

/** The synonym group of a word (the word itself included), or [] when it has none. */
export function synonymsOf(term: string): string[] {
  const i = GROUP_OF.get(normalize(term))
  return i === undefined ? [] : [...GROUPS[i]]
}

// ---------------------------------------------------------------------------
// Token basics
// ---------------------------------------------------------------------------

/** Canonical comparable form of one token or phrase: lowercase, umlauts folded, punctuation gone. */
export function normaliseToken(s: string): string {
  return normalize(s)
}

function isWord(s: string): boolean {
  return /^\p{L}+$/u.test(s)
}

/** English singular, conservative: "bicycles" to "bicycle", "boxes" to "box", "glass" stays. */
export function singular(t: string): string {
  if (t.length < 4 || !isWord(t)) return t
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y'
  if (/(ss|us|is)$/.test(t)) return t
  if (/(ches|shes|xes|sses|zes)$/.test(t)) return t.slice(0, -2)
  if (t.endsWith('s')) return t.slice(0, -1)
  return t
}

/** Plural or feminine collapsed away: singular plus the German "-erin(nen)" to "-er". */
export function baseForm(t: string): string {
  const s = singular(t)
  return s.replace(/(er)(innen|in)$/, '$1')
}

/** Both neighbours of the same noun, for widening an ask: the word, its singular, a plain plural. */
function numberForms(t: string): string[] {
  if (t.length < 4 || !/^[a-z]+$/.test(t)) return []
  const one = singular(t)
  const forms = [one]
  if (one === t && !t.endsWith('s')) forms.push(/[^aeiou]y$/.test(t) ? t.slice(0, -1) + 'ies' : t + 's')
  return forms.filter((f) => f !== t)
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

/**
 * Optimal-string-alignment edit distance (insert, delete, substitute, swap two
 * neighbours), abandoned early: returns max + 1 as soon as it must exceed max.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array<number>(b.length + 1).fill(0))
    rows[i][0] = i
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = max + 1
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2][j - 2] + 1)
      rows[i][j] = d
      if (d < rowMin) rowMin = d
    }
    if (rowMin > max) return max + 1
  }
  return Math.min(rows[a.length][b.length], max + 1)
}

/** Character n-grams of a token (a set: duplicates collapse). */
export function charNgrams(s: string, n = 2): string[] {
  const grams = new Set<string>()
  for (let i = 0; i + n <= s.length; i++) grams.add(s.slice(i, i + n))
  return [...grams]
}

/** Dice coefficient of the character n-gram sets of two tokens, in [0,1]. */
export function ngramDice(a: string, b: string, n = 2): number {
  const ga = charNgrams(a, n)
  const gb = new Set(charNgrams(b, n))
  if (!ga.length || !gb.size) return 0
  const shared = ga.filter((g) => gb.has(g)).length
  return (2 * shared) / (ga.length + gb.size)
}

/** How many edits a token of this (shorter) length may carry: 0 below 5 letters, 1 below 9, else 2. */
export function typoTolerance(len: number): number {
  if (len < MIN_TYPO_LEN) return 0
  return len < LONG_TYPO_LEN ? 1 : 2
}

function differingPositions(a: string, b: string): number[] {
  const out: number[] = []
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i)
  return out
}

/** Same length, differing only where BOTH letters are vowels, at most two places. */
function vowelOnlyDifference(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const at = differingPositions(a, b)
  return at.length >= 1 && at.length <= 2 && at.every((i) => VOWELS.has(a[i]) && VOWELS.has(b[i]))
}

/** The first two and the last two letters agree: a slip in the middle, not a different ending. */
function sameEdges(a: string, b: string): boolean {
  return a.slice(0, 2) === b.slice(0, 2) && a.slice(-2) === b.slice(-2)
}

/** One letter replaced by another at the same place (a swap of two neighbours is not that). */
function isSingleSubstitution(a: string, b: string): boolean {
  return a.length === b.length && differingPositions(a, b).length === 1
}

/** One token is the other plus trailing letters ("table" / "tablet"): usually another word. */
function isPrefixExtension(a: string, b: string): boolean {
  return a !== b && (a.startsWith(b) || b.startsWith(a))
}

/**
 * Typo similarity of two single tokens: 0 when they are not plausibly the
 * same word, else 1 - TYPO_SLOPE * distance / shorter length (so a short word
 * with one slip scores lower than a long one).
 */
export function typoSimilarity(a: string, b: string): number {
  if (a === b) return SIM_EXACT
  if (!isWord(a) || !isWord(b) || a[0] !== b[0]) return 0
  const shorter = Math.min(a.length, b.length)
  const tol = typoTolerance(shorter)
  if (tol === 0) return 0
  let d = editDistance(a, b, tol)
  if (d > tol && shorter >= VOWEL_PAIR_LEN && vowelOnlyDifference(a, b)) d = 1
  if (d > tol) return 0
  if (d === 2 && !sameEdges(a, b)) return 0
  if (shorter === MIN_TYPO_LEN && isSingleSubstitution(a, b)) return 0
  if (shorter <= MIN_TYPO_LEN && isPrefixExtension(a, b)) return 0
  return 1 - (TYPO_SLOPE * d) / shorter
}

function ngramSimilarity(a: string, b: string): number {
  if (!isWord(a) || !isWord(b) || a[0] !== b[0] || Math.min(a.length, b.length) < NGRAM_MIN_LEN) return 0
  return ngramDice(a, b) >= NGRAM_MIN_DICE ? SIM_NGRAM : 0
}

// ---------------------------------------------------------------------------
// Pairwise similarity
// ---------------------------------------------------------------------------

function squash(s: string): string {
  return s.replace(/ /g, '')
}

/** Similarity of the synonym groups two terms belong to: exact membership, else via a typo of a member. */
function synonymSimilarity(a: string, b: string): number {
  const ga = GROUP_OF.get(a)
  const gb = GROUP_OF.get(b)
  if (ga !== undefined && ga === gb) return SIM_SYNONYM
  if (ga !== undefined && gb === undefined && groupViaTypo(b) === ga) return SIM_SYNONYM_TYPO
  if (gb !== undefined && ga === undefined && groupViaTypo(a) === gb) return SIM_SYNONYM_TYPO
  return 0
}

/** The synonym group a misspelt word most plausibly belongs to, or undefined. */
function groupViaTypo(t: string): number | undefined {
  if (t.includes(' ') || t.length < MIN_TYPO_LEN) return undefined
  let best: { group: number; sim: number } | undefined
  for (const [member, group] of GROUP_OF) {
    if (member.includes(' ')) continue
    const sim = typoSimilarity(t, member)
    if (sim >= MATCH_THRESHOLD && (!best || sim > best.sim)) best = { group, sim }
  }
  return best?.group
}

/**
 * How alike two terms (words or short phrases) are, in [0,1]; MATCH_THRESHOLD
 * and above means "the same word". Symmetric.
 */
export function termSimilarity(a: string, b: string): number {
  const na = normaliseToken(a)
  const nb = normaliseToken(b)
  if (!na || !nb) return 0
  if (na === nb) return SIM_EXACT
  const spaced = na.includes(' ') || nb.includes(' ')
  if (spaced && squash(na) === squash(nb)) return SIM_JOINED
  if (!spaced && baseForm(na) === baseForm(nb)) return SIM_FORM
  const parts = [synonymSimilarity(na, nb)]
  if (!spaced) {
    parts.push(typoSimilarity(na, nb), typoSimilarity(baseForm(na), baseForm(nb)), ngramSimilarity(na, nb))
  }
  return Math.max(...parts)
}

// ---------------------------------------------------------------------------
// Widening an ask
// ---------------------------------------------------------------------------

function splitPhrases(token: string): string[] {
  if (token.length < SPLIT_MIN_LEN || !isWord(token)) return []
  const out: string[] = []
  for (let at = SPLIT_MIN_PART; at <= token.length - SPLIT_MIN_PART; at++) out.push(`${token.slice(0, at)} ${token.slice(at)}`)
  const known = splitCompound(token)
  const preferred = known.length >= 2 ? [known.join(' ')] : []
  return [...preferred, ...out].slice(0, MAX_SPLITS_PER_TOKEN)
}

function dictionaryParts(token: string): string[] {
  return splitCompound(token).filter((p) => p.length >= MIN_PART_LEN_ADDED)
}

function joinedNeighbours(terms: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i + 1 < terms.length; i++) {
    if (terms[i].includes(' ') || terms[i + 1].includes(' ')) continue
    const joined = terms[i] + terms[i + 1]
    if (joined.length <= MAX_JOINED_LEN && isWord(joined)) out.push(joined)
  }
  return out
}

function phraseSynonyms(terms: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i + 1 < terms.length; i++) out.push(...synonymsOf(`${terms[i]} ${terms[i + 1]}`))
  return out
}

function misspeltSynonyms(term: string): string[] {
  if (GROUP_OF.has(term)) return []
  const group = groupViaTypo(term)
  return group === undefined ? [] : [...GROUPS[group]]
}

/**
 * The asker's content terms plus forgiving variants, deduplicated, the asker's
 * own words first and the total capped at MAX_EXPANDED_TERMS:
 * synonyms (also of two neighbouring words, also of a misspelt word), the
 * neighbours written together, long words split in every plausible place (as
 * phrases), the dictionary parts of a German compound, singular and plural.
 */
export function expandAskTerms(terms: readonly string[]): string[] {
  const base = [...new Set(terms.map(normaliseToken).filter((t) => t.length > 0))]
  const tiers: string[][] = [
    base,
    base.flatMap(synonymsOf),
    phraseSynonyms(base),
    base.flatMap(misspeltSynonyms),
    joinedNeighbours(base),
    base.flatMap(splitPhrases),
    base.flatMap(dictionaryParts),
    base.flatMap(numberForms),
  ]
  return [...new Set(tiers.flat())].slice(0, MAX_EXPANDED_TERMS)
}

function lineTokens(text: string): string[] {
  return tokenize(text)
}

function vocabularyOf(lineTexts: readonly string[]): { tokens: string[]; pairs: [string, string][] } {
  const tokens = new Set<string>()
  const pairs = new Map<string, [string, string]>()
  for (const text of lineTexts) {
    const words = lineTokens(text)
    words.forEach((w, i) => {
      if (tokens.size < MAX_VOCABULARY) tokens.add(w)
      const next = words[i + 1]
      if (next !== undefined && pairs.size < MAX_VOCABULARY) pairs.set(`${w} ${next}`, [w, next])
    })
  }
  return { tokens: [...tokens], pairs: [...pairs.values()] }
}

/**
 * Words and phrases of the holder's own lines that the ask's terms mean
 * forgivingly (a typo, a plural, a synonym; two line words that the ask writes
 * as one), for adding to the exact matcher's term list. Local only: these
 * terms never leave the phone, the wire carries the asker's text.
 * Exact repeats of an ask term are left out. At most MAX_LINE_NEIGHBOURS.
 */
export function lineNeighbours(terms: readonly string[], lineTexts: readonly string[]): string[] {
  const asked = new Set(terms.map(normaliseToken))
  const { tokens, pairs } = vocabularyOf(lineTexts)
  const found = new Set<string>()
  for (const term of asked) {
    if (term.includes(' ')) continue
    for (const token of tokens) {
      if (!asked.has(token) && termSimilarity(term, token) >= MATCH_THRESHOLD) found.add(token)
    }
    for (const [x, y] of pairs) {
      if (termSimilarity(term, `${x} ${y}`) >= MATCH_THRESHOLD) found.add(`${x} ${y}`)
    }
  }
  return [...found].slice(0, MAX_LINE_NEIGHBOURS)
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function lineCandidates(lineTerms: readonly string[]): string[] {
  const words = lineTerms.map(normaliseToken).filter((t) => t.length > 0)
  const out = new Set<string>(words)
  words.forEach((w, i) => {
    for (const part of splitCompound(w)) out.add(part)
    const two = words[i + 1]
    if (two !== undefined) {
      out.add(`${w} ${two}`)
      out.add(w + two)
    }
    const three = words[i + 2]
    if (two !== undefined && three !== undefined) out.add(`${w} ${two} ${three}`)
  })
  return [...out]
}

function bestSimilarity(term: string, candidates: readonly string[]): number {
  let best = 0
  for (const c of candidates) {
    const s = termSimilarity(term, c)
    if (s > best) best = s
    if (best === SIM_EXACT) break
  }
  return best
}

/**
 * Score a line (its tokens) against an ask (its content terms): the sum, over
 * the ask's terms, of the best similarity to anything in the line, counting
 * only matches at MATCH_THRESHOLD or above. Two neighbouring ask words are
 * also tried as one phrase ("tax advisor", "Community hof"), counted only when
 * neither word matched on its own. 0 means no match; higher ranks higher.
 */
export function scoreTokens(askTerms: readonly string[], lineTerms: readonly string[]): number {
  const terms = [...new Set(askTerms.map(normaliseToken).filter((t) => t.length > 0))]
  const candidates = lineCandidates(lineTerms)
  const single = terms.map((t) => bestSimilarity(t, candidates))
  let total = 0
  single.forEach((s) => { if (s >= MATCH_THRESHOLD) total += s })
  for (let i = 0; i + 1 < terms.length; i++) {
    if (single[i] >= MATCH_THRESHOLD || single[i + 1] >= MATCH_THRESHOLD) continue
    const s = bestSimilarity(`${terms[i]} ${terms[i + 1]}`, candidates)
    if (s >= MATCH_THRESHOLD) total += s
  }
  return total
}
