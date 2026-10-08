/**
 * The query lexicon for TrustWeb: turns a free-text ask into a QueryTemplate
 * that apps/demo's own matcher (match/lexical.ts) scores.
 *
 * Why this exists instead of reusing apps/demo's data/free_text_query.ts:
 * that builder drops only GERMAN function words, so an English ask like
 * "Can anyone lend me a ladder?" keeps "can" and "lend" as match terms and
 * fires on an unrelated English inventory line ("Motorbike, can lend it for a
 * weekend"), surfacing a consent prompt for the wrong thing. This app runs in
 * English by default, so its lexicon is bilingual from the start: English and
 * German stopwords, plus a small synonym table so "motorcycle" finds
 * "motorbike" and "who is hiring" finds "a new position to fill". The synonym
 * table and the other forgiving variants (typos, "Communityhof" for "Community
 * hof", plurals) live in fuzzy.ts.
 *
 * The anonymity floor is the shared DEFAULT_K, never a demo-only 1 (C-03).
 * Owner-declared lines (inventory, own notes) pass through the existing B-08
 * bypass in match/lexical.ts, the same way apps/demo's inventory does.
 */
import { DEFAULT_K } from '../../../packages/network-access/src/anonymity'
import { normalize, tokenize } from '../../demo/src/match/normalize'
import { expandAskTerms, lineNeighbours } from './fuzzy'
import type { ChatThread, QueryTemplate } from '../../demo/src/types'

export const ASK_TEMPLATE_ID = 'trustweb.ask'

const STOPWORDS_EN = [
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'am', 'be', 'been', 'was', 'were',
  'do', 'does', 'did', 'have', 'has', 'had', 'having', 'i', 'me', 'my', 'mine', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'it', 'its', 'we', 'us', 'our', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with', 'from',
  'about', 'as', 'into', 'over', 'under', 'up', 'down', 'out', 'off', 'if', 'then', 'than',
  'so', 'not', 'no', 'yes', 'too', 'just', 'also', 'still', 'really', 'very', 'much', 'many',
  'more', 'most', 'some', 'any', 'there', 'here', 'who', 'whom', 'whose', 'what', 'which',
  'where', 'when', 'why', 'how', 'can', 'could', 'would', 'should', 'will', 'shall', 'may',
  'might', 'must', 'anyone', 'anybody', 'someone', 'somebody', 'everyone', 'one', 'ones',
  'something', 'anything', 'thing', 'things', 'got', 'get', 'gets', 'getting', 'need', 'needs',
  'needed', 'want', 'wants', 'know', 'knows', 'knew', 'please', 'thanks', 'thank', 'like',
  'lend', 'lending', 'borrow', 'borrowing', 'share', 'sharing', 'give', 'giving', 'offer',
  'offering', 'offers', 'spare', 'free', 'available', 'use', 'using', 'help', 'good', 'nice',
  'new', 'old', 'big', 'small', 'little', 'bit', 'lot', 'time', 'day', 'days', 'week', 'weekend',
  'month', 'year', 'today', 'tomorrow', 'soon', 'now', 'next', 'maybe', 'around', 'near',
  'll', 've', 're', 'm', 's', 'd', 't',
]

const STOPWORDS_DE = [
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'ist', 'hat', 'habe', 'hab', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  'mit', 'fuer', 'von', 'zu', 'im', 'in', 'am', 'auf', 'nach', 'bei', 'um', 'was',
  'wer', 'wen', 'wem', 'wo', 'wie', 'kennt', 'jemand', 'jemanden', 'gibt', 'mal', 'noch',
  'brauche', 'suche', 'leihen', 'borgen', 'kann', 'koennte', 'bitte', 'danke',
]

/**
 * Wave 6h, the ask's frame ("does anyone know", "I'm looking for", "can anyone recommend", "kennt jemand"): words that say HOW
 * someone asks, never WHAT. Dropped like the function words above, so only the thing asked for is matched.
 */
const ASK_FRAME = [
  'looking', 'look', 'seeking', 'searching', 'search', 'find', 'finding', 'recommend', 'recommends', 'recommendation',
  'recommendations', 'suggest', 'suggestion', 'suggestions', 'tip', 'tips', 'hey', 'hi', 'hello', 'folks', 'guys', 'happen',
  'happens', 'hat', 'habt', 'hast', 'sucht', 'suchen', 'gesucht', 'empfehlen', 'empfehlung', 'tipp', 'irgendwer', 'irgendjemand',
  'weiss', 'jemandem',
]

const STOPWORDS = new Set([...STOPWORDS_EN, ...STOPWORDS_DE, ...ASK_FRAME])

const UMLAUT_FOLD: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', ẞ: 'SS' }

/**
 * Wave 6h: the one folding both sides get before the matcher (the ask, and every line it is matched against): case, umlauts the
 * German way (ä to ae, so "Bücher" and "Buecher" meet), every other accent dropped ("Café" to "cafe"), hyphens and punctuation to
 * spaces (apps/demo normalize). Written together or apart ("techsetup" / "tech setup") is fuzzy.ts's part.
 */
export function foldForMatch(text: string): string {
  const umlauts = text.normalize('NFC').replace(/[äöüÄÖÜßẞ]/g, (c) => UMLAUT_FOLD[c] ?? c)
  return normalize(umlauts.normalize('NFD').replace(/\p{M}+/gu, ''))
}

/** The content words of an ask: folded, function words and the ask's frame dropped. */
function contentWords(text: string): string[] {
  return tokenize(foldForMatch(text)).filter((w) => w.length >= 2 && !STOPWORDS.has(w))
}

/** What an ask asks for, without its frame: "I'm looking for a drill" reads "drill". */
export function stripAskFrame(text: string): string {
  return contentWords(text).join(' ')
}

/**
 * The match terms of an ask: its content words plus the forgiving variants of
 * fuzzy.ts (synonyms, written together or apart, German compound parts,
 * singular and plural, a misspelt synonym), the asker's own words first. A
 * variant that is a function word ("news" to "new") is dropped again.
 */
export function askTerms(text: string): string[] {
  return expandAskTerms(contentWords(text)).filter((t) => !STOPWORDS.has(t))
}

function templateFor(text: string, matchTerms: string[]): QueryTemplate {
  const t = text.trim()
  return {
    id: ASK_TEMPLATE_ID,
    version: 1,
    category: 'freetext',
    title: { de: `"${t}"`, en: `"${t}"` },
    question: { de: t, en: t },
    matchTerms,
    boostTerms: [],
    excludeTerms: [],
    minScore: 1,
    kThreshold: DEFAULT_K,
    sensitivity: 'high',
    ttlSeconds: 3600,
  }
}

/**
 * A QueryTemplate for one free-text ask. An ask made only of function words
 * yields no terms and therefore matches nothing, which is the honest outcome:
 * better silence than a prompt for something nobody asked about.
 */
export function askTemplate(text: string): QueryTemplate {
  return templateFor(text, askTerms(text))
}

/**
 * askTemplate plus the words of the holder's own lines that the ask means
 * forgivingly (a typo, a plural, a synonym, "Community hof" for "Communityhof").
 * The extra terms are built here, on the holder's phone, from lines it already
 * holds; only the asker's text ever travels. Stopwords never come back in, and
 * the list stays bounded (fuzzy.MAX_LINE_NEIGHBOURS on top of MAX_EXPANDED_TERMS).
 */
export function forgivingAskTemplate(text: string, lineTexts: readonly string[]): QueryTemplate {
  const terms = askTerms(text)
  const neighbours = lineNeighbours(contentWords(text), lineTexts).filter((n) => !STOPWORDS.has(n))
  return templateFor(text, [...new Set([...terms, ...neighbours])])
}

/** The text of every line in the threads the matcher is about to read (for forgivingAskTemplate). */
export function lineTextsOf(threads: readonly ChatThread[]): string[] {
  return threads.flatMap((t) => t.messages.filter((m) => !m.system).map((m) => m.text))
}
