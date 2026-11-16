// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-bubble-connect: the connect links and chat texts of an introduction, and the zone an introduced person lands in. App side only (the MCP tool needs bubble_connect.ts). */
import { buildConnectLinkUrl } from '../../demo/src/connect_link'
import { INTRO_PARAM, type PeerRef, type Who } from './bubble_connect'
import { gateText } from './bubble_gate'
import { CHAT_TEXT_MAX } from './chat'
import { Ring } from './model'
import { S } from './strings'

/** The zone an introduced person lands in once accepted: "Friends & acquainted community members". */
export const INTRODUCED_RING = Ring.Friend

/** The connect link of `who` as a stranger opens it, marked as an introduction. */
function codeOf(origin: string, who: Who, peers: readonly PeerRef[]): string {
  const peer = peers.find((x) => x.id === who.peerId)!
  return `${buildConnectLinkUrl(origin, peer.did, { id: peer.id, displayName: peer.displayName })}&${INTRO_PARAM}=1`
}

/** The request to the acceptor: the requester's connect link, marked as an introduction. Null when it would not fit one chat message. */
export function requestText(appUrl: string, id: string, requester: Who, peers: readonly PeerRef[]): string | null {
  return gateText(appUrl, { k: 'req', id, name: peers.find((x) => x.id === requester.peerId)!.displayName, link: codeOf(appUrl, requester, peers) })
}

/** What the requester gets once the acceptor said yes: the acceptor's code. Null when it would not fit one chat message. */
export function codeText(origin: string, acceptor: Who, peers: readonly PeerRef[], myName: string): string | null {
  const text = S.introduceCodeText(myName, peers.find((x) => x.id === acceptor.peerId)!.displayName, codeOf(origin, acceptor, peers))
  return text.length <= CHAT_TEXT_MAX ? text : null
}

/** Friends & acquainted community members when the link is an introduction; null for any other link. */
export const introducedRing = (search: string): Ring | null => (new URLSearchParams(search).get(INTRO_PARAM) === '1' ? INTRODUCED_RING : null)

