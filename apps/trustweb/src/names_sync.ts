/**
 * The names a connect code holds on our server (wave 6e; services contract section 10.9, the pin P1 of wave 6e): ONE primary name plus up
 * to two aliases, all reaching the same code through /who/<name>. The phone talks to the one route it always had, POST /name, and sends
 * exactly one intent per call:
 *   READ     {code, secret}                     the names, changing nothing (how the app learns names the operator granted)
 *   CLAIM    {code, secret, name}               sets the primary          {..., alias: true} adds an alias
 *   RELEASE  {code, secret, release: "<name>"}  frees that one name (releasing the primary promotes the first alias)
 * Every 200 answers {"name": "<primary or empty>", "aliases": ["..."]}; a 409 names its reason: name_taken, reserved, name_locked,
 * too_many_names. A LOCKED name (reserved and held by this code: the operator granted it) can neither be released nor replaced from the
 * app. Every 200 carries `locked` (contract 10.9, E1's correction of the pin): the held names that are reserved right now; it is drawn
 * as the lock mark and hides Release, never a hardcoded list. An older answer without it falls back to what a 409 name_locked taught.
 *
 * Pure of DOM and strings; fetch, clock and the record store are injected. Never throws. Older servers (wave 6b) answer a READ with 400
 * and know no aliases: the phone then keeps what its record holds.
 */
import {
  CONNECT_CODE_RE, ClaimError, MAX_ALIASES, MAX_NAMES, NAME_RE, canRegister, field, postTo, readConnectRecord, readNameList,
} from './connect_code'
import type { ConnectClientDeps, ConnectKeeper, ConnectRecord } from './connect_code'
import { ConnectError } from './connect_code'

/** The names the phone shows and keeps: primary ('' when none), aliases in the server's order, and the ones known to be locked. */
export interface NamesState {
  name: string
  aliases: string[]
  locked: string[]
}

export const NO_NAMES: NamesState = { name: '', aliases: [], locked: [] }

/** Every name the code holds, primary first. */
export function heldNames(n: NamesState): string[] {
  return [...(n.name ? [n.name] : []), ...n.aliases]
}

export function namesOf(record: ConnectRecord | null): NamesState {
  if (!record) return { ...NO_NAMES, aliases: [], locked: [] }
  return { name: record.name ?? '', aliases: [...(record.aliases ?? [])], locked: [...(record.lockedNames ?? [])] }
}

/** The record with these names written into it (empty parts are removed, locked is cut down to the names still held). */
export function withNames(record: ConnectRecord, n: NamesState): ConnectRecord {
  const { name: _n, aliases: _a, lockedNames: _l, ...rest } = record
  const locked = n.locked.filter((x) => heldNames(n).includes(x))
  return { ...rest, ...(n.name ? { name: n.name } : {}), ...(n.aliases.length ? { aliases: n.aliases } : {}), ...(locked.length ? { lockedNames: locked } : {}) }
}

export function isLocked(n: NamesState, name: string): boolean {
  return n.locked.includes(name)
}

// ---------------------------------------------------------------------------
// the three intents
// ---------------------------------------------------------------------------

export type NameIntent =
  | { kind: 'read' }
  | { kind: 'claim'; name: string; alias: boolean }
  | { kind: 'release'; name: string }

/** The JSON body of one intent: exactly one of read / claim / release. */
export function bodyOf(record: ConnectRecord, intent: NameIntent): string {
  const auth = { code: record.code, secret: record.secret }
  switch (intent.kind) {
    case 'read': return JSON.stringify(auth)
    case 'claim': return JSON.stringify({ ...auth, name: intent.name, ...(intent.alias ? { alias: true } : {}) })
    case 'release': return JSON.stringify({ ...auth, release: intent.name })
  }
}

/** A name this client will send: a valid name that does not look like a code. */
export function isSendableName(name: string): boolean {
  return NAME_RE.test(name) && !CONNECT_CODE_RE.test(name)
}

/** What the person typed, as the server wants it: no leading "@", lowercase, trimmed. */
export function cleanName(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/**
 * A 200 answer, checked: {name, aliases} with valid names, the primary not repeated among the aliases, at most three in all; a `locked`
 * array is read when present. null when it is not that shape (the phone then keeps what it has).
 */
export function readNamesAnswer(json: unknown, prior: NamesState): NamesState | null {
  const name = field(json, 'name')
  if (typeof name !== 'string' || (name !== '' && !isSendableName(name))) return null
  const rawAliases = field(json, 'aliases')
  if (rawAliases !== undefined && !Array.isArray(rawAliases)) return null
  // A server never holds more than two aliases: a longer list is no answer this app understands.
  const aliases = readNameList(rawAliases ?? [], MAX_NAMES, name ? [name] : [])
  if (aliases.length > MAX_ALIASES) return null
  const held = [...(name ? [name] : []), ...aliases]
  // Contract 10.9: `locked` lists the held names that are reserved right now, so it is authoritative when present. An older answer has none:
  // what a 409 name_locked taught stays, for the names still held.
  const rawLocked = field(json, 'locked')
  const locked = Array.isArray(rawLocked)
    ? readNameList(rawLocked, MAX_NAMES).filter((x) => held.includes(x))
    : prior.locked.filter((x) => held.includes(x))
  return { name, aliases, locked }
}

/** Does the answer show what the intent asked for? (A claim must hold, a release must be gone; a read has nothing to show.) */
export function answerMatches(intent: NameIntent, names: NamesState): boolean {
  switch (intent.kind) {
    case 'read': return true
    case 'claim': return intent.alias ? heldNames(names).includes(intent.name) : names.name === intent.name
    case 'release': return !heldNames(names).includes(intent.name)
  }
}

export type NamesOutcome = { ok: true; names: NamesState } | { ok: false; error: ClaimError; names?: NamesState }

function errorFor(status: number, json: unknown): ClaimError {
  if (status === 409) {
    switch (field(json, 'error')) {
      case 'reserved': return ClaimError.Reserved
      case 'name_locked': return ClaimError.NameLocked
      case 'too_many_names': return ClaimError.TooManyNames
      default: return ClaimError.Taken
    }
  }
  if (status === 403) return ClaimError.Forgotten
  if (status === 429) return ClaimError.RateLimited
  if (status === 400) return ClaimError.BadName
  return ClaimError.Server
}

/**
 * What a refusal teaches about locked names: a release that came back name_locked names the locked one; a plain primary claim that came
 * back name_locked means the primary this phone holds is locked.
 */
function lockedBy(intent: NameIntent, prior: NamesState): string | null {
  if (intent.kind === 'release') return intent.name
  if (intent.kind === 'claim' && !intent.alias && prior.name) return prior.name
  return null
}

/** One call to POST /name. Never throws. */
export async function callNames(deps: ConnectClientDeps, record: ConnectRecord, intent: NameIntent): Promise<NamesOutcome> {
  if (!canRegister(deps.origin)) return { ok: false, error: ClaimError.Network }
  if ((intent.kind === 'claim' || intent.kind === 'release') && !isSendableName(intent.name)) return { ok: false, error: ClaimError.BadName }
  const prior = namesOf(record)
  const res = await postTo(deps, '/name', bodyOf(record, intent))
  if (res === ConnectError.Network) return { ok: false, error: ClaimError.Network }
  if (res.status === 200) {
    const names = readNamesAnswer(res.json, prior)
    return names && answerMatches(intent, names) ? { ok: true, names } : { ok: false, error: ClaimError.Server }
  }
  const error = errorFor(res.status, res.json)
  if (error === ClaimError.NameLocked) {
    const locked = lockedBy(intent, prior)
    if (locked && heldNames(prior).includes(locked)) return { ok: false, error, names: { ...prior, locked: [...new Set([...prior.locked, locked])] } }
  }
  return { ok: false, error }
}

// ---------------------------------------------------------------------------
// the phone's side: one object per visit
// ---------------------------------------------------------------------------

/** A READ asks again no sooner than this (Meet opened and closed again and again must not hit the server's budget). */
export const NAMES_READ_GAP_MS = 30_000

export interface NamesSyncDeps extends ConnectClientDeps {
  load: () => unknown
  store: (record: ConnectRecord) => void
  /** The registration keeper: the names calls share its 429 cooldown (one budget on the server). */
  keeper: Pick<ConnectKeeper, 'coolingDown' | 'noteRateLimited'>
  /** False where no code is asked for at all (an embedded demo phone, a demo account's tab). */
  offer?: boolean
}

export interface NamesSync {
  /** What the record holds now. */
  names(): NamesState
  /** Asks the server which names this code holds (the READ intent) and keeps the answer; throttled, silent on failure. */
  refresh(force?: boolean): Promise<NamesOutcome>
  claim(name: string, alias: boolean): Promise<NamesOutcome>
  release(name: string): Promise<NamesOutcome>
  /** Called whenever the held names changed. Returns the way to stop listening. */
  onChange(listener: () => void): () => void
}

export function createNamesSync(deps: NamesSyncDeps): NamesSync {
  const listeners = new Set<() => void>()
  let lastReadAt = Number.NEGATIVE_INFINITY
  const held = (): ConnectRecord | null => readConnectRecord(deps.load())

  const keep = (record: ConnectRecord, names: NamesState): void => {
    const next = withNames(record, names)
    const changed = JSON.stringify(namesOf(record)) !== JSON.stringify(namesOf(next))
    if (changed) deps.store(next)
    if (changed) for (const l of [...listeners]) l()
  }

  const call = async (intent: NameIntent): Promise<NamesOutcome> => {
    const record = held()
    if (!record) return { ok: false, error: ClaimError.NoCode }
    if (deps.offer === false) return { ok: false, error: ClaimError.Network }
    if (deps.keeper.coolingDown()) return { ok: false, error: ClaimError.RateLimited }
    const out = await callNames(deps, record, intent)
    if (!out.ok && out.error === ClaimError.RateLimited) deps.keeper.noteRateLimited()
    // The record may have changed while the request ran (a registration); write into the fresh one, or not at all when the code is gone.
    const fresh = held()
    if (out.ok && fresh?.code === record.code) keep(fresh, out.names)
    else if (!out.ok && out.names && fresh?.code === record.code) keep(fresh, out.names)
    return out
  }

  return {
    names: (): NamesState => namesOf(held()),
    async refresh(force = false): Promise<NamesOutcome> {
      if (!force && deps.now() - lastReadAt < NAMES_READ_GAP_MS) return { ok: true, names: namesOf(held()) }
      lastReadAt = deps.now()
      return call({ kind: 'read' })
    },
    claim: (name, alias) => call({ kind: 'claim', name, alias }),
    release: (name) => call({ kind: 'release', name }),
    onChange(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
