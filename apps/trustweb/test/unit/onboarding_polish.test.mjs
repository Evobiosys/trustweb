// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { showOnboarding, dismissOnboarding, resultOf } from '../../src/onboarding_place.ts'
import { FEATURES, NOTIF_BASELINE, shouldOfferNotifications, notifSeenOf, latestFeature } from '../../src/features.ts'
import { VERIFIED_SOURCES, COMING_SOURCES } from '../../src/import_sources.ts'
import { SYNC_EXCLUDED } from '../../src/sync_core.ts'
import { S } from '../../src/strings.ts'

describe('Not now on the empty-state card', () => {
  it('writes a settings flag that keeps the card away, also after a reload', () => {
    const s = { people: [] }
    expect(showOnboarding(s, false)).toBe(true)
    dismissOnboarding(s)
    expect(s.onbDismissed).toBe(true)
    expect(showOnboarding(s, false)).toBe(false)
  })
  it('stays on this phone: not part of the synced settings', () => expect(SYNC_EXCLUDED.has('onbDismissed')).toBe(true))
})

describe('shouldOfferNotifications', () => {
  const f = [{ version: '2026-11-04', title: 'a' }, { version: '2026-12-01', title: 'b' }]
  it('never asks when no major feature is listed', () => expect(shouldOfferNotifications(undefined, [])).toBe(false))
  it('asks a person who was never asked', () => expect(shouldOfferNotifications(undefined, f)).toBe(true))
  it('does not ask again for a feature already offered', () => expect(shouldOfferNotifications('2026-12-01', f)).toBe(false))
  it('asks again when a newer feature shipped', () => expect(shouldOfferNotifications('2026-11-04', f)).toBe(true))
  it('latestFeature is the highest version, whatever the order', () => expect(latestFeature([f[1], f[0]]).version).toBe('2026-12-01'))
  it('the shipped list names the WhatsApp import as the newest feature', () => {
    expect(FEATURES.length).toBeGreaterThan(0)
    expect(latestFeature(FEATURES).version > NOTIF_BASELINE).toBe(true)
  })
  it('an old "offered" flag counts as having seen the baseline', () => {
    expect(notifSeenOf({ notifOffered: true })).toBe(NOTIF_BASELINE)
    expect(notifSeenOf({ notifOffered: true, notifFeatureSeen: '2026-11-04' })).toBe('2026-11-04')
    expect(notifSeenOf({})).toBeUndefined()
  })
})

describe('import sources', () => {
  it('lists WhatsApp and the contact-file sources as verified', () => expect(VERIFIED_SOURCES.map((x) => x.id)).toEqual(['whatsapp', 'vcard', 'google-csv', 'dex-csv', 'generic-csv']))
  it('never lists a source as both verified and coming', () => {
    const v = new Set(VERIFIED_SOURCES.map((x) => x.id))
    expect(COMING_SOURCES.filter((x) => v.has(x.id))).toEqual([])
  })
})

describe('many chats', () => {
  it('the steps tell the owner to pick several files at once', () => {
    expect(S.onbStepsDesktop.join(' ')).toMatch(/several files at once/)
    expect(S.onbStepsAndroid.join(' ')).toMatch(/several/)
  })
  it('resultOf counts chats over all files', () => {
    expect(resultOf([], 3).chats).toBe(3)
    expect(S.onbResult(5, 2, 2, 1, 3)).toMatch(/in 3 chats/)
    expect(S.onbResult(1, 1, 0, 0, 1)).not.toMatch(/chats/)
  })
})
