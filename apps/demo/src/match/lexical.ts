import type { ChatThread, MatchHit, MatchResult, QueryTemplate } from '../types'
import { splitCompound } from './compound'
import { normalize, normalizeUnfolded, tokenize, tokenizeUnfolded } from './normalize'
import { stem } from './stem'

interface PreparedTerm {
  /** Original, human-readable term as written in the template. */
  raw: string
  /** Folded (ae/oe/ue/ss), punctuation-stripped form. */
  normalized: string
  /** True when the normalized form contains a space -- matched as a phrase
   * against the full normalized message text, per QueryTemplate.matchTerms's
   * own doc comment in types.ts. */
  isPhrase: boolean
  /** Snowball stem of the term, for single-word terms only. Always computed
   * from the UNFOLDED form of the raw term (see normalize.ts's file comment
   * on why stem.ts must never see the already-folded ae/oe/ue variant). */
  singleStem: string | null
}

function prepareTerm(raw: string): PreparedTerm {
  const normalized = normalize(raw)
  const isPhrase = normalized.includes(' ')
  const singleStem = !isPhrase && normalized.length > 0 ? stem(normalizeUnfolded(raw)) : null
  return { raw, normalized, isPhrase, singleStem }
}

interface MessageContext {
  /** Folded, normalized full message text -- phrase terms match here. */
  normalizedText: string
  /** Every token (folded) PLUS every dictionary part any token decomposes
   * into via splitCompound. A single-word term matches directly against
   * this set without needing to be stemmed (e.g. "wohnung" against the
   * "wohnung" piece of "Wohnungssuche"). */
  directCandidates: Set<string>
  /** Snowball stem of every token (computed from the UNFOLDED token, per
   * stem.ts's contract). A single-word term's own stem matches against this
   * set (e.g. template term "nachmieter" stems to "nachmiet", which also
   * catches a message token "Nachmieterin" -> stem "nachmiet"). */
  tokenStems: Set<string>
}

function buildMessageContext(text: string): MessageContext {
  const normalizedText = normalize(text)
  const foldedTokens = tokenize(text)
  const unfoldedTokens = tokenizeUnfolded(text)

  const directCandidates = new Set<string>()
  const tokenStems = new Set<string>()

  foldedTokens.forEach((folded, i) => {
    directCandidates.add(folded)
    for (const part of splitCompound(folded)) directCandidates.add(part)
    const unfolded = unfoldedTokens[i] ?? folded
    tokenStems.add(stem(unfolded))
  })

  return { normalizedText, directCandidates, tokenStems }
}

function termFires(term: PreparedTerm, ctx: MessageContext): boolean {
  if (term.normalized.length === 0) return false
  if (term.isPhrase) {
    return ctx.normalizedText.includes(term.normalized)
  }
  if (ctx.directCandidates.has(term.normalized)) return true
  if (term.singleStem !== null && ctx.tokenStems.has(term.singleStem)) return true
  return false
}

/**
 * Only hits scoring at least this fraction of the top hit count toward the
 * anonymity floor. Keeps incidental matches from buying down the protection.
 */
const K_RELEVANCE_BAND = 0.5

const MATCH_TERM_WEIGHT = 1
const BOOST_TERM_WEIGHT = 2

/**
 * Score every message of every `included` thread against `template` and
 * return the hits, sorted deterministically by score (desc), then threadId,
 * then messageIndex.
 *
 * Privacy invariant: threads with `included !== true` are never read here --
 * not filtered out afterwards, never even passed into the scoring loop. See
 * test/match_lexical.test.ts's "a 1-on-1 thread's content can never appear
 * in a hit" test.
 *
 * Exclude terms are a HARD VETO, checked before any match/boost score is
 * computed, and checked against the same normalized-text / stemmed /
 * compound-split candidates as match/boost terms (not just literal
 * substring-of-raw-text) -- this matters because the compound splitter can
 * turn a decoy word into a real dictionary part (e.g. "Ferienwohnung" splits
 * into ["ferien", ...] under a broader dictionary), so the veto has to see
 * exactly what the scorer sees, not a narrower view of the message.
 */
export function matchTemplate(
  template: QueryTemplate,
  threads: ChatThread[],
  /**
   * "Test mode: single-holder matches allowed" (state.ts's
   * `DeviceState.testModeSingleHolderMatches`, OFF by default). Read ONLY
   * inside the owner-declared branch below -- never by the
   * `distinctAuthors >= template.kThreshold` branch that protects a real
   * third party's chat message. See this function's own bypass comment
   * below for the honestly-stated finding that this currently changes no
   * outcome under today's data model.
   */
  testModeSingleHolderMatches = false,
): MatchResult {
  const matchTerms = template.matchTerms.map(prepareTerm)
  const boostTerms = template.boostTerms.map(prepareTerm)
  const excludeTerms = template.excludeTerms.map(prepareTerm)

  const hits: MatchHit[] = []

  for (const thread of threads) {
    if (thread.included !== true) continue

    thread.messages.forEach((message, messageIndex) => {
      if (message.system) return
      if (!message.text || message.text.trim().length === 0) return

      const ctx = buildMessageContext(message.text)

      for (const excludeTerm of excludeTerms) {
        if (termFires(excludeTerm, ctx)) return
      }

      let score = 0
      const firedTerms: string[] = []

      for (const term of matchTerms) {
        if (termFires(term, ctx)) {
          score += MATCH_TERM_WEIGHT
          firedTerms.push(term.raw)
        }
      }
      for (const term of boostTerms) {
        if (termFires(term, ctx)) {
          score += BOOST_TERM_WEIGHT
          firedTerms.push(term.raw)
        }
      }

      if (score > 0 && score >= template.minScore) {
        hits.push({
          threadId: thread.id,
          threadTitle: thread.title,
          messageIndex,
          message,
          score,
          terms: firedTerms,
          source: thread.source,
        })
      }
    })
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.threadId !== b.threadId) return a.threadId < b.threadId ? -1 : 1
    return a.messageIndex - b.messageIndex
  })

  // The anonymity floor counts DISTINCT AUTHORS, never messages.
  //
  // Counting messages does not anonymise anyone: seven messages from one
  // neighbour clear a floor of seven, and every one of them is hers. The floor
  // exists so that what is offered cannot be traced back to a single person,
  // which only distinct voices can provide.
  //
  // Only hits at or above the relevance band count toward the floor. Otherwise
  // incidental noise, which a template with a low minScore produces plenty of,
  // silently buys down the protection.
  const top = hits.length ? hits[0].score : 0
  const floorBand = top * K_RELEVANCE_BAND
  const bandHits = hits.filter((h) => h.score >= floorBand)
  const authors = new Set<string>()
  for (const h of bandHits) authors.add(h.message.author.trim().toLowerCase())
  const distinctAuthors = authors.size

  // B-08 (2026-09-06): owner-declared matches bypass the floor.
  //
  // The floor exists to protect a THIRD PARTY whose chat message might
  // identify them -- see the comment above. An inventory entry or
  // second-brain note (thread.source === 'self', state.ts's
  // inventoryThreads()/main.ts's secondBrainThread()) has no third party:
  // the author IS the device owner, the person about to be asked whether to
  // share their own single declared item through the ordinary consent
  // ceremony. Requiring distinctAuthors >= kThreshold before that person is
  // even allowed to be ASKED conflates "protect someone else's anonymity"
  // with "protect the holder from being asked" -- two different objects.
  //
  // Bypass fires ONLY when every relevance-band hit is owner-declared. A
  // single chat-authored hit mixed in with owner-declared ones still means a
  // real third party is in the band, so the ordinary floor applies unchanged
  // -- this is the one branch below that changes aboveThreshold's semantics;
  // everything else in this function is untouched.
  const allOwnerDeclared = bandHits.length > 0 && bandHits.every((h) => h.source === 'self')

  // `testModeSingleHolderMatches` (state.ts, k-standardize pass 2026-09-06)
  // is scoped to widen ONLY this owner-declared branch, never the
  // `distinctAuthors >= template.kThreshold` branch below that protects a
  // real third party's chat message. Honestly stated finding: since an
  // owner-declared hit's author is always `s.me.displayName` (state.ts's
  // inventoryThreads()/main.ts's secondBrainThread()), `allOwnerDeclared`
  // above already bypasses unconditionally whenever this flag's own
  // condition (bandHits.length > 0 && all self-sourced) would also hold --
  // so `singleHolderTestModeBypass` is provably identical to
  // `allOwnerDeclared` under today's data model and toggling the flag
  // changes no gating outcome yet. It exists as the named, explicit
  // override surface match/accommodation.ts's own comment already asks for
  // ("bigger-corpus-or-explicit-override fix"), for a future corpus where
  // an owner-declared entry's hits could plausibly attribute to more than
  // one author. See docs/k-parameters.md's k1 section for the open ❗ on
  // whether "single-holder" should also ever cover a holder's own CHAT
  // message (author === s.me.displayName in a real thread) -- this flag
  // deliberately does NOT do that; a chat-authored hit is excluded by the
  // `every((h) => h.source === 'self')` check regardless of the flag.
  const singleHolderTestModeBypass =
    testModeSingleHolderMatches && bandHits.length > 0 && bandHits.every((h) => h.source === 'self')
  const aboveThreshold = allOwnerDeclared || singleHolderTestModeBypass ? true : distinctAuthors >= template.kThreshold

  return { hits, distinctAuthors, aboveThreshold }
}
