/**
 * Wave 16: "I want to play padel again before Thursday" (src/play_request.ts, play_prefs.ts, play_location.ts, play_match.ts).
 */
import { acceptPlayDraft, readPlayRequest } from '../../src/play_request.ts'
import { fillFromPrefs, livePlayPrefs, rememberPlay } from '../../src/play_prefs.ts'
import { distanceKm, isNear, textPicker } from '../../src/play_location.ts'
import { offerFits, playAsk } from '../../src/play_match.ts'

// Sunday 2026-10-18 17:00 local.
const NOW = new Date(2026, 9, 18, 17, 0).getTime()
const midnight = (y, m, d) => new Date(y, m, d).getTime()

describe('readPlayRequest: no model needed', () => {
  it('"before Thursday" ends at Thursday 00:00 and names the activity', () => {
    expect(readPlayRequest('I want to play padel again before Thursday', NOW)).toEqual({ activity: 'padel', beforeAt: midnight(2026, 9, 22) })
  })
  it('a deadline on the same weekday means next week, never "already over"', () => {
    const r = readPlayRequest('play tennis before Sunday', NOW)
    expect(r.beforeAt).toBe(midnight(2026, 9, 25))
  })
  it('reads area, radius and friend degree', () => {
    const r = readPlayRequest('Play padel near Wien 7 within 5 km, friends of friends, this week', NOW)
    expect(r).toMatchObject({ activity: 'padel', area: 'Wien 7', radiusKm: 5, reach: 2, beforeAt: midnight(2026, 9, 25) })
  })
  it('reads German', () => {
    const r = readPlayRequest('Ich möchte wieder Padel spielen bis Donnerstag', NOW)
    expect(r).toMatchObject({ activity: 'padel', beforeAt: midnight(2026, 9, 22) })
  })
  it('names nothing when there is no activity (nothing is guessed)', () => {
    expect(readPlayRequest('see you before Thursday', NOW)).toBeNull()
    expect(readPlayRequest('play again', NOW)).toBeNull()
  })
  it('tomorrow is a window, not a deadline', () => {
    expect(readPlayRequest('play padel tomorrow', NOW)).toMatchObject({ fromAt: midnight(2026, 9, 19), beforeAt: midnight(2026, 9, 20) })
  })
})

describe('acceptPlayDraft: a model fills the shape, the code decides', () => {
  it('takes a valid draft, as object or JSON, and drops out-of-range fields', () => {
    const d = { activity: ' Padel ', beforeAt: NOW + 3 * 86_400_000, radiusKm: 9999, reach: 99, area: 'Wien', extra: 'x' }
    expect(acceptPlayDraft(d, NOW)).toEqual({ activity: 'padel', beforeAt: NOW + 3 * 86_400_000, area: 'Wien' })
    expect(acceptPlayDraft(JSON.stringify({ activity: 'padel', reach: 2 }), NOW)).toEqual({ activity: 'padel', reach: 2 })
  })
  it('rejects garbage so the caller falls back to the deterministic reader', () => {
    for (const bad of [null, 5, 'not json', '{}', { activity: '' }, { activity: 3 }]) expect(acceptPlayDraft(bad, NOW)).toBeNull()
  })
})

describe('remembered settings fill what a sentence leaves out', () => {
  it('reuses area, radius and reach of the same activity; an explicit field wins and becomes the new default', () => {
    const first = readPlayRequest('play padel near Wien 7 within 5 km friends of friends', NOW)
    let prefs = rememberPlay(undefined, first, NOW)
    const next = fillFromPrefs(readPlayRequest('I want to play padel again before Thursday', NOW), prefs, NOW + 1000)
    expect(next).toMatchObject({ activity: 'padel', area: 'Wien 7', radiusKm: 5, reach: 2, beforeAt: midnight(2026, 9, 22) })
    prefs = rememberPlay(prefs, { ...next, reach: 1 }, NOW + 2000)
    expect(livePlayPrefs(prefs, NOW + 3000)).toHaveLength(1)
    expect(fillFromPrefs({ activity: 'padel' }, prefs, NOW + 3000).reach).toBe(1)
  })
  it('area travels between activities, trust (reach) does not', () => {
    const prefs = rememberPlay(undefined, { activity: 'padel', area: 'Wien 7', reach: 3 }, NOW)
    expect(fillFromPrefs({ activity: 'chess' }, prefs, NOW)).toEqual({ activity: 'chess', area: 'Wien 7', radiusKm: 10 })
  })
  it('an empty or foreign record reads as nothing and never throws', () => {
    expect(livePlayPrefs('x', NOW)).toEqual([])
    expect(fillFromPrefs({ activity: 'padel' }, [{ nope: 1 }, null], NOW)).toEqual({ activity: 'padel' })
  })
  it('forgets entries after a year', () => {
    const prefs = rememberPlay(undefined, { activity: 'padel', area: 'Wien' }, NOW)
    expect(livePlayPrefs(prefs, NOW + 366 * 86_400_000)).toEqual([])
  })
})

describe('location: the words are the place until a picker knows more', () => {
  it('the text picker returns the words, or null for nothing', async () => {
    expect(await textPicker.pick('  Wien 7 ')).toEqual({ label: 'Wien 7' })
    expect(await textPicker.pick('  ')).toBeNull()
  })
  it('distance with coordinates, word overlap without', () => {
    const wien = { label: 'Wien', lat: 48.2082, lon: 16.3738 }
    const graz = { label: 'Graz', lat: 47.0707, lon: 15.4395 }
    expect(Math.round(distanceKm(wien, graz))).toBe(145)
    expect(isNear(wien, graz, 50)).toBe(false)
    expect(isNear(wien, graz, 200)).toBe(true)
    expect(distanceKm({ label: 'a' }, wien)).toBeNull()
    expect(isNear({ label: 'Wien 7' }, { label: 'Wien' }, 5)).toBe(true)
    expect(isNear({ label: 'Graz' }, { label: 'Wien' }, 5)).toBe(false)
  })
})

describe('playAsk / offerFits', () => {
  it('compiles the request to an ordinary ask with the friend degree as reach (default 1)', () => {
    const r = { activity: 'padel', beforeAt: midnight(2026, 9, 22), area: 'Wien 7', radiusKm: 5 }
    expect(playAsk(r, 'en')).toEqual({ text: 'Looking to play padel before Thu, Oct 22 near Wien 7 (within 5 km)', reach: 1 })
    expect(playAsk({ activity: 'padel', reach: 2 }, 'en')).toEqual({ text: 'Looking to play padel', reach: 2 })
  })
  it('an offer fits on activity; areas are compared only when both sides state one', () => {
    const req = { activity: 'padel', area: 'Wien 7', radiusKm: 5 }
    expect(offerFits(req, { line: 'I play padel on weekday evenings' })).toBe(true)
    expect(offerFits(req, { line: 'I play padel', area: 'Wien' })).toBe(true)
    expect(offerFits(req, { line: 'I play padel', area: 'Graz' })).toBe(false)
    expect(offerFits(req, { line: 'I play tennis', area: 'Wien' })).toBe(false)
  })
})
