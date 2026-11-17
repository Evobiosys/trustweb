/**
 * Wire format: compact JSON serialisation of this app's envelope types
 * (`Envelope` below). Despite the name, `decodeFromQr` no longer only reads
 * camera input -- relay.ts's `decryptEnvelope` also hands it plaintext
 * recovered from an encrypted relay wire, and connect_link.ts hands it a
 * `connect-ack` payload that travelled the relay UNencrypted (see that
 * envelope's own doc comment in types.ts for why that is safe). Either way
 * it stays the untrusted-input boundary of the whole demo: it must never
 * throw, and it must reject anything that doesn't look exactly like one of
 * the known envelope shapes (wrong `v`, wrong `t`, missing or mistyped
 * fields).
 */

import type { AnswerEnvelope, AskAgainEnvelope, HideReportEnvelope, ChatEnvelope, ChatRe, ConnectAckEnvelope, ConnectEnvelope, DevicesEnvelope, EventEnvelope, HostEnvelope, PingEnvelope, QueryEnvelope, ReaskRef } from './types'
import { ANSWER_WINDOW_MS_MAX, DEVICES_MAX, EVENT_LINK_MAX, FREE_TEXT_MAX_LEN, HOST_KINDS, HOST_MAX_JSON, isJpegDataUrl, HOP_CAP, HOPS_UNBOUNDED, QID_RE, RE_TEXT_MAX, ROOT_RE, SEEN_ID_RE, SEEN_MAX, VIA_NAME_MAX, WIRE_VERSION, HIDE_BLOB_MAX_JSON, HIDE_KEY_RE, HIDE_REPORT_MAX_JSON } from './types'

/** Free text is the one unbounded field on the wire, so it gets a bound. */
export const CHAT_MAX_LEN = 500

export type Envelope = ConnectEnvelope | QueryEnvelope | AnswerEnvelope | ChatEnvelope | PingEnvelope | ConnectAckEnvelope | AskAgainEnvelope | DevicesEnvelope | HostEnvelope | EventEnvelope | HideReportEnvelope

/** JSON-serialise an envelope for a QR code. */
export function encodeForQr(env: Envelope): string {
  return JSON.stringify(env)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isIdentity(v: unknown): v is { id: string; displayName: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    isNonEmptyString((v as Record<string, unknown>).id) &&
    typeof (v as Record<string, unknown>).displayName === 'string'
  )
}

function parseConnect(o: Record<string, unknown>): ConnectEnvelope | null {
  if (!isIdentity(o.from)) return null
  if (!isNonEmptyString(o.nonce)) return null
  // `did` is OPTIONAL (relay mode only, see types.ts's doc comment) -- absent
  // entirely is fine (a demo-1/qr-mode code). But if the KEY is present at
  // all, it must be a non-empty string or the whole envelope is rejected,
  // same strictness as every other field here: a malformed-but-present field
  // is a sign of tampering or a version skew, not something to silently drop.
  if ('did' in o && !isNonEmptyString(o.did)) return null
  const did = isNonEmptyString(o.did) ? o.did : undefined
  return { v: WIRE_VERSION, t: 'connect', from: o.from, nonce: o.nonce, ...(did ? { did } : {}) }
}

function parseQuery(o: Record<string, unknown>): QueryEnvelope | null {
  if (!isIdentity(o.from)) return null
  if (!isNonEmptyString(o.templateId)) return null
  if (typeof o.templateVersion !== 'number' || !Number.isFinite(o.templateVersion)) return null
  if (!isNonEmptyString(o.qid)) return null
  if (typeof o.issuedAt !== 'number' || !Number.isFinite(o.issuedAt)) return null
  // `freeText` (the "Ins Netzwerk rufen" ask) is OPTIONAL, same convention
  // as ConnectEnvelope.did above: absent is fine (every existing templated
  // query), but a present-and-malformed field rejects the whole envelope
  // rather than being silently dropped -- and it gets the same length bound
  // ChatEnvelope.text gets below, at this same untrusted-input boundary.
  if ('freeText' in o) {
    if (!isNonEmptyString(o.freeText)) return null
    if (o.freeText.length > FREE_TEXT_MAX_LEN) return null
  }
  const freeText = isNonEmptyString(o.freeText) ? o.freeText : undefined
  // `relayed` (demo 21, types.ts's QueryEnvelope.relayed doc comment): same
  // strictness convention as `did`/`freeText` above -- ABSENT is fine (every
  // ordinary query, including demo 21's own first-hop ask), but a PRESENT
  // value that is not exactly `true` rejects the whole envelope rather than
  // being coerced or silently dropped. `false` is deliberately not accepted
  // either: this field only ever means one thing when present at all.
  if ('relayed' in o && o.relayed !== true) return null
  const relayed = o.relayed === true ? (true as const) : undefined
  // `escalated` (cooldown.ts's "this is very important", types.ts's
  // QueryEnvelope.escalated doc comment): same strictness convention as
  // `relayed` immediately above -- absent is fine, present-and-not-`true`
  // rejects the whole envelope.
  if ('escalated' in o && o.escalated !== true) return null
  const escalated = o.escalated === true ? (true as const) : undefined
  // `direct` (TrustWeb wave 3, "ask only my direct contacts"; types.ts's
  // QueryEnvelope.direct doc comment): the same convention once more.
  if ('direct' in o && o.direct !== true) return null
  const direct = o.direct === true ? (true as const) : undefined
  // TrustWeb wave 33 (types.ts QueryEnvelope.kind/target): both or neither; a present-and-malformed pair rejects the envelope.
  // Wave 44: kind 'know' stands alone (no target).
  if ('kind' in o || 'target' in o) {
    if (o.kind === 'know') { if ('target' in o) return null }
    else if ((o.kind !== 'intro' && o.kind !== 'show') || !isNonEmptyString(o.target) || o.target.length > 80) return null
  }
  const intro = (o.kind === 'intro' || o.kind === 'show') && isNonEmptyString(o.target) ? { kind: o.kind as 'intro' | 'show', target: o.target } : o.kind === 'know' ? { kind: 'know' as const } : undefined
  // Wave 44: askedNames, 1..ASKED_NAMES_MAX display names (the same strictness: present-and-malformed rejects the envelope).
  if ('askedNames' in o && !(Array.isArray(o.askedNames) && o.askedNames.length >= 1 && o.askedNames.length <= 50 && o.askedNames.every((n) => isNonEmptyString(n) && n.length <= 80))) return null
  const askedNames = Array.isArray(o.askedNames) ? { askedNames: o.askedNames as string[] } : undefined
  const hops = parseHopFields(o)
  if (hops === null) return null
  const hide = parseHideFields(o) // wave44b hide-from-crypto
  if (hide === null) return null
  // TrustWeb wave 6i (types.ts QueryEnvelope.reask): the same strictness once more.
  let reask: ReaskRef | undefined
  if ('reask' in o) {
    const r = parseReask(o.reask)
    if (r === null) return null
    reask = r
  }
  return {
    v: WIRE_VERSION,
    t: 'query',
    from: o.from,
    templateId: o.templateId,
    templateVersion: o.templateVersion,
    qid: o.qid,
    issuedAt: o.issuedAt,
    ...(freeText ? { freeText } : {}),
    ...(relayed ? { relayed } : {}),
    ...(escalated ? { escalated } : {}),
    ...(direct ? { direct } : {}),
    ...(intro ?? {}),
    ...(askedNames ?? {}),
    ...hops,
    ...(reask ? { reask } : {}),
    ...hide,
  }
}

// ----- BEGIN TrustWeb wave 6i: an earlier ask asked again, the ask a chat message answers, "ask me again" -----
function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** QueryEnvelope.reask: exactly {originalQid, originalAt}, both well formed; anything else is null (the caller rejects the envelope). */
function parseReask(v: unknown): ReaskRef | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (typeof r.originalQid !== 'string' || !QID_RE.test(r.originalQid) || !isTime(r.originalAt)) return null
  return { originalQid: r.originalQid, originalAt: r.originalAt }
}

/** ChatEnvelope.re: {qid, text (1..RE_TEXT_MAX), at}; anything else is null (the caller rejects the envelope). */
function parseChatRe(v: unknown): ChatRe | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (typeof r.qid !== 'string' || !QID_RE.test(r.qid) || !isTime(r.at)) return null
  if (!isNonEmptyString(r.text) || r.text.length > RE_TEXT_MAX) return null
  return { qid: r.qid, text: r.text, at: r.at }
}

function parseAskAgain(): AskAgainEnvelope {
  // Nothing but the type: whatever else a sender put in is not read.
  return { v: WIRE_VERSION, t: 'ask-again' }
}
// ----- END TrustWeb wave 6i -----

// ----- BEGIN TrustWeb wave 43c (connect-extras): the event envelope (types.ts EventEnvelope) -----
/** Exactly one of `want` (an event id) or `link` (bounded text); anything else is null. Nothing else a sender put in is read. */
function parseEvent(o: Record<string, unknown>): EventEnvelope | null {
  const hasWant = 'want' in o
  const hasLink = 'link' in o
  if ('os' in o) return hasWant || hasLink ? null : parseOpenSpace(o.os)
  if ('seen' in o) return hasWant || hasLink ? null : parseSeen(o.seen) // wave44c seen-through
  if (hasWant === hasLink) return null
  if (hasWant) return typeof o.want === 'string' && QID_RE.test(o.want) ? { v: WIRE_VERSION, t: 'event', want: o.want } : null
  if (!isNonEmptyString(o.link) || o.link.length > EVENT_LINK_MAX) return null
  const show = o.show === 'open' || o.show === 'discoverable' || o.show === 'off' ? o.show : undefined   // wave 44: a value outside the three is dropped
  return { v: WIRE_VERSION, t: 'event', link: o.link, ...(show ? { show } : {}), ...(o.announce === true ? { announce: true as const } : {}) }
}

// ----- BEGIN TrustWeb wave 44 (steer-open-space): the open-space schedule (types.ts EventEnvelope.os) -----
const OS_ACTS_MAX = 60
const OS_BYTES_MAX = 24_000
/** An event id and at most 60 activities in at most 24 KB; each activity is checked by the receiver (open_space.ts), not here. */
function parseOpenSpace(v: unknown): EventEnvelope | null {
  if (typeof v !== 'object' || v === null) return null
  const os = v as Record<string, unknown>
  if (typeof os.id !== 'string' || !QID_RE.test(os.id) || !Array.isArray(os.acts) || os.acts.length > OS_ACTS_MAX || JSON.stringify(os.acts).length > OS_BYTES_MAX) return null
  return { v: WIRE_VERSION, t: 'event', os: { id: os.id, ...(os.open === true ? { open: true as const } : {}), acts: os.acts } }
}
// ----- END TrustWeb wave 44 -----

/* wave44c seen-through */
/** An event id, the consent flag, and a name only with a yes (1..VIA_NAME_MAX); a name without a yes rejects the envelope. */
function parseSeen(v: unknown): EventEnvelope | null {
  if (typeof v !== 'object' || v === null) return null
  const x = v as Record<string, unknown>
  if (typeof x.id !== 'string' || !QID_RE.test(x.id) || typeof x.shown !== 'boolean') return null
  if ('who' in x && (!x.shown || !isNonEmptyString(x.who) || x.who.length > VIA_NAME_MAX)) return null
  return { v: WIRE_VERSION, t: 'event', seen: { id: x.id, shown: x.shown, ...(x.shown && typeof x.who === 'string' ? { who: x.who } : {}) } }
}

// ----- BEGIN TrustWeb wave 6 (U1): the hop fields (types.ts QueryEnvelope) -----
type HopFields = Pick<QueryEnvelope, 'maxHops' | 'hop' | 'root' | 'seen' | 'via' | 'door' | 'answerWindowMs'>

function isIntIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
}

function isStringList(v: unknown, max: number, ok: (s: string) => boolean): v is string[] {
  return Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && ok(x))
}

/**
 * The optional hop fields, each with the same strictness as `direct` above:
 * absent is fine, present-and-malformed rejects the whole envelope (null).
 * Returns only the fields that are present, so an ask without them parses to
 * exactly the shape it had before wave 6.
 */
function parseHopFields(o: Record<string, unknown>): HopFields | null {
  const out: HopFields = {}
  if ('maxHops' in o) {
    if (o.maxHops !== HOPS_UNBOUNDED && !isIntIn(o.maxHops, 1, HOP_CAP)) return null
    out.maxHops = o.maxHops as number
  }
  if ('hop' in o) {
    if (!isIntIn(o.hop, 0, HOP_CAP - 1)) return null
    out.hop = o.hop
  }
  if ('root' in o) {
    if (typeof o.root !== 'string' || !ROOT_RE.test(o.root)) return null
    out.root = o.root
  }
  if ('seen' in o) {
    if (!isStringList(o.seen, SEEN_MAX, (x) => SEEN_ID_RE.test(x))) return null
    out.seen = [...o.seen]
  }
  if ('via' in o) {
    if (!isStringList(o.via, HOP_CAP, (x) => x.length > 0 && x.length <= VIA_NAME_MAX)) return null
    out.via = [...o.via]
  }
  if ('door' in o) {
    if (o.door !== true) return null
    out.door = true
  }
  // TrustWeb wave 6h: the asker's answer window (types.ts QueryEnvelope.answerWindowMs), the same strictness.
  if ('answerWindowMs' in o) {
    if (!isIntIn(o.answerWindowMs, 1, ANSWER_WINDOW_MS_MAX)) return null
    out.answerWindowMs = o.answerWindowMs
  }
  return out
}
// ----- END TrustWeb wave 6 (U1) -----

function parseAnswer(o: Record<string, unknown>): AnswerEnvelope | null {
  if (!isNonEmptyString(o.qid)) return null
  if (typeof o.body !== 'string') return null
  return { v: WIRE_VERSION, t: 'answer', qid: o.qid, body: o.body }
}

function parseChat(o: Record<string, unknown>): ChatEnvelope | null {
  if (!isIdentity(o.from)) return null
  // An empty message is not a message. A caller that wants to say nothing can
  // simply not send.
  if (!isNonEmptyString(o.text)) return null
  // Bound it here, at the boundary, rather than trusting a sender's restraint:
  // this is the one envelope whose content is free text.
  if (o.text.length > CHAT_MAX_LEN) return null
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null
  // TrustWeb wave 6i: the ask this message answers. Absent is fine; present-and-malformed rejects the envelope (types.ts ChatEnvelope.re).
  let re: ChatRe | undefined
  if ('re' in o) {
    const r = parseChatRe(o.re)
    if (r === null) return null
    re = r
  }
  // Wave 19: the profile picture, strict like `re`: present and not a small JPEG data URL rejects the envelope.
  if ('pic' in o && !isJpegDataUrl(o.pic)) return null
  return { v: WIRE_VERSION, t: 'chat', from: o.from, text: o.text, ts: o.ts, ...(re ? { re } : {}), ...('pic' in o ? { pic: o.pic as string } : {}) }
}

/** TrustWeb wave 43c: 1..DEVICES_MAX did:peer:2 strings of sane size; anything else is null. */
function parseDevices(o: Record<string, unknown>): DevicesEnvelope | null {
  const d = o.dids
  if (!Array.isArray(d) || d.length < 1 || d.length > DEVICES_MAX) return null
  if (!d.every((x) => typeof x === 'string' && /^did:peer:2\.[A-Za-z0-9.:_-]{20,1500}$/.test(x))) return null
  return { v: WIRE_VERSION, t: 'devices', dids: d as string[] }
}

function parsePing(o: Record<string, unknown>): PingEnvelope | null {
  if (!isNonEmptyString(o.id)) return null
  if (typeof o.back !== 'boolean') return null
  return { v: WIRE_VERSION, t: 'ping', id: o.id, back: o.back }
}

function parseConnectAck(o: Record<string, unknown>): ConnectAckEnvelope | null {
  if (!isIdentity(o.from)) return null
  // Unlike ConnectEnvelope.did (optional there), `did` is REQUIRED here --
  // see types.ts's doc comment on ConnectAckEnvelope.
  if (!isNonEmptyString(o.did)) return null
  return { v: WIRE_VERSION, t: 'connect-ack', from: o.from, did: o.did, ...(o.reachOut === true ? { reachOut: true as const } : {}) }
}

// ----- BEGIN TrustWeb wave 43c (social-hosting): types.ts HostEnvelope -----
function parseHost(o: Record<string, unknown>): HostEnvelope | null {
  const m = o.m
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null
  const k = (m as Record<string, unknown>).k
  if (!HOST_KINDS.includes(k as (typeof HOST_KINDS)[number]) || JSON.stringify(m).length > HOST_MAX_JSON) return null
  return { v: WIRE_VERSION, t: 'host', m: m as HostEnvelope['m'] }
}
// ----- END TrustWeb wave 43c -----

/**
 * Parse a QR payload back into an envelope. Returns `null` on anything
 * malformed -- truncated JSON, wrong version, wrong/missing `t`, wrong field
 * types -- never throws.
 */
export function decodeFromQr(s: string): Envelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(s)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>

  if (o.v !== WIRE_VERSION) return null

  switch (o.t) {
    case 'connect':
      return parseConnect(o)
    case 'query':
      return parseQuery(o)
    case 'answer':
      return parseAnswer(o)
    case 'chat':
      return parseChat(o)
    case 'ping':
      return parsePing(o)
    case 'connect-ack':
      return parseConnectAck(o)
    case 'ask-again':
      return parseAskAgain()
    case 'devices':
      return parseDevices(o)
    case 'host':
      return parseHost(o)
    case 'event':
      return parseEvent(o)
    case 'hide-report':
      return parseHideReport(o)
    default:
      return null
  }
}

/* wave44b hide-from-crypto */
const isSmallObject = (v: unknown, max: number): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && JSON.stringify(v).length <= max

/** QueryEnvelope.hx / hk: absent is fine; present-and-malformed or too large rejects the envelope. The blob itself is checked by the receiver. */
function parseHideFields(o: Record<string, unknown>): Pick<QueryEnvelope, 'hx' | 'hk'> | null {
  const out: Pick<QueryEnvelope, 'hx' | 'hk'> = {}
  if ('hx' in o) {
    if (!isSmallObject(o.hx, HIDE_BLOB_MAX_JSON)) return null
    out.hx = o.hx
  }
  if ('hk' in o) {
    if (typeof o.hk !== 'string' || !HIDE_KEY_RE.test(o.hk)) return null
    out.hk = o.hk
  }
  return out
}

function parseHideReport(o: Record<string, unknown>): HideReportEnvelope | null {
  if (typeof o.qid !== 'string' || !QID_RE.test(o.qid) || !isSmallObject(o.rep, HIDE_REPORT_MAX_JSON)) return null
  return { v: WIRE_VERSION, t: 'hide-report', qid: o.qid, rep: o.rep }
}
