// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Major features, newest last in time (version = release date, compared as text). The in-app notification offer appears only when one of
 * these is newer than the last one the owner was asked about: new import sources, new possibilities, never routine fixes.
 */
export interface Feature { version: string; title: string }

export const FEATURES: readonly Feature[] = [
  { version: '2026-11-04', title: 'Import your contacts from WhatsApp chat exports' },
]

/** Phones that were asked under the old once-only flag (notifOffered) count as having seen everything up to here. */
export const NOTIF_BASELINE = '2026-11-03'

export const latestFeature = (features: readonly Feature[]): Feature | undefined =>
  features.reduce<Feature | undefined>((a, f) => (!a || f.version > a.version ? f : a), undefined)

export const notifSeenOf = (s: { notifOffered?: boolean; notifFeatureSeen?: string }): string | undefined =>
  s.notifFeatureSeen ?? (s.notifOffered ? NOTIF_BASELINE : undefined)

export function shouldOfferNotifications(seen: string | undefined, features: readonly Feature[]): boolean {
  const latest = latestFeature(features)
  return !!latest && (seen === undefined || latest.version > seen)
}
