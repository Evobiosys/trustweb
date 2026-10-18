/**
 * Wave 16: "I want to play padel again before Thursday" (src/together_request.ts, together_prefs.ts, together_location.ts, together_match.ts).
 */
import { acceptTogetherDraft, readTogetherRequest } from '../../src/together_request.ts'
import { fillFromPrefs, liveTogetherPrefs, rememberTogether } from '../../src/together_prefs.ts'
import { distanceKm, isNear, textPicker } from '../../src/together_location.ts'
import { offerFits, togetherAsk } from '../../src/together_match.ts'

// Sunday 2026-10-18 17:00 local.
const NOW = new Date(2026, 9, 18, 17, 0).getTime()
const midnight = (y, m, d) => new Date(y, m, d).getTime()

describe('readTogetherRequest: no model needed', () => {
  it('"before Thursday" ends at Thursday 00:00 and names the activity', () => {
    expect(readTogetherRequest('I want to play padel again before Thursday', NOW)).toEqual({ activity: 'padel', phrase: 'play padel', beforeAt: midnight(2026, 9, 22) })
  })
  it('a deadline on the same weekday means next week, never "already over"', () => {
    const r = readTogetherRequest('play tennis before Sunday', NOW)
    expect(r.beforeAt).toBe(midnight(2026, 9, 25))
  })
  it('reads area, radius and friend degree', () => {
    const r = readTogetherRequest('Play padel near Wien 7 within 5 km, friends of friends, this week', NOW)
    expect(r).toMatchObject({ activity: 'padel', area: 'Wien 7', radiusKm: 5, reach: 2, beforeAt: midnight(2026, 9, 25) })
  })
  it('reads German', () => {
    const r = readTogetherRequest('Ich möchte wieder Padel spielen bis Donnerstag', NOW)
    expect(r).toMatchObject({ activity: 'padel', beforeAt: midnight(2026, 9, 22) })
  })
  it('is not about padel: any "I want to X together" works', () => {
    expect(readTogetherRequest('Who wants to go hiking with me this weekend?', NOW)).toMatchObject({ activity: 'hiking', phrase: 'go hiking' })
    expect(readTogetherRequest('I want to cook together near Wien 7', NOW)).toMatchObject({ activity: 'cook', area: 'Wien 7' })
    expect(readTogetherRequest('Ich möchte wandern gehen zusammen bis Freitag', NOW)).toMatchObject({ activity: 'wandern', beforeAt: midnight(2026, 9, 23) })
  })
  it('names nothing when there is no activity (nothing is guessed)', () => {
    expect(readTogetherRequest('see you before Thursday', NOW)).toBeNull()
    expect(readTogetherRequest('play again', NOW)).toBeNull()
  })
  it('tomorrow is a window, not a deadline', () => {
    expect(readTogetherRequest('play padel tomorrow', NOW)).toMatchObject({ fromAt: midnight(2026, 9, 19), beforeAt: midnight(2026, 9, 20) })
  })
})

describe('acceptTogetherDraft: a model fills the shape, the code decides', () => {
  it('takes a valid draft, as object or JSON, and drops out-of-range fields', () => {
    const d = { activity: ' Padel ', beforeAt: NOW + 3 * 86_400_000, radiusKm: 9999, reach: 99, area: 'Wien', extra: 'x' }
    expect(acceptTogetherDraft(d, NOW)).toEqual({ activity: 'padel', beforeAt: NOW + 3 * 86_400_000, area: 'Wien' })
    expect(acceptTogetherDraft(JSON.stringify({ activity: 'padel', reach: 2 }), NOW)).toEqual({ activity: 'padel', reach: 2 })
  })
  it('rejects garbage so the caller falls back to the deterministic reader', () => {
    for (const bad of [null, 5, 'not json', '{}', { activity: '' }, { activity: 3 }]) expect(acceptTogetherDraft(bad, NOW)).toBeNull()
  })
})

describe('remembered settings fill what a sentence leaves out', () => {
  it('reuses area, radius and reach of the same activity; an explicit field wins and becomes the new default', () => {
    const first = readTogetherRequest('play padel near Wien 7 within 5 km friends of friends', NOW)
    let prefs = rememberTogether(undefined, first, NOW)
    const next = fillFromPrefs(readTogetherRequest('I want to play padel again before Thursday', NOW), prefs, NOW + 1000)
    expect(next).toMatchObject({ activity: 'padel', area: 'Wien 7', radiusKm: 5, reach: 2, beforeAt: midnight(2026, 9, 22) })
    prefs = rememberTogether(prefs, { ...next, reach: 1 }, NOW + 2000)
    expect(liveTogetherPrefs(prefs, NOW + 3000)).toHaveLength(1)
    expect(fillFromPrefs({ activity: 'padel' }, prefs, NOW + 3000).reach).toBe(1)
  })
  it('nothing crosses to another activity: a place chosen for padel is not added to a language tandem', () => {
    const prefs = rememberTogether(undefined, { activity: 'padel', area: 'Wien 7', reach: 3 }, NOW)
    expect(fillFromPrefs({ activity: 'spanish' }, prefs, NOW)).toEqual({ activity: 'spanish' })
  })
  it('area and radius come from one entry; a named area does not inherit the old radius', () => {
    const prefs = rememberTogether(undefined, { activity: 'padel', area: 'Wien 7', radiusKm: 5 }, NOW)
    expect(fillFromPrefs({ activity: 'padel', area: 'Graz' }, prefs, NOW)).toEqual({ activity: 'padel', area: 'Graz', radiusKm: 10 })
  })
  it('malformed or future-dated stored entries are dropped', () => {
    const bad = [{ at: NOW, activity: 'padel', area: {} }, { at: NOW, activity: 'padel', radiusKm: '9999' }, { at: NOW, activity: 'padel', reach: 99 }, { at: NOW + 9e9, activity: 'padel' }]
    expect(liveTogetherPrefs(bad, NOW)).toEqual([])
  })
  it('an empty or foreign record reads as nothing and never throws', () => {
    expect(liveTogetherPrefs('x', NOW)).toEqual([])
    expect(fillFromPrefs({ activity: 'padel' }, [{ nope: 1 }, null], NOW)).toEqual({ activity: 'padel' })
  })
  it('forgets entries after a year', () => {
    const prefs = rememberTogether(undefined, { activity: 'padel', area: 'Wien' }, NOW)
    expect(liveTogetherPrefs(prefs, NOW + 366 * 86_400_000)).toEqual([])
  })
})

describe('an ordinary ask is never rewritten into a together request', () => {
  it.each([
    'I would like to borrow a tent', 'I want to sell my sofa before Thursday', 'I will bring a ladder', 'I will be in Graz on Monday',
    'I need someone to fix my bike', 'I would like to know who has a car', 'Ich möchte eine Bohrmaschine ausleihen',
    'Does anyone have loudspeakers I could borrow?', 'Who is hiring?', 'Who wants to play?', 'I want to play',
  ])('%s', (text) => expect(readTogetherRequest(text, NOW)).toBeNull())
  it('a bare lower-case "in" is not a place', () => {
    expect(readTogetherRequest('Who wants to do yoga in the park', NOW)).toMatchObject({ activity: 'yoga' })
    expect(readTogetherRequest('Who wants to do yoga in the park', NOW).area).toBeUndefined()
    expect(readTogetherRequest('I want to do yoga together in Wien', NOW)).toMatchObject({ activity: 'yoga', area: 'Wien' })
  })
  it('German word order: time words are not the activity', () => {
    expect(readTogetherRequest('Ich will morgen Tennis spielen', NOW)).toMatchObject({ activity: 'tennis' })
    expect(readTogetherRequest('Wer will mit mir wandern gehen?', NOW)).toMatchObject({ activity: 'wandern' })
  })
})

describe('dates are calendar days (clock changes, weekends)', () => {
  const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime()
  it('"this weekend" on a Saturday or Sunday is the running weekend', () => {
    expect(readTogetherRequest('play padel this weekend', at(2026, 9, 24))).toMatchObject({ fromAt: midnight(2026, 9, 24), beforeAt: midnight(2026, 9, 26) })
    expect(readTogetherRequest('play padel this weekend', at(2026, 9, 25))).toMatchObject({ fromAt: midnight(2026, 9, 25), beforeAt: midnight(2026, 9, 26) })
    expect(readTogetherRequest('play padel this weekend', NOW)).toMatchObject({ fromAt: midnight(2026, 9, 18), beforeAt: midnight(2026, 9, 19) })
    expect(readTogetherRequest('play padel this weekend', at(2026, 9, 21))).toMatchObject({ fromAt: midnight(2026, 9, 24), beforeAt: midnight(2026, 9, 26) })
  })
  it('"tomorrow" and "on Friday" end at the next local midnight, also across the autumn clock change', () => {
    const sat = at(2026, 9, 24) // the day before the clock goes back (Europe/Vienna 25 Oct); in other zones the days are plain 24 h
    expect(readTogetherRequest('play padel tomorrow', sat)).toMatchObject({ fromAt: midnight(2026, 9, 25), beforeAt: midnight(2026, 9, 26) })
    expect(readTogetherRequest('play padel on Sunday', NOW)).toMatchObject({ fromAt: midnight(2026, 9, 25), beforeAt: midnight(2026, 9, 26) })
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

describe('togetherAsk / offerFits', () => {
  it('compiles the request to an ordinary ask with the friend degree as reach (default 1)', () => {
    const r = { activity: 'padel', beforeAt: midnight(2026, 9, 22), area: 'Wien 7', radiusKm: 5 }
    expect(togetherAsk(r, 'en')).toEqual({ text: 'Looking for company: padel before Thu, Oct 22 near Wien 7 (within 5 km)', reach: 1 })
    expect(togetherAsk({ activity: 'padel', reach: 2 }, 'en')).toEqual({ text: 'Looking for company: padel', reach: 2 })
  })
  it('says "on <day>" for one day and "from X to Y" for a span', () => {
    expect(togetherAsk({ activity: 'padel', fromAt: midnight(2026, 9, 23), beforeAt: midnight(2026, 9, 24) }, 'en').text).toBe('Looking for company: padel on Fri, Oct 23')
    expect(togetherAsk({ activity: 'padel', fromAt: midnight(2026, 9, 24), beforeAt: midnight(2026, 9, 26) }, 'en').text).toBe('Looking for company: padel from Sat, Oct 24 to Sun, Oct 25')
  })
  it('an offer matches whole words only', () => {
    expect(offerFits({ activity: 'cook' }, { line: 'I love a cookie' })).toBe(false)
    expect(offerFits({ activity: 'hiking' }, { line: 'weekend hikes' })).toBe(false)
    expect(offerFits({ activity: 'cook' }, { line: 'I cook on Sundays' })).toBe(true)
  })
  it('an offer fits on activity; areas are compared only when both sides state one', () => {
    const req = { activity: 'padel', area: 'Wien 7', radiusKm: 5 }
    expect(offerFits(req, { line: 'I play padel on weekday evenings' })).toBe(true)
    expect(offerFits(req, { line: 'I play padel', area: 'Wien' })).toBe(true)
    expect(offerFits(req, { line: 'I play padel', area: 'Graz' })).toBe(false)
    expect(offerFits(req, { line: 'I play tennis', area: 'Wien' })).toBe(false)
  })
})
