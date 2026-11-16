// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c social-hosting (Jakob A3, δ): friends-first hosting of name records. A discoverable person's signed name record (name_record.ts)
 * is held by their online friends in Closest (optionally Close) who switched "Host my friends' names" on; a lookup asks trusted friends first,
 * then the server directory (directory_client.ts), then the local cache; when the last host of a record goes offline it hands the signed record
 * to the server. Trusted-only mode (trust_mode.ts) closes every server path. Trust model: DEVLOG/wave43/social-hosting_DESIGN.txt.
 *
 * The wire is ONE sealed envelope type `host` (apps/demo wire.ts) whose body is a HostMsg below; this class knows nothing of relays: `send`, the
 * clock, `wait` and the signer are injected, so the unit tests run several nodes over an in-memory wire. No DOM, never throws on bad input.
 */
import { pullIntents, putRecord, searchName, sendIntent } from './directory_client'
import type { DirDeps } from './directory_client'
import { MAX_HOSTS, newest, normName, verifyIntent, verifyRecord } from './name_record'
import type { Intent, NameRecord, Signer, Verifier } from './name_record'
import { isTrusted, serversAllowed } from './trust_mode'
import type { TrustOverride } from './trust_mode'

/** The small protocol (design page): owner -> host `put`/`drop`, searcher -> host `get` and back `rec`, searcher -> host -> owner `intent`. */
export type HostMsg =
  | { k: 'put'; rec: NameRecord }
  | { k: 'drop' }
  | { k: 'get'; q: string; name: string }
  | { k: 'rec'; q: string; recs: NameRecord[] }
  | { k: 'intent'; intent: Intent }

/** A lookup waits this long for friends before it moves on to the server. */
export const LOOKUP_MS = 4000
/** A friend heard from within this long counts as online (any envelope from them, noted through seen()). */
export const ONLINE_MS = 10 * 60_000
/** A cached lookup result serves as the last resort for this long. */
export const CACHE_MS = 7 * 86_400_000
const MAX_RESULTS = 10

interface PersonLite { id: string; ring: string; trust?: TrustOverride; peerId?: string; blocked?: number; name?: string; globalKey?: string }
interface PeerLite { id: string; did: string }
export interface HostState {
  trustedOnly?: boolean
  hostFriends?: string
  people: PersonLite[]
  peers: PeerLite[]
  /** Records I hold for friends, by owner did. This phone only, never synced. */
  hosted?: Record<string, NameRecord>
  /** Lookup results by normalised name, for the offline last resort. This phone only. */
  nameCache?: Record<string, { recs: NameRecord[]; at: number }>
  /** Verified "intend to connect" notices waiting to become people (applyIntent). */
  intentsIn?: Intent[]
}

/** Which rings I host for: the setting "Host my friends' names" (off | closest | close), Closest by default. */
export function hostRings(s: { hostFriends?: string }): string[] {
  return s.hostFriends === 'off' ? [] : s.hostFriends === 'close' ? ['closest', 'close'] : ['closest']
}

/** May I hold the record of this person? Their ring is in my setting, I did not mark them "not trusted", and in trusted-only they are trusted. */
export function mayHostFor(s: { trustedOnly?: boolean; hostFriends?: string }, p: { ring: string; trust?: TrustOverride; blocked?: number }): boolean {
  if (p.trust === 'no' || (p.blocked ?? 0) > 0) return false
  if (s.trustedOnly && !isTrusted(p)) return false
  return hostRings(s).includes(p.ring)
}

export interface HostDeps {
  self: { did: string }
  state: () => HostState
  sign: Signer
  verify: Verifier
  now: () => number
  /** Resolves after `ms` (setTimeout in the app; the tests release it by hand). */
  wait: (ms: number) => Promise<void>
  /** The sealed `host` envelope to one connected peer. May reject; the node ignores it. */
  send: (toDid: string, msg: HostMsg) => Promise<void>
  /** The directory client deps, or null when no server can be used at all. */
  dir: () => DirDeps | null
  save: () => void
  /** A verified intent arrived and waits in state.intentsIn. */
  onIntent?: () => void
}

interface Pending { asked: Set<string>; answered: Set<string>; recs: NameRecord[]; done: () => void }

export class SocialHost {
  private readonly lastSeen = new Map<string, number>()
  private readonly pending = new Map<string, Pending>()
  private counter = 0

  constructor(private readonly d: HostDeps) {}

  /** Any envelope from this peer arrived: they are online now. */
  seen(did: string): void { this.lastSeen.set(did, this.d.now()) }

  private online(did: string): boolean {
    const t = this.lastSeen.get(did)
    return t !== undefined && this.d.now() - t < ONLINE_MS
  }

  private person(did: string): PersonLite | undefined {
    const s = this.d.state()
    const peer = s.peers.find((p) => p.did === did)
    return peer ? s.people.find((p) => p.peerId === peer.id) : undefined
  }

  /** The connected friends I trust (ring or override), nobody blocked: the ones I ask, push to and pass intents through. */
  private trustedFriends(): string[] {
    const s = this.d.state()
    return s.peers.filter((peer) => { const p = s.people.find((x) => x.peerId === peer.id); return isTrusted(p) && !((p?.blocked ?? 0) > 0) }).map((p) => p.did)
  }

  private async tell(did: string, msg: HostMsg): Promise<boolean> {
    try { await this.d.send(did, msg); return true } catch { return false }
  }

  private servers(): DirDeps | null {
    return serversAllowed(this.d.state()) ? this.d.dir() : null
  }

  // ---- owner side ----------------------------------------------------------------------------------------------------------------

  /** Push my signed record to my trusted friends (they decide whether to host it) and, when servers are allowed and the record says so, to the server. */
  async publish(rec: NameRecord): Promise<{ friends: number; server: boolean }> {
    const to = this.trustedFriends()
    await Promise.all(to.map((did) => this.tell(did, { k: 'put', rec })))
    const dir = rec.srv ? this.servers() : null
    return { friends: to.length, server: dir ? await putRecord(dir, rec) : false }
  }

  /** Discoverable switched off: hosts drop the record. (The server withdrawal is directory_client deleteRecord, needs the server allowed.) */
  async withdraw(): Promise<void> {
    await Promise.all(this.trustedFriends().map((did) => this.tell(did, { k: 'drop' })))
  }

  /** Leave an "intend to connect": the server when allowed, else (or when it failed) my trusted friends pass it to the owner. */
  async sendIntent(intent: Intent): Promise<{ server: boolean; friends: number }> {
    const dir = this.servers()
    const server = dir ? await sendIntent(dir, intent) : false
    if (server) return { server, friends: 0 }
    const to = this.trustedFriends()
    await Promise.all(to.map((did) => this.tell(did, { k: 'intent', intent })))
    return { server: false, friends: to.length }
  }

  /** Verified intents the server holds for me (a pull clears them); they land in state.intentsIn like the friends' ones. */
  async pullIntents(): Promise<number> {
    const dir = this.servers()
    if (!dir) return 0
    let n = 0
    for (const i of await pullIntents(dir, this.d.self.did, this.d.sign)) n += this.keepIntent(i) ? 1 : 0
    if (n) this.d.onIntent?.()
    return n
  }

  // ---- searcher side -------------------------------------------------------------------------------------------------------------

  /** Friends -> server -> cache. `deep` asks the server as well when friends already found someone. */
  async lookup(first: string, last: string, opts: { deep?: boolean } = {}): Promise<{ records: NameRecord[]; via: 'friends' | 'server' | 'cache' | null }> {
    const name = normName(first, last)
    if (!first.trim() || !last.trim()) return { records: [], via: null }
    const friends = await this.askFriends(name)
    let records = friends
    let via: 'friends' | 'server' | null = friends.length ? 'friends' : null
    const dir = friends.length && !opts.deep ? null : this.servers()
    if (dir) {
      const found = await searchName(dir, first, last)
      records = this.merge(friends, found)
      if (found.length && !friends.length) via = 'server'
    }
    const s = this.d.state()
    if (records.length) {
      ;(s.nameCache ??= {})[name] = { recs: records, at: this.d.now() }
      this.d.save()
      return { records, via }
    }
    const cached = s.nameCache?.[name]
    if (cached && this.d.now() - cached.at < CACHE_MS) return { records: cached.recs.filter((r) => verifyRecord(r, this.d.verify)), via: 'cache' }
    return { records: [], via: null }
  }

  private merge(a: NameRecord[], b: NameRecord[]): NameRecord[] {
    const keys = [...new Set([...a, ...b].map((r) => r.key))]
    return keys.flatMap((k) => newest([...a, ...b].filter((r) => r.key === k), this.d.verify) ?? []).slice(0, MAX_RESULTS)
  }

  private async askFriends(name: string): Promise<NameRecord[]> {
    const to = this.trustedFriends()
    if (!to.length) return []
    const q = `q${this.d.now()}-${(this.counter += 1)}`
    let release = (): void => undefined
    const settled = new Promise<void>((r) => { release = r })
    const entry: Pending = { asked: new Set(to), answered: new Set(), recs: [], done: release }
    this.pending.set(q, entry)
    await Promise.all(to.map((did) => this.tell(did, { k: 'get', q, name })))
    await Promise.race([settled, this.d.wait(LOOKUP_MS)])
    this.pending.delete(q)
    return this.merge(entry.recs, [])
  }

  // ---- hand-off ------------------------------------------------------------------------------------------------------------------

  /** This device is going offline: every hosted record whose other hosts are not seen online goes, signed, to the server (if its owner allowed one). */
  async handOff(): Promise<{ handed: number }> {
    const dir = this.servers()
    if (!dir) return { handed: 0 }
    let handed = 0
    for (const rec of Object.values(this.d.state().hosted ?? {})) {
      if (!rec.srv || rec.hosts.some((h) => h !== this.d.self.did && this.online(h))) continue
      if (await putRecord(dir, rec)) handed += 1
    }
    return { handed }
  }

  // ---- the wire ------------------------------------------------------------------------------------------------------------------

  /** One `host` envelope arrived from a connected peer (already opened with their pair key). Anything malformed is ignored. */
  async onMessage(fromDid: string, m: unknown): Promise<void> {
    if (typeof m !== 'object' || m === null) return
    const msg = m as Record<string, unknown>
    this.seen(fromDid)
    const from = this.person(fromDid)
    if (!from) return
    switch (msg.k) {
      case 'put': return this.onPut(fromDid, from, msg.rec)
      case 'drop': { const h = this.d.state().hosted; if (h && h[fromDid]) { delete h[fromDid]; this.d.save() } return }
      case 'get': return this.onGet(fromDid, from, msg)
      case 'rec': return this.onRec(fromDid, msg)
      case 'intent': return this.onIntent(from, msg.intent)
    }
  }

  private onPut(fromDid: string, from: PersonLite, rec: unknown): void {
    const s = this.d.state()
    if (!verifyRecord(rec, this.d.verify) || rec.key !== fromDid || !mayHostFor(s, from)) return
    const held = s.hosted?.[fromDid]
    if (held && held.ts >= rec.ts) return
    const hosts = [...new Set([...rec.hosts.filter((h) => h !== this.d.self.did), this.d.self.did])].slice(-MAX_HOSTS)
    ;(s.hosted ??= {})[fromDid] = { ...rec, hosts }
    this.d.save()
  }

  private async onGet(fromDid: string, from: PersonLite, msg: Record<string, unknown>): Promise<void> {
    if (!isTrusted(from) || typeof msg.q !== 'string' || typeof msg.name !== 'string' || msg.q.length > 80) return
    const recs = Object.values(this.d.state().hosted ?? {}).filter((r) => normName(r.first, r.last) === msg.name).slice(0, MAX_RESULTS)
    await this.tell(fromDid, { k: 'rec', q: msg.q, recs })
  }

  private onRec(fromDid: string, msg: Record<string, unknown>): void {
    const p = typeof msg.q === 'string' ? this.pending.get(msg.q) : undefined
    if (!p || !p.asked.has(fromDid) || p.answered.has(fromDid)) return
    p.answered.add(fromDid)
    if (Array.isArray(msg.recs)) p.recs.push(...msg.recs.slice(0, MAX_RESULTS).filter((r): r is NameRecord => verifyRecord(r, this.d.verify)))
    if (p.recs.length || p.answered.size >= p.asked.size) p.done()
  }

  private async onIntent(from: PersonLite, intent: unknown): Promise<void> {
    if (!verifyIntent(intent, this.d.verify) || !isTrusted(from)) return
    if (intent.to === this.d.self.did) {
      if (this.keepIntent(intent)) this.d.onIntent?.()
      return
    }
    // A host passes it on to the owner it holds a record for, when that owner is one of its connections.
    if (this.d.state().hosted?.[intent.to] && this.person(intent.to)) await this.tell(intent.to, { k: 'intent', intent })
  }

  /** Queue a verified intent for me (newest per sender); false when there is nothing new. */
  private keepIntent(i: Intent): boolean {
    const s = this.d.state()
    const list = (s.intentsIn ??= [])
    const at = list.findIndex((x) => x.from.key === i.from.key)
    if (at >= 0) { if (list[at].ts >= i.ts) return false; list[at] = i } else list.push(i)
    this.d.save()
    return true
  }
}

/**
 * An arrived intent becomes a person on the Unsorted ring who reached out: the bell's "People who want to connect" lists them and the ring draws
 * them in the special colour (notify_center.ts wantsConnect). Null when that key is already a connection or already known (also blocked/archived).
 */
export function applyIntent(
  s: { people: unknown[]; peers: { did: string }[] },
  i: Intent,
  newId: () => string,
  now: number,
): { id: string; name: string; context: string; ring: string; metAt: number; lines: never[]; reachedOut: 'received'; globalKey: string } | null {
  if (s.peers.some((p) => p.did === i.from.key) || (s.people as { globalKey?: string }[]).some((p) => p.globalKey === i.from.key)) return null
  const person = { id: newId(), name: `${i.from.first} ${i.from.last}`, context: '', ring: 'intending', metAt: now, lines: [] as never[], reachedOut: 'received' as const, globalKey: i.from.key }
  s.people.push(person)
  return person
}

/** My side of "Intend to connect": one person on the Unsorted ring, marked as one I reached out to (the same person again returns the first). */
export function markIntended(s: { people: unknown[] }, who: { first: string; last: string; key: string }, newId: () => string, now: number) {
  const held = (s.people as { globalKey?: string }[]).find((p) => p.globalKey === who.key)
  if (held) return held as ReturnType<typeof applyIntent> & object
  const person = { id: newId(), name: `${who.first} ${who.last}`, context: '', ring: 'intending', metAt: now, lines: [] as never[], reachedOut: 'sent' as const, globalKey: who.key }
  s.people.push(person)
  return person
}

/** The connection with this did arrived: the global card becomes an ordinary person in the connection's ring (unless it was sorted already). */
export function linkGlobal(person: { ring: string; globalKey?: string; peerId?: string; reachedOut?: string }, peer: { id: string; did: string; ring: string }): void {
  if (!person.globalKey || person.globalKey !== peer.did) return
  person.peerId = peer.id
  if (person.ring === 'intending') { person.ring = peer.ring; delete person.reachedOut }
}
