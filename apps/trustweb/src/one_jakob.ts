/**
 * N6, one Jakob (wave 6; Jakob 2026-10-08: "people should be able to still see
 * their profile and be connected to me"). A demo account opened from Jakob's
 * code connects to two peers: his phone and his front door
 * (services/trustweb-peer, demo-peer.json, also named Jakob). They are ONE
 * person: the front door is his inventory. So the front door is kept as a
 * second peer (both are asked, as before) but shown as the same person node:
 * Person.doorPeerId.
 *
 * When are they the same person? Only when the link that made the account
 * names the front door (provenance) AND that front door carries the inviter's
 * own name: a demo account made by somebody else on the same site also names
 * Jakob's front door, and there the two stay two people. Pure and DOM-free.
 */
import { passesAsksOn } from './model'
import type { AppState, Peer, Person } from './model'

/** Names compare like the front door's grant list does: NFC, trimmed, spaces collapsed, lower case. */
export function sameName(a: string, b: string): boolean {
  const k = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
  return k(a) !== '' && k(a) === k(b)
}

/** The person a peer belongs to: by its own peer, or as that person's front door. */
export function personOfPeer(s: Pick<AppState, 'people'>, peerId: string): Person | undefined {
  return s.people.find((p) => p.peerId === peerId) ?? s.people.find((p) => p.doorPeerId === peerId)
}

/**
 * Connecting a demo account: the front door named in its link joins the
 * inviter's person when it carries the inviter's name. True: joined (no second
 * node). False: a person of its own is needed, as before.
 */
export function joinFrontDoor(inviter: Person | undefined, doorPeerId: string, doorName: string): boolean {
  if (!inviter || !sameName(inviter.name, doorName) || inviter.peerId === doorPeerId) return false
  inviter.doorPeerId = doorPeerId
  return true
}

/**
 * Records made before wave 6 (a demo account with "Jakob" twice): the front
 * door's own person (its context is the front-door line, it holds no notes and
 * carries the owner's name) folds into the owner's person. Idempotent, never
 * throws on a malformed record (it then changes nothing). True when it changed something.
 */
export function mergeOneJakob(s: AppState, doorContext: string): boolean {
  try {
    const owner = s.testOf?.name
    if (!owner || !Array.isArray(s.people)) return false
    const door = s.people.find((p) => p.context === doorContext && p.peerId && p.lines.length === 0 && sameName(p.name, owner))
    const inviter = s.people.find((p) => p !== door && p.peerId && !p.doorPeerId && sameName(p.name, owner))
    if (!door?.peerId || !inviter) return false
    inviter.doorPeerId = door.peerId
    s.people = s.people.filter((p) => p !== door)
    return true
  } catch {
    return false
  }
}

/**
 * Wave 6: may this peer's asks go on through this phone? Jakob 2026-10-09 ("make the default yes"): yes for a person in my web
 * unless their "Pass their asks on" is switched off (model.ts passesAsksOn). A peer without a person card (a front door, a demo
 * account) is not a person I chose to connect with: it passes on only if a card for it says so, as since wave 6f S1.
 * `ownDoorDid` is kept for the callers and samePersonTarget.
 */
export function passOnAllowed(s: Pick<AppState, 'people' | 'testAccounts'>, peer: Peer, _ownDoorDid: string | null): boolean {
  const person = personOfPeer(s, peer.id)
  return person ? passesAsksOn(person) : false
}

/**
 * Wave 6: never pass an ask on to the same person twice: this phone's own
 * front door (it would answer with this phone's public lines "through" this
 * phone), or the sender's other peer (their phone and their front door are one
 * person, who was asked already).
 */
export function samePersonTarget(s: Pick<AppState, 'people'>, target: Peer, sender: Peer, ownDoorDid: string | null): boolean {
  if (ownDoorDid !== null && target.did === ownDoorDid) return true
  const of = personOfPeer(s, sender.id)
  return Boolean(of) && personOfPeer(s, target.id) === of
}

/**
 * This phone's own front door, if the site publishes one: the card's did when
 * the card carries this phone's own name and the phone is not a demo account
 * (Jakob's phone and his front door "Jakob"); null otherwise. Anyone else
 * connected to that front door treats it as the separate peer it is for them.
 */
export function ownFrontDoor(s: Pick<AppState, 'me' | 'testOf'>, card: { did: string; name: string } | null | undefined): string | null {
  if (!card || s.testOf) return null
  return sameName(card.name, s.me.displayName) ? card.did : null
}
