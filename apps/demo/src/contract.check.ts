/**
 * Integration contract guard.
 *
 * This file exists only to fail the typecheck loudly and precisely if any
 * module main.ts depends on drifts from the agreed signature. It has no runtime
 * role. Three separate agents built the parse, match and gate modules in
 * parallel against a prose spec; this is the machine-checkable version of that
 * spec, so a mismatch surfaces as one named line rather than as a pile of
 * errors inside main.ts.
 *
 * If you are here because this file is red: fix the MODULE to match, not this
 * file, unless the module's shape is genuinely better and you also update
 * main.ts.
 */

import type {
  ChatThread,
  QueryTemplate,
  MatchResult,
  QueryEnvelope,
  AnswerEnvelope,
  ChatEnvelope, PingEnvelope, ConnectEnvelope, ConnectAckEnvelope, AskAgainEnvelope,
  DecodedAnswer,
  LocalOutcome,
} from './types'

import { detectAndParse } from './parse/index'
import { matchTemplate } from './match/lexical'
import { TEMPLATES, getTemplate } from './data/templates'
import { decide, interpret, settleAt, GATE_BUDGET_MS } from './gate'
import { derivePairKey, randomId } from './crypto'
import { encodeForQr, decodeFromQr } from './wire'

/* --- parse ------------------------------------------------------------- */
type ParseFn = (filename: string, raw: string) => ChatThread
const _parse: ParseFn = detectAndParse

/* --- match ------------------------------------------------------------- */
type MatchFn = (template: QueryTemplate, threads: ChatThread[]) => MatchResult
const _match: MatchFn = matchTemplate

/* --- templates --------------------------------------------------------- */
const _templates: QueryTemplate[] = TEMPLATES
type GetTemplateFn = (id: string) => QueryTemplate | undefined
const _getTemplate: GetTemplateFn = getTemplate

/* --- gate -------------------------------------------------------------- */
type DecideFn = (input: {
  query: QueryEnvelope
  template: QueryTemplate
  match: MatchResult
  consent: boolean
  blocked: boolean
  key: CryptoKey
}) => Promise<{ outcome: LocalOutcome; envelope: AnswerEnvelope }>
const _decide: DecideFn = decide

type InterpretFn = (env: AnswerEnvelope, key: CryptoKey) => Promise<DecodedAnswer>
const _interpret: InterpretFn = interpret

type SettleFn = (t0: number, budgetMs: number) => Promise<void>
const _settle: SettleFn = settleAt

const _budget: number = GATE_BUDGET_MS

/* --- crypto ------------------------------------------------------------ */
type DeriveFn = (nonceA: string, nonceB: string) => Promise<CryptoKey>
const _derive: DeriveFn = derivePairKey

type RandomIdFn = (len: number) => string
const _randomId: RandomIdFn = randomId

/* --- wire -------------------------------------------------------------- */
type EncodeFn = (env: ConnectEnvelope | QueryEnvelope | AnswerEnvelope | ChatEnvelope | PingEnvelope | ConnectAckEnvelope | AskAgainEnvelope) => string
const _encode: EncodeFn = encodeForQr

// Widened for the chat, ping and connect-ack envelopes (types.ts), and for TrustWeb wave 6i's ask-again. Kept as an
// explicit union rather than importing wire.ts's `Envelope` alias, so that
// adding a new envelope type still has to be acknowledged HERE, which is the
// whole point of this file.
type DecodeFn = (s: string) => ConnectEnvelope | QueryEnvelope | AnswerEnvelope | ChatEnvelope | PingEnvelope | ConnectAckEnvelope | AskAgainEnvelope | null
const _decode: DecodeFn = decodeFromQr

/** Referenced so `noUnusedLocals` does not hide a drift by complaining first. */
export const CONTRACT_OK = [
  _parse, _match, _templates, _getTemplate,
  _decide, _interpret, _settle, _budget,
  _derive, _randomId, _encode, _decode,
].length
