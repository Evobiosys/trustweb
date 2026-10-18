/**
 * One username for all my devices (wave 15, the network part of sync_code.ts): settle two codes after the first sync, keep the public link alive,
 * and the four actions of Settings > My devices > My username (open the link on this device, move a name here, make a name the primary, release
 * a name), plus taking the secret back when a device is unlinked. Every call goes through connect_code.ts / names_sync.ts, so the shapes, the
 * budgets and the "never throws" rule are theirs; this file only decides what to ask and writes the answers into the record.
 *
 * Each write goes to the record of the code it concerns (the main one or an entry of AppState.otherCodes) and is saved once per action (U24).
 * Local log lines say that a url or a name moved (never which name: the log can be shown).
 */
import { CONNECT_REFRESH_MS, ClaimError, field, postTo, registerConnect } from './connect_code'
import type { ConnectClientDeps, ConnectRecord } from './connect_code'
import { callNames, heldNames, namesOf, withNames } from './names_sync'
import type { NamesOutcome } from './names_sync'
import type { AppState } from './model'
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
    if (out.error === ClaimError.Forgotten && !r.stale) return { ...r, stale: true }
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

/**
 * After a merge brought codes in: read the main code's names again (never taken from the bundle as truth) and, when two codes met on the first sync,
 * move the loser's names into the winner (primary, then aliases; at most three fit). What stays behind keeps the loser's code in otherCodes; an empty
 * loser is dropped. Sets `merge.merged` when this device holds the shared code (it shows the one-time sheet). Never throws; saves once.
 */
export async function settleCodes(deps: CodeOpsDeps, merge: CodeMerge): Promise<void> {
  const s = deps.state()
  const { settle } = merge
  if (settle) {
    const winner = recordOf(s, settle.winner.code)
    const loser = recordOf(s, settle.loser.code)
    if (winner && loser) {
      const read = await callNames(deps, loser, { kind: 'read' })
      applyOutcome(s, loser.code, read)
      for (const name of read.ok ? heldNames(read.names) : []) {
        const fresh = recordOf(deps.state(), winner.code)
        if (!fresh) break
        const out = await moveName(deps, fresh, loser, name, 'alias')
        if (!out.ok && out.error === ClaimError.AliasCap) break
      }
      await reread(deps, loser.code)
      const left = recordOf(deps.state(), loser.code)
      if (left && !heldNames(namesOf(left)).length && deps.state().connectCode?.code !== left.code) deps.state().otherCodes = (deps.state().otherCodes ?? []).filter((r) => r.code !== left.code)
      if (!deps.state().otherCodes?.length) delete deps.state().otherCodes
    }
  }
  const main = deps.state().connectCode
  if (main && (merge.reread || settle)) await reread(deps, main.code)
  const now = deps.state().connectCode
  merge.merged = merge.first && !!now && now.owner !== 'other' && !!now.name
  deps.save()
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

/** Unlink took this device's side: the secret of every shared code is taken back (a NEW one, the old is dead), so the unlinked device's copy goes stale. The next sync carries the new secret on. */
export async function rotateCodes(deps: CodeOpsDeps): Promise<void> {
  const s = deps.state()
  for (const r of [s.connectCode, ...(s.otherCodes ?? [])]) {
    if (!r || r.stale) continue
    const res = await postTo(deps, '/connect', JSON.stringify({ code: r.code, secret: r.secret, rotate: true }))
    const secret = typeof res === 'string' ? undefined : field(res.json, 'secret')
    if (typeof res !== 'string' && res.status === 200 && typeof secret === 'string') update(deps.state(), r.code, (x) => ({ ...x, secret, updatedAt: deps.now() }))
  }
  deps.save()
  deps.log('The secret of the public link was renewed')
}

/**
 * Keeps the records of other devices alive on the server (the keeper never touches them): a read of the names (a refused secret marks the record
 * stale) and a plain GET of /c/<code> (the server's expiry counts from the last open). Once per CONNECT_REFRESH_MS per record, the same cadence as the
 * keeper's own refresh. Never throws.
 */
export async function careForCodes(deps: CodeOpsDeps): Promise<void> {
  const s = deps.state()
  const due = (r: ConnectRecord): boolean => deps.now() - (r.touchedAt ?? r.updatedAt) >= CONNECT_REFRESH_MS || deps.now() < (r.touchedAt ?? r.updatedAt)
  const mine = [...(s.connectCode?.owner === 'other' ? [s.connectCode] : []), ...(s.otherCodes ?? [])].filter((r) => !r.stale && due(r))
  for (const r of mine) {
    const seen = await deps.fetch(`${deps.origin}/c/${r.code}`, { redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then((x) => x.status !== 404, () => null)
    if (seen === null) continue
    const out = seen ? await reread(deps, r.code) : null
    if (out && !out.ok && out.error !== ClaimError.Forgotten) continue // no answer this time: try again at the next ensure
    update(deps.state(), r.code, (x) => ({ ...x, touchedAt: deps.now(), ...(seen ? {} : { stale: true as const }) }))
  }
  if (mine.length) deps.save()
}
