// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * E3 (profile sections): the words of a section's "Who sees this" line, the chip label of an include/exclude id, and the keys of the
 * "as seen by" picker. Pure: no DOM and no import of the string table (the caller passes the words), so its unit test runs on its own.
 */
import type { Scope } from './share_sink/share_lines'
import type { Viewer, Zone as ProfileZone } from './profile'

export interface SummaryWords {
  /** "Friends and closer", "Only me", ... for a ladder zone. */
  zone: (zone: string) => string
  also: string
  except: string
}

/** `person:` → '@name', `tag:` → '#tag', `event:` → the tag label with the event mark. */
export function chipLabel(id: string, label: string, eventMark: (label: string) => string): string {
  if (id.startsWith('event:')) return eventMark(label)
  return (id.startsWith('person:') ? '@' : '#') + label
}

/** "Friends and closer · also #garden, Forum (event) · except @Ada". */
export function scopeSummary(scope: Scope, label: (id: string) => string, w: SummaryWords): string {
  return [
    w.zone(scope.zone),
    scope.include.length ? `${w.also} ${scope.include.map(label).join(', ')}` : '',
    scope.exclude.length ? `${w.except} ${scope.exclude.map(label).join(', ')}` : '',
  ].filter(Boolean).join(' · ')
}

/** The zones the picker offers as "Someone on ...", most intimate first. */
export const VIEWER_ZONES: readonly ProfileZone[] = ['close', 'friend', 'acquaintance', 'intending', 'public']

export const viewerKey = (v: Viewer): string => (v.kind === 'zone' ? `zone:${v.zone}` : `${v.kind}:${v.id}`)

/** The viewer a picker value stands for, or null for anything else. */
export function viewerOf(key: string): Viewer | null {
  const at = key.indexOf(':')
  if (at < 0) return null
  const kind = key.slice(0, at)
  const rest = key.slice(at + 1)
  if (!rest) return null
  if (kind === 'zone') return (VIEWER_ZONES as readonly string[]).includes(rest) ? { kind: 'zone', zone: rest as ProfileZone } : null
  return kind === 'person' || kind === 'tag' || kind === 'event' ? { kind, id: rest } : null
}
