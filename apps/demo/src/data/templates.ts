import type { QueryTemplate } from '../types'
import { DEFAULT_K } from '@resource-web/network-access/anonymity'

/**
 * The five demo query templates.
 *
 * Vocabulary (matchTerms / boostTerms / excludeTerms) is mined from the
 * per-category clusters in
 * overnight/05-chat-group-information.md section 2 (10-25 items each,
 * "realistic chat-usage terms" per the task). All terms are written in
 * natural German (umlauts, mixed case, hyphens) exactly as a person would
 * type them -- lexical.ts runs BOTH the message text and every template term
 * through the same `normalize()` pipeline at match time, so a term written
 * here with an umlaut or a hyphen ("günstig", "2-Zi-Whg") ends up compared
 * on equal footing with whatever casing/umlaut-typing a real message used.
 * A normalized term that contains a space (e.g. "2-zi-whg" -> "2 zi whg"
 * after normalization) is matched as a phrase against the normalized message
 * text; a normalized term with no space is matched against the message's
 * stemmed + compound-split tokens. See lexical.ts.
 *
 * --- Divergence from packages/network-access/src/templates.ts ---
 * That file (referenced in overnight/05-chat-group-information.md section 1)
 * does not exist in this checkout of the repo -- there is no
 * packages/network-access/src/templates.ts on this branch to read or stay
 * byte-compatible with. What DOES exist is packages/network-access/src/types.ts,
 * whose QueryTemplate-adjacent shapes (Gate0Policy/Gate1Policy/Gate2Policy,
 * OutwardKind, IntroQuery) serve a different purpose entirely: runtime,
 * per-peer authorization state for the "who can my owner introduce me to"
 * flow, not a reusable lexical-matching catalogue. This module instead
 * implements apps/demo/src/types.ts's QueryTemplate verbatim (that is the
 * type this app's matcher, UI and tests actually import), and follows the
 * CatalogueTemplate JSON shape sketched in
 * overnight/05-chat-group-information.md section 3 for field CONTENT
 * (title/question/vocabulary/k_threshold/sensitivity/ttl) wherever the two
 * shapes overlap; fields that JSON has and QueryTemplate does not
 * (answer_shape, sig, supersedes, revoked, target, match_mode) are simply
 * not represented here, since apps/demo/src/types.ts's QueryTemplate has no
 * slot for them and this file must not invent new fields on that type.
 */

const T1_HOUSING_PRE_LISTING_MATCH_TERMS = [
  'wohnung frei',
  'wird frei',
  'kommt frei',
  'kennt wer wen der auszieht',
  'kennt wer wen die auszieht',
  'kennst wen der auszieht',
  'kennst wen die auszieht',
  'zieht aus',
  'freie wohnung',
  'whg frei',
  '2-zi-whg',
  '2ziwhg',
  '3 zimmer wird frei',
  'schlüsselübergabe',
  'schlüsselübergabe bald',
  'bevors online geht',
  'bevors inseriert wird',
  'bevors aufm markt is',
  'geheimtipp wohnung',
  'hat wer wos frei',
  'nachmieter gesucht',
  'wer sucht nachmieter',
  'kennt wer wen bei der hausverwaltung',
]

// Deliberately does NOT include "wohnung" or "zimmer" bare: those single
// words are far too common in this chat's general small talk (dog-walking,
// flea-market, football) to carry any signal on their own -- they only
// count when paired with a "something is happening to this flat" verb
// phrase above, or as a boost alongside one.
const T1_HOUSING_PRE_LISTING_BOOST_TERMS = [
  'auszieht',
  'wohnung',
  '2 zimmer',
  'ottakring',
  'herbst',
  'noch nicht gekündigt',
  'nix fix',
  'noch nix spruchreif',
]

const T1_HOUSING_PRE_LISTING_EXCLUDE_TERMS = [
  // Willingness-only decoys named explicitly in the seed-corpus doc.
  'willhaben.at',
  'immowelt',
  'immoscout',
  'airbnb',
  'ferienwohnung',
  'wird geputzt',
  'putzen',
  'inserat online schon',
  // Seeker-side language: someone ASKING for a flat is not the same signal
  // as someone reporting that one exists. A bare "suche"/"brauche" must
  // never by itself create a hit on the pre-listing OFFER template.
  'suche',
  'sucht grad',
  'wer hat was frei',
  'brauche eine wohnung',
  'brauch a wohnung',
]

const T2_NACHMIETER_GENOSSENSCHAFT_MATCH_TERMS = [
  'nachmieter',
  'nachmieterin',
  'nachmieter gesucht',
  'genossenschaftswohnung',
  'gemeindebau',
  'gemeindewohnung',
  'wiener wohnen',
  'wohn-ticket',
  'wohnticket',
  'warteliste',
  'wartejahre',
  'anwartschaft',
  'vormerkschein',
  'freie gemeindewohnung',
  'startwohnung',
  'befristeter vertrag läuft aus',
  'übertragung',
  'weitergabe whg',
  'wird weitergegeben',
  'vergabe',
  'punkte sammeln',
  'hausverwaltung kennt wen',
  'wer kennt wen bei der genossenschaft',
]

// Deliberately disjoint from T2_..._MATCH_TERMS above: a boost term must add
// information, not just re-score a matchTerm string that already fired
// (e.g. "gemeindebau" and "wiener wohnen" are already exact matchTerms and
// were removed here to avoid silently double-counting the same signal).
const T2_NACHMIETER_GENOSSENSCHAFT_BOOST_TERMS = ['genossenschaft', 'weitergegeben']

const T2_NACHMIETER_GENOSSENSCHAFT_EXCLUDE_TERMS = [
  'wohnticket beantragen info',
  'wien.gv.at formular',
]

const T3_KASSENARZT_OPEN_MATCH_TERMS = [
  'kassenarzt',
  'kassenärztin',
  'kassen-facharzt',
  'wahlarzt',
  'nimmt noch patienten',
  'nimmt keine neuen patienten',
  'aufnahmestopp',
  'freie kassenstelle',
  'frauenärztin die noch nimmt',
  'hautarzt termin frei',
  'wer kennt wen bei der ögk',
  'hausarzt gesucht',
  'guter kassenarzt für kinder',
  'termin schnell bekommen',
  'ordination nimmt auf',
  'ärztefunkdienst',
  'bereitschaftsdienst',
]

// "kassenarzt" and "aufnahmestopp" are already exact matchTerms above;
// deliberately not repeated here (see T2's boost-list comment for why).
const T3_KASSENARZT_OPEN_BOOST_TERMS = ['nimmt noch']

const T3_KASSENARZT_OPEN_EXCLUDE_TERMS = [
  'wahlarzt honorarnote',
  'privatarzt',
  'ärztekammer info',
]

const T4_HANDWERKER_RELIABLE_MATCH_TERMS = [
  'handwerker',
  'installateur',
  'elektriker',
  'fliesenleger',
  'maler',
  'tischler',
  'wer kommt wirklich',
  'zuverlässiger handwerker',
  'zuverlässiger elektriker',
  'kennst wen der kommt',
  'guter installateur',
  'kommt der überhaupt',
  'hat zugesagt und nix',
  'empfehlung handwerker',
  'macht saubere arbeit',
  'günstig und gut',
  'not-installateur',
  'wasserschaden wer kann kommen',
  'klempner',
]

const T4_HANDWERKER_RELIABLE_BOOST_TERMS = ['kommt wirklich', 'zuverlässig', 'empfehlung']

const T4_HANDWERKER_RELIABLE_EXCLUDE_TERMS = [
  // Pfusch/Schwarzarbeit adjacency: a "reliable tradesperson" ask must never
  // be conflated with an off-the-books one -- that category is
  // `excluded_no_auto_match` in the catalogue on purpose (see
  // overnight/05-chat-group-information.md 2.9), never auto-surfaced here.
  'ohne rechnung',
  'schwarz',
  'pfusch',
  'ohne beleg',
  'unter der hand',
]

const T5_CHILDCARE_PLACE_OPEN_MATCH_TERMS = [
  'kindergartenplatz',
  'kiga-platz',
  'betreuungsplatz',
  'tagesmutter',
  'tagesvater',
  'babysitter',
  'babysitterin',
  'wer kann babysitten',
  'platz frei im kindergarten',
  'warteliste kiga',
  'hort',
  'krabbelstube',
  'kennt wer a tagesmutter',
  'verlässliche babysitterin',
  'nachmittagsbetreuung',
  'spontane betreuung',
  'kinderbetreuung gesucht',
  'private tagesmutter',
  'betreuungsplatz frei geworden',
  'kiga wechseln',
]

// "kindergartenplatz" is already an exact matchTerm above; not repeated here.
const T5_CHILDCARE_PLACE_OPEN_BOOST_TERMS = ['frei geworden', 'warteliste']

const T5_CHILDCARE_PLACE_OPEN_EXCLUDE_TERMS = [
  'kindergarten anmeldephase info',
  'wien.gv.at bildung',
]

export const TEMPLATES: QueryTemplate[] = [
  {
    id: 'wot.vienna.housing.flat_pre_listing',
    version: 1,
    category: 'housing',
    title: {
      de: 'Wohnung wird frei (vor Inserat)',
      en: 'Flat coming free (pre-listing)',
    },
    question: {
      de: 'Kennt jemand eine Wohnung, die bald frei wird, bevor sie online inseriert wird?',
      en: 'Does anyone know of a flat coming free soon, before it gets listed online?',
    },
    matchTerms: T1_HOUSING_PRE_LISTING_MATCH_TERMS,
    boostTerms: T1_HOUSING_PRE_LISTING_BOOST_TERMS,
    excludeTerms: T1_HOUSING_PRE_LISTING_EXCLUDE_TERMS,
    minScore: 1,
    // C-03 (2026-09-06): the hardcoded kThreshold: 1 demo-crutch is banned
    // ("must not ship"), replaced with the workspace DEFAULT_K, imported
    // from packages/network-access/src/anonymity.ts. This template can no
    // longer show a hit against a single seeded group chat; that is the
    // accepted cost of closing C-03, not an oversight.
    kThreshold: DEFAULT_K,
    sensitivity: 'high',
    ttlSeconds: 1_209_600, // 14 days (ttl_ms 1209600000 in the catalogue doc)
  },
  {
    id: 'wot.vienna.housing.nachmieter_genossenschaft',
    version: 1,
    category: 'housing',
    title: {
      de: 'Nachmieter für Genossenschafts-/Gemeindewohnung gesucht',
      en: 'Successor tenant wanted for a co-op/municipal flat',
    },
    question: {
      de: 'Kennt jemand eine Genossenschafts- oder Gemeindewohnung, wo bald ein Nachmieter gesucht wird?',
      en: 'Does anyone know of a co-op or municipal flat that will soon need a successor tenant?',
    },
    matchTerms: T2_NACHMIETER_GENOSSENSCHAFT_MATCH_TERMS,
    boostTerms: T2_NACHMIETER_GENOSSENSCHAFT_BOOST_TERMS,
    excludeTerms: T2_NACHMIETER_GENOSSENSCHAFT_EXCLUDE_TERMS,
    // A single generic term (e.g. "warteliste") must not clear this alone;
    // it is a common word that also shows up in unrelated contexts
    // (childcare waiting lists in this very corpus). Require boosted or
    // multi-term confirmation.
    minScore: 2,
    kThreshold: 7, // production default, per catalogue doc section 1 (DEFAULT_K)
    sensitivity: 'high',
    ttlSeconds: 2_592_000, // 30 days
  },
  {
    id: 'wot.vienna.health.kassenarzt_open',
    version: 1,
    category: 'health',
    title: {
      de: 'Kassenarzt/-ärztin nimmt neue Patienten',
      en: 'Statutory-insurance doctor taking new patients',
    },
    question: {
      de: 'Kennt jemand eine Kassenärztin oder einen Kassenarzt, die/der gerade neue Patient*innen aufnimmt?',
      en: 'Does anyone know a statutory-insurance doctor currently accepting new patients?',
    },
    matchTerms: T3_KASSENARZT_OPEN_MATCH_TERMS,
    boostTerms: T3_KASSENARZT_OPEN_BOOST_TERMS,
    excludeTerms: T3_KASSENARZT_OPEN_EXCLUDE_TERMS,
    minScore: 1,
    kThreshold: 7,
    sensitivity: 'medium',
    ttlSeconds: 1_209_600, // 14 days
  },
  {
    id: 'wot.vienna.services.handwerker_reliable',
    version: 1,
    category: 'services',
    title: {
      de: 'Zuverlässiger Handwerker/Handwerkerin',
      en: 'Reliable tradesperson',
    },
    question: {
      de: 'Kennt jemand eine Handwerkerin oder einen Handwerker (z.B. Installateur, Elektriker), die/der wirklich zuverlässig kommt?',
      en: 'Does anyone know a tradesperson (e.g. plumber, electrician) who reliably actually shows up?',
    },
    matchTerms: T4_HANDWERKER_RELIABLE_MATCH_TERMS,
    boostTerms: T4_HANDWERKER_RELIABLE_BOOST_TERMS,
    excludeTerms: T4_HANDWERKER_RELIABLE_EXCLUDE_TERMS,
    minScore: 1,
    kThreshold: 7,
    sensitivity: 'low',
    ttlSeconds: 604_800, // 7 days
  },
  {
    id: 'wot.vienna.childcare.place_open',
    version: 1,
    category: 'childcare',
    title: {
      de: 'Kindergarten- oder Betreuungsplatz wird frei',
      en: 'Childcare place opening up',
    },
    question: {
      de: 'Kennt jemand einen Kindergarten- oder Betreuungsplatz, der gerade frei wird, oder eine Tagesmutter mit freiem Platz?',
      en: 'Does anyone know of a kindergarten or childcare place opening up, or a childminder with a free slot?',
    },
    matchTerms: T5_CHILDCARE_PLACE_OPEN_MATCH_TERMS,
    boostTerms: T5_CHILDCARE_PLACE_OPEN_BOOST_TERMS,
    excludeTerms: T5_CHILDCARE_PLACE_OPEN_EXCLUDE_TERMS,
    minScore: 1,
    kThreshold: 7,
    sensitivity: 'medium',
    ttlSeconds: 2_592_000, // 30 days
  },
]

export function getTemplate(id: string): QueryTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
