/**
 * Changing the main name (the link trustweb.one/<name>) from the tappable link in Settings. The server REPLACES the main name on a plain
 * claim (connect_aliases.mjs planClaim: "a new primary replaces the old one"): the old name is freed, not kept as an alias, so the old
 * link stops working for everyone and anyone may claim that name. So the person is asked before anything is sent.
 */
import { ClaimError } from './connect_code'
import { cleanName, isLocked, isSendableName } from './names_sync'
import type { NamesOutcome, NamesState } from './names_sync'

export enum LinkChange { Done = 'done', Cancelled = 'cancelled', Same = 'same', Bad = 'bad', Locked = 'locked', Refused = 'refused' }

export type LinkChangeResult =
  | { kind: LinkChange.Done; names: NamesState }
  | { kind: LinkChange.Refused; error: ClaimError }
  | { kind: Exclude<LinkChange, LinkChange.Done | LinkChange.Refused> }

export interface LinkChangeDeps {
  names: NamesState
  raw: string
  /** "Are you sure?": true = go ahead. */
  confirm: (from: string, to: string) => Promise<boolean>
  claim: (name: string) => Promise<NamesOutcome>
}

export async function changePrimaryName(d: LinkChangeDeps): Promise<LinkChangeResult> {
  const to = cleanName(d.raw)
  if (!isSendableName(to)) return { kind: LinkChange.Bad }
  if (to === d.names.name) return { kind: LinkChange.Same }
  if (d.names.name && isLocked(d.names, d.names.name)) return { kind: LinkChange.Locked }
  if (!(await d.confirm(d.names.name, to))) return { kind: LinkChange.Cancelled }
  const out = await d.claim(to)
  return out.ok ? { kind: LinkChange.Done, names: out.names } : { kind: LinkChange.Refused, error: out.error }
}
