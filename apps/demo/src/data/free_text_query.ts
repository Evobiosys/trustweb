/**
 * "Ins Netzwerk rufen" ("call into the web"): a free-text ask, as opposed to
 * one of the five fixed TEMPLATES (data/templates.ts). B types a sentence
 * instead of picking a card; A's device matches it with the exact same
 * matcher (match/lexical.ts's matchTemplate), because this builds an ordinary
 * QueryTemplate from the free text -- there is no second matching path.
 *
 * Why a synthetic QueryTemplate rather than a new matcher entry point: every
 * caller on the answering side (runConsentCeremony, the ambient query
 * handler, gate.ts's decide()) already takes a QueryTemplate and never checks
 * where it came from. Reusing that contract means a free-text ask is, from
 * the matcher and the gate onward, indistinguishable in shape from a fixed
 * template -- the SAME anonymity floor, the SAME exclude-term veto machinery
 * (empty here, but the field exists so nothing has to special-case it), the
 * SAME byte-identical-PASS discipline.
 */

import type { QueryTemplate } from '../types'
import { DEFAULT_K } from '@resource-web/network-access/anonymity'
import { tokenize } from '../match/normalize'

/** Sentinel templateId a free-text QueryEnvelope always carries on the wire
 *  (see types.ts's QueryEnvelope.freeText doc comment) -- the receiving
 *  device never looks this id up in data/templates.ts's catalogue; it is
 *  only there so QueryEnvelope.templateId stays a required, always-present
 *  field for every envelope shape wire.ts and gate.ts already assume. */
export const FREE_TEXT_TEMPLATE_ID = 'wot.freetext.ask'

// A short stoplist of function words that carry no matching signal on their
// own ("kennt jemand einen Ski der frei ist" must not treat "kennt", "einen"
// or "der" as search terms). Deliberately small and deliberately not a full
// German stopword list: over-stripping would silently drop a short real word
// (e.g. "Bohrmaschine" broken into pieces some dictionary considers
// function-word-like never happens here because this list is closed, not
// pattern-based).
const STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'ist', 'hat', 'habe', 'hab', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  'mit', 'für', 'von', 'zu', 'im', 'in', 'am', 'auf', 'nach', 'bei', 'um', 'was',
  'wer', 'wen', 'wem', 'wo', 'wie', 'kennt', 'jemand', 'jemanden', 'gibt', 'mal', 'noch',
])

/**
 * Build a QueryTemplate from whatever B typed. Deterministic (same text ->
 * same template every time) so both devices in a broadcast -- and a test
 * calling this twice -- get an identical template without it ever crossing
 * the wire itself (only the raw `text` does, in QueryEnvelope.freeText; each
 * receiving device rebuilds the template locally, exactly like a fixed
 * template is looked up locally by id).
 */
export function freeTextTemplate(text: string): QueryTemplate {
  const words = tokenize(text).filter((w) => w.length >= 2 && !STOPWORDS.has(w))
  // A query that is ALL stopwords (rare, but "was hat wer" typed as a joke)
  // still gets to try matching on its unfiltered tokens rather than matching
  // nothing by construction.
  const matchTerms = words.length ? words : tokenize(text)
  return {
    id: FREE_TEXT_TEMPLATE_ID,
    version: 1,
    category: 'freetext',
    title: { de: `„${text}“`, en: `"${text}"` },
    question: { de: text, en: text },
    matchTerms,
    boostTerms: [],
    excludeTerms: [],
    minScore: 1,
    // C-03 (2026-09-06): the hardcoded kThreshold: 1 demo-crutch is banned
    // ("must not ship"), replaced with the workspace DEFAULT_K (3).
    // state.ts's inventoryThreads() gives every "Was ich habe" entry exactly
    // one author (the device's own owner), so any inventory-only match has
    // distinctAuthors === 1 by construction -- at DEFAULT_K this alone would
    // make sharing an inventory entry impossible, killing the "Ski in, Ski
    // found" story.
    //
    // B-08 (2026-09-06), stale note above superseded: match/lexical.ts's
    // matchTemplate() now bypasses this floor when every relevance-band hit
    // is owner-declared (thread.source === 'self'), which an inventory-only
    // match always is. The floor here still governs a real chat hit -- it
    // only stops protecting the holder from being asked about their own
    // single declared item, not a third party's message. Do not read the
    // "Known and accepted" framing above as still live; the Ski story is
    // fixed by the bypass, not by this constant.
    kThreshold: DEFAULT_K,
    // Free text is a bigger privacy surface than a curated template's fixed
    // vocabulary -- the asker can type anything, so the UI that shows this
    // question to A must say so plainly (see i18n.ts's askFreeTextPrivacy).
    sensitivity: 'high',
    ttlSeconds: 3600,
  }
}
