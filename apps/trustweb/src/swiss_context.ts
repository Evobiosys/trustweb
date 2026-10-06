/**
 * What the app knows about the Swiss server's newer services this visit
 * (wave 1733 round B): what GET /hosted/status says is switched on, and the
 * hosted account (made once, on first use, kept in the record). Shared by the
 * hosting and the transcription views so the status is asked once and the
 * account is derived once.
 *
 * Never on a demo phone, a demo account or the side-by-side demo: those would
 * mint server accounts (5 new ones per address and day) for imaginary people.
 */
import { fetchStatus, hostedAccount, isHostedSecret, newHostedSecret } from './swiss_server'
import type { HostedAccount, ServerStatus } from './swiss_server'
import type { AppState, HostingState } from './model'

export interface SwissContext {
  /** Hosting and server transcription may be offered on this phone at all (not on any demo phone or account). */
  enabled(): boolean
  /** The last status: undefined = not asked yet, null = the server did not answer. */
  status(): ServerStatus | null | undefined
  /** Asks the server (once per visit, or again with `force`). */
  probe(force?: boolean): Promise<ServerStatus | null>
  /** The hosted account; its secret is made and saved on first use. */
  account(): Promise<HostedAccount>
  /** The hosting part of the record, made on first use. */
  hosting(): HostingState
}

export interface SwissContextHooks {
  state: () => AppState
  save: () => void
  enabled: () => boolean
}

/** A hosting state as read from the record: anything odd reads as absent (never thrown on at boot, never repaired). */
export function readHosting(s: Pick<AppState, 'hosting'>): HostingState | null {
  const h = s.hosting
  if (!h || typeof h !== 'object' || !isHostedSecret(h.secret) || !Array.isArray(h.recs)) return null
  return h
}

export function createSwissContext(h: SwissContextHooks): SwissContext {
  let last: ServerStatus | null | undefined
  let asking: Promise<ServerStatus | null> | null = null
  let derived: { secret: string; account: Promise<HostedAccount> } | null = null

  function probe(force = false): Promise<ServerStatus | null> {
    if (!h.enabled()) return Promise.resolve(null)
    if (asking && !force) return asking
    asking = fetchStatus().then((st) => { last = st; return st })
    return asking
  }

  function hosting(): HostingState {
    const s = h.state()
    const have = readHosting(s)
    if (have) return have
    // Something is there but not readable: never written over (it may be the only key to stored recordings).
    if (s.hosting !== undefined) throw new Error('hosting state unreadable')
    s.hosting = { secret: newHostedSecret(), on: false, recs: [] }
    h.save()
    return s.hosting
  }

  function account(): Promise<HostedAccount> {
    if (!h.enabled()) return Promise.reject(new Error('not on this phone'))
    let secret: string
    try { secret = hosting().secret } catch (e) { return Promise.reject(e) }
    if (derived?.secret !== secret) derived = { secret, account: hostedAccount(secret) }
    return derived.account
  }

  return { enabled: h.enabled, status: () => last, probe, account, hosting }
}
