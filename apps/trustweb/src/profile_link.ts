// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40: a connection link may carry a Variation (profile id, `tp`) in its fragment; the receiver is asked to open with it. Pure, no DOM. */
import { TW_PROFILES, type ProfileId } from './ext/profiles'

const KEY = 'tp'

/** The link with `tp=<id>` in its fragment (an old `tp` is replaced, other fragment parts stay). */
export function withProfile(link: string, id: ProfileId): string {
  const at = link.indexOf('#')
  const base = at < 0 ? link : link.slice(0, at)
  const q = new URLSearchParams(at < 0 ? '' : link.slice(at + 1))
  q.set(KEY, id)
  return `${base}#${q.toString()}`
}

/** The profile a link's fragment names; null when absent or not one this build knows. */
export function profileOfLink(hash: string): ProfileId | null {
  const id = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(KEY)
  return TW_PROFILES.find((p) => p.id === id)?.id ?? null
}
