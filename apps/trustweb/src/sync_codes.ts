/**
 * One username for all my devices (wave 15, the network part of sync_code.ts): settle two codes after the first sync, keep the public link alive,
 * and the four actions of Settings > My devices > My username (open the link on this device, move a name here, make a name the primary, release
 * a name), plus taking the secret back when a device is unlinked. Every call goes through connect_code.ts / names_sync.ts, so the shapes, the
 * budgets and the "never throws" rule are theirs; this file only decides what to ask and writes the answers into the record.
 *
 * Each write goes to the record of the code it concerns (the main one or an entry of AppState.otherCodes) and is saved once per action (U24).
 * Local log lines say that a url or a name moved (never which name: the log can be shown).
 */
import { CONNECT_REFRESH_MS, ClaimError, field, mustKeep, postTo, registerConnect, touchCode } from './connect_code'
import type { ConnectClientDeps, ConnectRecord } from './connect_code'
import { callNames, heldNames, namesOf, withNames } from './names_sync'
import type { NamesOutcome } from './names_sync'
import type { AppState } from './model'
import { winnerOf } from './sync_code'
import type { CodeMerge } from './sync_code'

export interface CodeOpsDeps extends ConnectClientDeps {
  state: () => AppState
  save: () => void
  /** Progress lines for the local sync log. */
  log: (line: string) => void
}

type Patch = (r: ConnectRecord) => ConnectRecord

/** Writes `patch(record)` into the main code or the otherCodes entry named `code`; false when this record is gone from the state. */
function update(s: AppState, code: string, patch: Patch): boolean {
  if (s.connectCode?.code === code) { s.connectCode = patch(s.connectCode); return true }
  const i = (s.otherCodes ?? []).findIndex((r) => r.code === code)
  if (i < 0 || !s.otherCodes) return false
  s.otherCodes = s.otherCodes.map((r, j) => (j === i ? patch(r) : r))
  return true
}

const recordOf = (s: AppState, code: string): ConnectRecord | undefined => (s.connectCode?.code === code ? s.connectCode : (s.otherCodes ?? []).find((r) => r.code === code))

/** What an outcome writes into its record: the names; a refused secret on a record of another device marks it stale; a good answer clears that. */
function applyOutcome(s: AppState, code: string, out: NamesOutcome): void {
  update(s, code, (r) => {
    if (out.ok) { const { stale: _s, ...rest } = withNames(r, out.names); return rest }
    if (out.error === ClaimError.Forgotten && !r.stale && mustKeep(r)) return { ...r, stale: true }
    return out.names ? withNames(r, out.names) : r
  })
}

/** Asks the server which names `code` holds and keeps the answer in its record. */
async function reread(deps: CodeOpsDeps, code: string): Promise<NamesOutcome | null> {
  const rec = recordOf(deps.state(), code)
  if (!rec) return null
  const out = await callNames(deps, rec, { kind: 'read' })
  applyOutcome(deps.state(), code, out)
  return out
}

/** Moves `name` from `from` into `to`; the answer is `to`'s names. */
async function moveName(deps: CodeOpsDeps, to: ConnectRecord, from: ConnectRecord, name: string, as: 'primary' | 'alias'): Promise<NamesOutcome> {
  const out = await callNames(deps, to, { kind: 'move', name, from: { code: from.code, secret: from.secret }, as })
  applyOutcome(deps.state(), to.code, out)
  if (out.ok) deps.log('A name moved to the shared link')
  return out
}

/** Makes the record `code` (an otherCodes entry) the main code; the old main takes its place in otherCodes (F9: it stays, its names are listed, /c/<old> stays alive). */
function swapMain(s: AppState, code: string): void {
  const old = s.connectCode
  const next = (s.otherCodes ?? []).find((r) => r.code === code)
  if (!old || !next) return
  s.otherCodes = [old, ...(s.otherCodes ?? []).filter((r) => r.code !== code)]
  s.connectCode = next
}

/**
 * After a merge brought codes in: read the main code's names again (never taken from the bundle as truth). When two different codes met, read BOTH
 * from the server first (F1); the code with more names (winnerOf) is then the one to keep. Nothing moves here: if the loser holds no names the winner
 * simply becomes the main code; if this device's code would lose names, `merge.choice` is set and the owner picks (pickCode). Offline or a refused
 * secret: the codes stay split and the choice comes back at the next sync (D2). Never throws; saves once.
 */
export async function settleCodes(deps: CodeOpsDeps, merge: CodeMerge): Promise<void> {
  const { ask } = merge
  if (ask) {
    const [a, b] = [await reread(deps, ask.mine), await reread(deps, ask.theirs)]
    const s = deps.state()
    const mine = recordOf(s, ask.mine)
    const theirs = recordOf(s, ask.theirs)
    if (a?.ok && b?.ok && mine && theirs && s.connectCode?.code === mine.code) {
      const winner = winnerOf(mine, theirs)
      const loser = winner === mine ? theirs : mine
      if (heldNames(namesOf(loser)).length) { if (loser === mine) merge.choice = { mine, theirs } } else if (winner === theirs) swapMain(s, theirs.code)
    }
  } else if (merge.reread && deps.state().connectCode) await reread(deps, deps.state().connectCode!.code)
  deps.save()
}

/**
 * The owner's pick on the "two links" sheet: the names of the other code MOVE into the kept one (server's atomic move; at most three names fit, what
 * stays behind is listed with Move / Release), and the kept code becomes the main one. Stops at the cap or when the server cannot be reached.
 */
export async function pickCode(deps: CodeOpsDeps, choice: NonNullable<CodeMerge['choice']>, keep: 'mine' | 'theirs'): Promise<void> {
  const [to, from] = keep === 'mine' ? [choice.mine, choice.theirs] : [choice.theirs, choice.mine]
  for (const name of heldNames(namesOf(recordOf(deps.state(), from.code) ?? from))) {
    const dest = recordOf(deps.state(), to.code)
    const src = recordOf(deps.state(), from.code)
    if (!dest || !src) break
    const out = await moveName(deps, dest, src, name, 'alias')
    if (!out.ok && (out.error === ClaimError.AliasCap || out.error === ClaimError.Network)) break
  }
  await reread(deps, from.code)
  if (keep === 'theirs') swapMain(deps.state(), to.code)
  deps.save()
}

/** "Release" on an old link that holds no name any more: it leaves the list and is not kept alive any more. */
export function dropCode(s: AppState, save: () => void, code: string): void {
  s.otherCodes = (s.otherCodes ?? []).filter((r) => r.code !== code)
  if (!s.otherCodes.length) delete s.otherCodes
  save()
}

/** "Open on this device": the public link opens here from now on. The explicit update of the stored url (the keeper never does it for a record of another device). */
export async function openHere(deps: CodeOpsDeps, longUrl: string): Promise<boolean> {
  const rec = deps.state().connectCode
  if (!rec) return false
  const out = await registerConnect(deps, rec, longUrl)
  if (!out.ok) return false
  const { owner: _o, fromDid: _f, stale: _s, touchedAt: _t, ...mine } = out.record
  deps.state().connectCode = mine
  deps.save()
  deps.log('The public link now opens on this device')
  return true
}

/** "Move <name> here". */
export async function moveHere(deps: CodeOpsDeps, name: string, from: ConnectRecord): Promise<NamesOutcome> {
  const to = deps.state().connectCode
  if (!to) return { ok: false, error: ClaimError.NoCode }
  const out = await moveName(deps, to, from, name, 'alias')
  await reread(deps, from.code)
  deps.save()
  return out
}

/** "Make <name> the primary": a swap inside the main code, or a move as primary from another code. */
export async function makePrimary(deps: CodeOpsDeps, name: string, from: ConnectRecord | null): Promise<NamesOutcome> {
  const to = deps.state().connectCode
  if (!to) return { ok: false, error: ClaimError.NoCode }
  let out: NamesOutcome
  if (from) {
    out = await moveName(deps, to, from, name, 'primary')
    await reread(deps, from.code)
  } else {
    out = await callNames(deps, to, { kind: 'claim', name, alias: false })
    applyOutcome(deps.state(), to.code, out)
  }
  deps.save()
  return out
}

/** Frees a name of any code of this account. */
export async function releaseName(deps: CodeOpsDeps, name: string, from: ConnectRecord): Promise<NamesOutcome> {
  const out = await callNames(deps, from, { kind: 'release', name })
  applyOutcome(deps.state(), from.code, out)
  deps.save()
  return out
}

/** Reads every code of this account again (the Settings block opens). Silent on failure. */
export async function refreshAll(deps: CodeOpsDeps): Promise<void> {
  const s = deps.state()
  for (const r of [s.connectCode, ...(s.otherCodes ?? [])]) if (r) await reread(deps, r.code)
  deps.save()
}

/**
 * Takes the secret back of the codes named (a NEW secret per code, the old is dead). Only a code this device owns is renewed (F3); a third linked device
 * is stale until its next sync, never re-minted. One log line per result; a failed renewal is kept in AppState.pendingRenew and retried (F4).
 */
async function renew(deps: CodeOpsDeps, codes: string[]): Promise<void> {
  const pending = new Set(deps.state().pendingRenew ?? [])
  for (const code of codes) {
    const r = recordOf(deps.state(), code)
    if (!r || r.owner === 'other' || r.stale) { pending.delete(code); continue }
    const res = await postTo(deps, '/connect', JSON.stringify({ code, secret: r.secret, rotate: true }))
    const secret = typeof res === 'string' ? undefined : field(res.json, 'secret')
    if (typeof res !== 'string' && res.status === 200 && typeof secret === 'string') {
      update(deps.state(), code, (x) => ({ ...x, secret, secretAt: deps.now() }))
      pending.delete(code)
      deps.log('The secret of a public link was renewed')
    } else if (typeof res !== 'string' && res.status === 403) {
      update(deps.state(), code, (x) => ({ ...x, stale: true as const }))
      pending.delete(code)
      deps.log('The secret of a public link was already renewed elsewhere')
    } else {
      pending.add(code)
      deps.log('Could not renew the secret of a public link; trying again later')
    }
  }
  const s = deps.state()
  if (pending.size) s.pendingRenew = [...pending]
  else delete s.pendingRenew
  deps.save()
}

/** Unlink (or "Shares my username" switched off): the secret of every code this device owns is renewed; the other device's copy goes stale. The next sync carries the new secret on. */
export const rotateCodes = (deps: CodeOpsDeps): Promise<void> => renew(deps, [deps.state().connectCode, ...(deps.state().otherCodes ?? [])].flatMap((r) => (r ? [r.code] : [])))

/**
 * Keeps the records of other devices alive on the server (the keeper never touches them): a plain GET of /c/<code> (the server's expiry counts from
 * the last open) and a read of the names (a refused secret marks the record stale). Once per CONNECT_REFRESH_MS per record, the same cadence as the
 * keeper's own refresh. Failed renewals are retried first. Never throws.
 */
export async function careForCodes(deps: CodeOpsDeps): Promise<void> {
  if (deps.state().pendingRenew?.length) await renew(deps, deps.state().pendingRenew ?? [])
  const s = deps.state()
  const due = (r: ConnectRecord): boolean => deps.now() - (r.touchedAt ?? r.updatedAt) >= CONNECT_REFRESH_MS || deps.now() < (r.touchedAt ?? r.updatedAt)
  const mine = [...(s.connectCode?.owner === 'other' ? [s.connectCode] : []), ...(s.otherCodes ?? [])].filter((r) => !r.stale && due(r))
  for (const r of mine) {
    const seen = await touchCode(deps, r.code)
    if (seen === null) continue
    const out = seen ? await reread(deps, r.code) : null
    if (out && !out.ok && out.error !== ClaimError.Forgotten) continue // no answer this time: try again at the next ensure
    update(deps.state(), r.code, (x) => ({ ...x, touchedAt: deps.now(), ...(seen ? {} : { stale: true as const }) }))
  }
  if (mine.length) deps.save()
}
