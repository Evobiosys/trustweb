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
 * "motorbike" and "who is hiring" finds "a new position to fill".
 *
 * The anonymity floor is the shared DEFAULT_K, never a demo-only 1 (C-03).
 * Owner-declared lines (inventory, own notes) pass through the existing B-08
 * bypass in match/lexical.ts, the same way apps/demo's inventory does.
 */
import { DEFAULT_K } from '../../../packages/network-access/src/anonymity'
import { tokenize, normalize } from '../../demo/src/match/normalize'
import type { QueryTemplate } from '../../demo/src/types'

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

const STOPWORDS = new Set([...STOPWORDS_EN, ...STOPWORDS_DE])

/**
 * Synonym groups. A query word that equals any member (after normalize())
 * adds every member of its group as a match term. Phrases are allowed;
 * match/lexical.ts treats a term with a space as a phrase.
 */
const SYNONYM_GROUPS: string[][] = [
  ['motorbike', 'motorbikes', 'motorcycle', 'motorcycles', 'motorrad', 'moped', 'scooter'],
  ['room', 'rooms', 'flat', 'apartment', 'place to stay', 'couch', 'wohnung', 'zimmer'],
  ['bicycle', 'bike', 'bikes', 'fahrrad'],
  ['job', 'jobs', 'position', 'role', 'opening', 'vacancy', 'hiring', 'hire', 'stelle'],
  ['funding', 'fund', 'funds', 'grant', 'grants', 'funder', 'funders', 'foerderung'],
  ['car', 'cars', 'auto'],
  ['drill', 'bohrmaschine'],
  ['ladder', 'leiter'],
  ['loudspeaker', 'loudspeakers', 'speaker', 'speakers', 'lautsprecher', 'boxen'],
  ['intro', 'intros', 'introduction', 'introductions'],
]

const SYNONYM_INDEX: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>()
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map((w) => normalize(w))
    for (const w of normalized) m.set(w, normalized)
  }
  return m
})()

/** The content words of an ask: normalized, stopwords dropped, synonyms expanded. */
export function askTerms(text: string): string[] {
  const words = tokenize(text).filter((w) => w.length >= 2 && !STOPWORDS.has(w))
  const terms = new Set<string>()
  for (const w of words) {
    terms.add(w)
    for (const syn of SYNONYM_INDEX.get(w) ?? []) terms.add(syn)
  }
  return [...terms]
}

/**
 * A QueryTemplate for one free-text ask. An ask made only of function words
 * yields no terms and therefore matches nothing, which is the honest outcome:
 * better silence than a prompt for something nobody asked about.
 */
export function askTemplate(text: string): QueryTemplate {
  const t = text.trim()
  return {
    id: ASK_TEMPLATE_ID,
    version: 1,
    category: 'freetext',
    title: { de: `"${t}"`, en: `"${t}"` },
    question: { de: t, en: t },
    matchTerms: askTerms(t),
    boostTerms: [],
    excludeTerms: [],
    minScore: 1,
    kThreshold: DEFAULT_K,
    sensitivity: 'high',
    ttlSeconds: 3600,
  }
}
