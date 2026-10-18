/**
 * One username for all my devices (wave 15, the pure part): the connect code travels in the sealed device-sync bundle, so linked devices share
 * ONE public link and ONE set of names. Server side: services/trustweb-backup (POST /name move, POST /connect rotate). No DOM, no network.
 *
 * PRIVACY: the secret of the public link now sits on every linked device (it is sealed between the owner's own devices only, and the owner can
 * decide per pairing not to share it: Pairing.shareCode). Nothing here is visible to others: links carry one DID as before, names resolve as before.
 *
 * Rules (the merge is per code, never per name; the server holds the names, a bundle never counts as their truth):
 *   - a device with no code adopts the incoming one (owner 'other': its keeper leaves it alone, the url moves only by "Open on this device");
 *   - the same code on both sides: the newer updatedAt wins url + secret; the names are read again from the server (`reread`);
 *   - two different codes on the FIRST sync of a pairing settle ONE account code: more names wins, a tie goes to the older updatedAt (then
 *     the smaller code). The loser's names move into the winner (sync_codes.ts, the server's atomic move; at most 3 names fit); what does
 *     not fit stays on the loser's code, kept in AppState.otherCodes. Later syncs with different codes just keep both.
 */
import { readConnectRecord } from './connect_code'
import type { ConnectRecord } from './connect_code'
import { SHORT_LINK_ORIGINS } from './short_link'
import type { AppState } from './model'
import type { SyncBundle } from './sync_core'

/** Codes kept besides the main one; also the most a bundle carries. */
export const OTHER_CODES_MAX = 5

/** The fields of a record that travel: never owner, fromDid or stale (they describe this device's view). */
export function travelling(r: ConnectRecord): ConnectRecord {
  const { owner: _o, fromDid: _f, stale: _s, touchedAt: _t, ...rest } = r
  return rest
}

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
  const others = readCodeList(s.otherCodes, [main.code]).filter((r) => validLongUrl(r.url)).map(travelling)
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

export interface CodeSettle { winner: ConnectRecord; loser: ConnectRecord; winnerIsMine: boolean }
export interface CodeMerge {
  /** This was the first sync of the pairing. */
  first: boolean
  /** The server's names of the main code must be read again (a code was adopted or shared). */
  reread: boolean
  /** Two different codes met on the first sync: move the loser's names into the winner (sync_codes.ts). */
  settle?: CodeSettle
  /** Set by the settle step when this device holds the code both now share: the one-time "Your devices now share one link" sheet. */
  merged?: boolean
}

const nameCount = (r: ConnectRecord): number => (r.name ? 1 : 0) + (r.aliases?.length ?? 0)

/** More names wins; a tie: the older updatedAt, then the smaller code (both devices compute the same). */
export function winnerOf(a: ConnectRecord, b: ConnectRecord): ConnectRecord {
  if (nameCount(a) !== nameCount(b)) return nameCount(a) > nameCount(b) ? a : b
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? a : b
  return a.code < b.code ? a : b
}

function addOther(s: AppState, r: ConnectRecord): void {
  if (s.connectCode?.code === r.code || (s.otherCodes ?? []).some((x) => x.code === r.code)) return
  s.otherCodes = [...(s.otherCodes ?? []), r].slice(-OTHER_CODES_MAX)
}

/**
 * Applies the codes of an incoming bundle to `s` (mutating it) after the lists merged. `fromDid` = the pairing, `first` = this pairing never
 * synced before. Returns what the network step still has to do.
 */
export function mergeCodes(s: AppState, incoming: Pick<SyncBundle, 'connectCode' | 'otherCodes'>, fromDid: string, first: boolean): CodeMerge {
  const out: CodeMerge = { first, reread: false }
  const theirs = incoming.connectCode ? { ...incoming.connectCode, owner: 'other' as const, fromDid } : null
  const mine = readConnectRecord(s.connectCode)
  if (theirs) {
    if (!mine) {
      s.connectCode = theirs
      out.reread = true
    } else if (mine.code === theirs.code) {
      if (theirs.updatedAt > mine.updatedAt && (theirs.url !== mine.url || theirs.secret !== mine.secret)) {
        // The newer url + secret win; a url that is not this device's own any more is not the keeper's to put back (owner 'other'). A new secret alone (unlink) changes nothing else.
        const { stale: _s, ...rest } = mine
        const moved = theirs.url !== mine.url
        s.connectCode = { ...rest, url: theirs.url, secret: theirs.secret, updatedAt: theirs.updatedAt, ...(moved ? { owner: 'other' as const, fromDid } : {}) }
      }
      out.reread = true
    } else if (first) {
      const winner = winnerOf(mine, theirs)
      const loser = winner === mine ? theirs : mine
      if (winner === theirs) s.connectCode = theirs
      addOther(s, loser)
      out.settle = { winner, loser, winnerIsMine: winner === mine }
      out.reread = true
    } else addOther(s, theirs)
  }
  for (const o of readCodeList(incoming.otherCodes, [])) if (o.code !== s.connectCode?.code && validLongUrl(o.url)) addOther(s, { ...travelling(o), fromDid })
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
