/**
 * One username for all my devices (wave 15, the pure part): the connect code travels in the sealed device-sync bundle, so linked devices share
 * ONE public link and ONE set of names. Server side: services/trustweb-backup (POST /name move, POST /connect rotate). No DOM, no network.
 *
 * PRIVACY: the secret of the public link now sits on every linked device (it is sealed between the owner's own devices only, and the owner can
 * decide per pairing not to share it: Pairing.shareCode). Nothing here is visible to others: links carry one DID as before, names resolve as before.
 *
 * Rules (the merge is per code, never per name; the server holds the names, a bundle never counts as their truth):
 *   - a device with no code adopts the incoming one (owner 'other': its keeper leaves it alone, the url moves only by "Open on this device");
 *   - the same code on both sides: the newer updatedAt wins the url, the newer secretAt the secret (separate clocks); names are read again (`reread`);
 *   - two different codes: both are kept (the other goes to AppState.otherCodes) and `ask` is set; the network step (sync_codes.ts) reads BOTH
 *     codes' names from the server and, when this device's code would lose, offers the owner the choice; nothing moves before the pick.
 *   - a pairing that does not share (Pairing.shareCode === false) contributes no code and no displayName, whichever side switched it off.
 */
import { readConnectRecord } from './connect_code'
import type { ConnectRecord } from './connect_code'
import { SHORT_LINK_ORIGINS } from './short_link'
import type { AppState } from './model'
import type { SyncBundle } from './sync_core'

/** Codes kept besides the main one; also the most a bundle carries. */
export const OTHER_CODES_MAX = 5

/** The fields of a record that travel: never owner, fromDid, stale, touchedAt, shared or relayed (they describe this device's view). */
export function travelling(r: ConnectRecord): ConnectRecord {
  const { owner: _o, fromDid: _f, stale: _s, touchedAt: _t, shared: _h, relayed: _r, ...rest } = r
  return rest
}

/** An otherCodes entry on the wire: `relayed` when this device got it from yet another one (F16: the receiver then cannot name the original device). */
export const wireOther = (r: ConnectRecord): ConnectRecord => ({ ...travelling(r), ...(r.fromDid || r.relayed ? { relayed: true as const } : {}) })

/** The https url of a connect link on one of our app hosts with a connect parameter and no fragment; false for anything else. */
export function validLongUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && SHORT_LINK_ORIGINS.includes(u.origin) && u.searchParams.has('connect') && u.hash === '' && url.length <= 2048
  } catch { return false }
}

/** One code field of a bundle, checked; null when it is anything else (the caller drops only this field, never the bundle). */
export function parseCodeField(v: unknown): ConnectRecord | null {
  const r = readConnectRecord(v)
  return r && validLongUrl(r.url) ? travelling(r) : null
}

/** The records of a list, malformed ones dropped, duplicates (by code) and `except` removed, at most OTHER_CODES_MAX. Never throws. */
export function readCodeList(raw: unknown, except: string[] = []): ConnectRecord[] {
  if (!Array.isArray(raw)) return []
  const out: ConnectRecord[] = []
  for (const v of raw) {
    const r = readConnectRecord(v)
    if (r && !except.includes(r.code) && !out.some((x) => x.code === r.code)) out.push(r)
  }
  return out.slice(0, OTHER_CODES_MAX)
}

/** What a bundle carries: the main code and the others (deduplicated by code), when the pairing shares it. */
export function codesForBundle(s: Pick<AppState, 'connectCode' | 'otherCodes'>, share: boolean): { connectCode?: ConnectRecord; otherCodes?: ConnectRecord[] } {
  const main = share ? parseCodeField(s.connectCode) : null
  if (!main) return {}
  const others = readCodeList(s.otherCodes, [main.code]).filter((r) => validLongUrl(r.url)).map(wireOther)
  return { connectCode: main, ...(others.length ? { otherCodes: others } : {}) }
}

/** The DID a connect link carries (?connect=), or null. */
export function didOfUrl(url: string): string | null {
  try { return new URL(url).searchParams.get('connect') } catch { return null }
}

/** Boot repair: bad otherCodes entries dropped, duplicates and the main code removed. True when the state changed. */
export function repairOtherCodes(s: Pick<AppState, 'connectCode' | 'otherCodes'>): boolean {
  if (s.otherCodes === undefined) return false
  const clean = readCodeList(s.otherCodes, s.connectCode ? [s.connectCode.code] : [])
  if (JSON.stringify(clean) === JSON.stringify(s.otherCodes)) return false
  if (clean.length) s.otherCodes = clean
  else delete s.otherCodes
  return true
}

export interface CodeMerge {
  /** The server's names of the main code must be read again (a code was adopted or shared). */
  reread: boolean
  /** Two different codes met: this device's main code and the other one (now in otherCodes). The network step reads both and may offer the choice (`choice`). */
  ask?: { mine: string; theirs: string }
  /** Set by the network step: this device's code would lose, so the owner picks which link to keep (names fresh from the server). Nothing has moved yet. */
  choice?: { mine: ConnectRecord; theirs: ConnectRecord }
}

const nameCount = (r: ConnectRecord): number => (r.name ? 1 : 0) + (r.aliases?.length ?? 0)

/** More names wins; a tie: the older updatedAt, then the smaller code (both devices compute the same). Call it with names read from the server. */
export function winnerOf(a: ConnectRecord, b: ConnectRecord): ConnectRecord {
  if (nameCount(a) !== nameCount(b)) return nameCount(a) > nameCount(b) ? a : b
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? a : b
  return a.code < b.code ? a : b
}

function addOther(s: AppState, r: ConnectRecord): void {
  if (s.connectCode?.code === r.code || (s.otherCodes ?? []).some((x) => x.code === r.code)) return
  s.otherCodes = [...(s.otherCodes ?? []), r].slice(-OTHER_CODES_MAX)
}

/** The bundle as a pairing that does not share it sees it: no code, no other codes, no display name (D3). */
export function withoutCodes(b: SyncBundle): SyncBundle {
  const { connectCode: _c, otherCodes: _o, displayName: _d, ...rest } = b
  return rest
}

/**
 * Applies the codes of an incoming bundle to `s` (mutating it) after the lists merged. `fromDid` = the pairing. Returns what the network step
 * still has to do. The caller skips this for a pairing whose own shareCode is false.
 */
export function mergeCodes(s: AppState, incoming: Pick<SyncBundle, 'connectCode' | 'otherCodes'>, fromDid: string): CodeMerge {
  const out: CodeMerge = { reread: false }
  const theirs = incoming.connectCode ? { ...incoming.connectCode, owner: 'other' as const, fromDid } : null
  const mine = readConnectRecord(s.connectCode)
  if (theirs) {
    if (!mine) {
      s.connectCode = theirs
      out.reread = true
    } else if (mine.code === theirs.code) {
      const newUrl = theirs.updatedAt > mine.updatedAt && theirs.url !== mine.url
      const newSecret = (theirs.secretAt ?? 0) > (mine.secretAt ?? 0) && theirs.secret !== mine.secret
      if (newUrl || newSecret) {
        // A url that is not this device's own any more is not the keeper's to put back (owner 'other'); a new secret ends a stale mark.
        const { stale: _s, ...rest } = mine
        s.connectCode = {
          ...(newSecret ? rest : mine),
          ...(newUrl ? { url: theirs.url, updatedAt: theirs.updatedAt, owner: 'other' as const, fromDid } : {}),
          ...(newSecret ? { secret: theirs.secret, secretAt: theirs.secretAt } : {}),
        }
      }
      out.reread = true
    } else {
      addOther(s, theirs)
      out.ask = { mine: mine.code, theirs: theirs.code }
      out.reread = true
    }
  }
  for (const o of readCodeList(incoming.otherCodes, [])) {
    if (o.code !== s.connectCode?.code && validLongUrl(o.url)) addOther(s, { ...travelling(o), owner: 'other', fromDid: o.relayed ? '' : fromDid })
  }
  return out
}

/** Where the public link opens: this device, a linked device (by its pairing) or an unknown other one. */
export type OpensOn = { kind: 'this' } | { kind: 'device'; did: string } | { kind: 'other' }

export function opensOn(url: string, myAskDid: string | undefined, pairings: readonly { did: string; askDid?: string }[]): OpensOn {
  const did = didOfUrl(url)
  if (!did) return { kind: 'other' }
  if (did === myAskDid) return { kind: 'this' }
  const p = pairings.find((x) => x.askDid === did)
  return p ? { kind: 'device', did: p.did } : { kind: 'other' }
}
