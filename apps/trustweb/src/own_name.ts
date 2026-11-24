// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave46 iyg-reviewfix D2: the name a connected person announced themselves (their hello or connect link, Peer.displayName), never the label I gave their
 * card (Person.name, private to me). Anything that tells a third person who somebody is uses this; '' = they announced none (the caller leaves them out).
 */
import { NAMELESS_PEER, cleanHelloName } from './hello'

export function ownName(s: { peers?: readonly { id: string; displayName: string }[] }, p: { peerId?: string }): string {
  const n = cleanHelloName(s.peers?.find((x) => x.id === p.peerId)?.displayName ?? '')
  return p.peerId && n !== NAMELESS_PEER ? n : ''
}
