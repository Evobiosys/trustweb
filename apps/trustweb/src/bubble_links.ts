// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-bubble-connect: the connect links and chat texts of an introduction, and the zone an introduced person lands in. App side only (the MCP tool needs bubble_connect.ts). */
import { buildConnectLinkUrl } from '../../demo/src/connect_link'
import { INTRO_PARAM, type PeerRef, type Who } from './bubble_connect'
import { CHAT_TEXT_MAX } from './chat'
import { Ring } from './model'

/** The zone an introduced person lands in once accepted: "Friends & acquainted community members". */
export const INTRODUCED_RING = Ring.Friend

/** The connect link of `who` as a stranger opens it, marked as an introduction. */
function codeOf(origin: string, who: Who, peers: readonly PeerRef[]): string {
  const peer = peers.find((x) => x.id === who.peerId)!
  return `${buildConnectLinkUrl(origin, peer.did, { id: peer.id, displayName: peer.displayName })}&${INTRO_PARAM}=1`
}

/** What each of the two gets: the other's code. Null when a text would not fit one chat message. */
export function introduceTexts(origin: string, a: Who, b: Who, peers: readonly PeerRef[], myName: string): { toA: { peerId: string; text: string }; toB: { peerId: string; text: string } } | null {
  const text = (to: Who, other: Who): { peerId: string; text: string } => ({ peerId: to.peerId!, text: `${myName} introduces you to ${peers.find((x) => x.id === other.peerId)!.displayName}: ${codeOf(origin, other, peers)}` })
  const out = { toA: text(a, b), toB: text(b, a) }
  return out.toA.text.length <= CHAT_TEXT_MAX && out.toB.text.length <= CHAT_TEXT_MAX ? out : null
}

/** Friends & acquainted community members when the link is an introduction; null for any other link. */
export const introducedRing = (search: string): Ring | null => (new URLSearchParams(search).get(INTRO_PARAM) === '1' ? INTRODUCED_RING : null)

