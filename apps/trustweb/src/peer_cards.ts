/**
 * Wave 6f, THE ONE THING: every connection has its own card in the web, and a card stays with the connection it was made for.
 *
 * Root cause found by reproduction (test/e2e/offline_connect_flow.mjs part G): while the Meet page shows this phone's code, the first
 * person who connects names the Meet draft; the next one who connected was then matched to the card OF THAT NAME and the card was moved
 * over to the new connection. Two people connected, one card in the web, the second person invisible (and the first one's card silently
 * pointed at someone else). Here: a draft name only ever claims a card that is not linked to a connection yet.
 *
 * repairPeerCards() mends records that already went wrong (boot, idempotent, never throws):
 *   1. a merged card: card C is linked to connection Y, but carries the name of connection X, which has no card of its own, while Y is
 *      called something else: C goes back to X (its notes were about X) and Y gets a card of its own. What arrived from Y over the wire
 *      after Y connected (the contact links of contact_share.ts) moves with Y.
 *   2. a connection without any card (an older build, a card lost): it gets one, named as the connection is.
 * Connections of a demo account's own view, of the side-by-side demo, and front doors already joined to a person (doorPeerId) are
 * left as they are by the caller and by personOf().
 *
 * Pure and DOM-free.
 */
import type { AppState, Peer, Person } from './model'
import { sameName } from './one_jakob'

/** The card a connection already has (its own, or the person its front door joined). */
export function personOf(people: readonly Person[], peerId: string): Person | undefined {
  return people.find((p) => p.peerId === peerId) ?? people.find((p) => p.doorPeerId === peerId)
}

/**
 * The card a NEW connection lands on: its own, else a card named like the Meet draft that is NOT linked to any connection yet
 * (a meeting noted first, connected after). Undefined: it needs a card of its own.
 */
export function cardForNewPeer(people: readonly Person[], peer: Pick<Peer, 'id'>, draftName: string): Person | undefined {
  const own = personOf(people, peer.id)
  if (own) return own
  const name = draftName.trim()
  if (!name) return undefined
  return people.find((p) => !p.peerId && sameName(p.name, name))
}

/** A fresh card for a connection, in its ring. */
export function cardFor(peer: Peer, id: string, context: string, now: number): Person {
  return { id, name: peer.displayName, context, ring: peer.ring, metAt: now, lines: [], peerId: peer.id }
}

/** What arrived over the wire for a card after `since`: moves with the connection it came from. */
function moveWireContact(from: Person, to: Person, since: number): void {
  if (typeof from.theirChannelsAt !== 'number' || from.theirChannelsAt < since) return
  to.theirChannels = from.theirChannels
  to.theirChannelsAt = from.theirChannelsAt
  if (from.theirSignalProvider !== undefined) to.theirSignalProvider = from.theirSignalProvider
  delete from.theirChannels
  delete from.theirChannelsAt
  delete from.theirSignalProvider
}

/** Step 1: unmerge cards that a later connection took over. True when something changed. */
function unmerge(s: AppState, keep: (peer: Peer) => boolean, newId: () => string, context: string, now: number): boolean {
  let changed = false
  for (const card of [...s.people]) {
    if (!card.peerId) continue
    const holder = s.peers.find((p) => p.id === card.peerId)
    if (!holder || sameName(holder.displayName, card.name)) continue
    const owner = s.peers.find((p) => p.id !== holder.id && keep(p) && sameName(p.displayName, card.name) && !personOf(s.people, p.id))
    if (!owner) continue
    card.peerId = owner.id
    const own = cardFor(holder, newId(), context, now)
    moveWireContact(card, own, holder.connectedAt)
    s.people.push(own)
    changed = true
  }
  return changed
}

/** Step 2: every connection the caller keeps gets a card. True when something changed. */
function fillMissing(s: AppState, keep: (peer: Peer) => boolean, newId: () => string, context: string, now: number): boolean {
  let changed = false
  for (const peer of s.peers) {
    if (!keep(peer) || personOf(s.people, peer.id)) continue
    s.people.push(cardFor(peer, newId(), context, now))
    changed = true
  }
  return changed
}

/**
 * Mends merged and missing cards (see the module header). `keep(peer)` says which connections must have a card (the caller leaves out
 * the side-by-side demo and demo accounts). Idempotent; a malformed record changes nothing. True when it changed something.
 */
export function repairPeerCards(s: AppState, keep: (peer: Peer) => boolean, newId: () => string, context: string, now: number): boolean {
  try {
    if (!Array.isArray(s.people) || !Array.isArray(s.peers)) return false
    const a = unmerge(s, keep, newId, context, now)
    const b = fillMissing(s, keep, newId, context, now)
    return a || b
  } catch {
    return false
  }
}
