// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the messenger links typed on a person's card (Person.links). This phone only; absent = none. Pure, no DOM. */
import type { Person } from './model'

export const LINK_KINDS = ['signal', 'whatsapp', 'other'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/** Sets (or, for an empty value, clears) one link. False = nothing changed: not an http(s) link, or nothing to clear. */
export function setLink(p: Pick<Person, 'links'>, kind: LinkKind, raw: string): boolean {
  const v = raw.trim()
  if (v) {
    try { if (!/^https?:$/.test(new URL(v).protocol)) return false } catch { return false }
    p.links = { ...p.links, [kind]: v }
    return true
  }
  if (!p.links?.[kind]) return false
  const { [kind]: _gone, ...rest } = p.links
  if (Object.keys(rest).length) p.links = rest; else delete p.links
  return true
}

export const linkEntries = (p: Pick<Person, 'links'>): { kind: LinkKind; url: string }[] =>
  LINK_KINDS.flatMap((kind) => { const url = p.links?.[kind]; return url ? [{ kind, url }] : [] })
