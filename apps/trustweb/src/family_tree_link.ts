// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * A connect link from the Stammbaum (trust-family) may carry a family tree: `#tree=<share id>&k=<key>[&family=1]` after the usual
 * `?connect=…` (evobiosys.org/stammbaum/ makes the link). After the connect the phone offers "View the family tree", which opens
 * the Stammbaum page with the same id and key.
 *
 * The key lives in the FRAGMENT only: a browser never sends it to a server, and this module only builds a url on this phone; the
 * relay and every TrustWeb server see neither id nor key. `family=1` puts the new contact on the family ring.
 */
import { CLOSENESS_KEY, Ring, RINGS, type Person } from './model'

export const TREE_PAGE = 'https://evobiosys.org/stammbaum/'

export interface TreeLink {
  /** The Stammbaum share id: 20 base32 characters. */
  id: string
  /** The share's passphrase (base32 groups). */
  key: string
  family: boolean
}

const ID_RE = /^[a-z2-7]{20}$/
const KEY_RE = /^[A-Z2-7-]{8,64}$/

/** The tree parts of any fragment ("#..." or bare); null unless both are well-formed. */
export function parseTreeFragment(hash: string): TreeLink | null {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const id = q.get('tree') ?? ''
  const key = q.get('k') ?? ''
  if (!ID_RE.test(id) || !KEY_RE.test(key)) return null
  return { id, key, family: q.get('family') === '1' }
}

/** The Stammbaum url that shows this tree (`#teilen=` is the Stammbaum's own share fragment). */
export const treeUrl = (l: TreeLink): string => `${TREE_PAGE}#teilen=${l.id}&k=${l.key}`

/** The family ring keeps the closeness the person was filed under (a ring of RINGS), else Close. */
export function applyFamily(p: Pick<Person, 'ring' | 'fields'>): void {
  if (p.ring === Ring.Family) return
  p.fields = { ...p.fields, [CLOSENESS_KEY]: RINGS.includes(p.ring) ? p.ring : Ring.Close }
  p.ring = Ring.Family
}
