/**
 * Wave 19: the parts wave 16 removed come back with callers: the geolocation picker (dock), the fit line on incoming
 * "Looking for company" asks, and the LLM-draft hook (off until a model hook exists).
 */
import { geoPicker } from '../../src/together_location.ts'
import { fitOfAsk, readTogetherAsk, togetherAsk } from '../../src/together_match.ts'
import { liveTogetherPrefs, rememberTogether } from '../../src/together_prefs.ts'
import { draftOrPlain, TOGETHER_LLM_DRAFT } from '../../src/together_request.ts'

const NOW = new Date(2026, 9, 18, 17, 0).getTime()
const geo = (pos) => ({ getCurrentPosition: (ok, bad) => (pos ? ok({ coords: pos }) : bad({ code: 1 })) })

describe('geoPicker', () => {
  it('uses the device position with the typed label, rounded to ~1 km, no network', async () => {
    const p = await geoPicker(geo({ latitude: 48.20849, longitude: 16.37208 })).pick(' Wien 7 ')
    expect(p).toEqual({ label: 'Wien 7', lat: 48.21, lon: 16.37 })
  })
  it('keeps the label empty when nothing was typed: the coordinates stay local, the ask names no area', async () => {
    expect(await geoPicker(geo({ latitude: 1, longitude: 2 })).pick('  ')).toEqual({ label: '', lat: 1, lon: 2 })
  })
  it('falls back to the typed words when denied or unavailable, null when there are none', async () => {
    expect(await geoPicker(geo(null)).pick('Graz')).toEqual({ label: 'Graz' })
    expect(await geoPicker(undefined).pick('Graz')).toEqual({ label: 'Graz' })
    expect(await geoPicker(geo(null)).pick('')).toBeNull()
  })
  it('asks nothing until pick() is called', () => {
    let calls = 0
    geoPicker({ getCurrentPosition: () => { calls++ } })
    expect(calls).toBe(0)
  })
})

describe('together prefs keep the picked place', () => {
  it('round-trips area with lat/lon, drops invalid coordinates', () => {
    const req = { activity: 'padel', area: 'Wien 7', radiusKm: 5 }
    const list = rememberTogether(undefined, req, NOW, { label: 'Wien 7', lat: 48.21, lon: 16.37 })
    expect(liveTogetherPrefs(list, NOW)[0]).toMatchObject({ activity: 'padel', area: 'Wien 7', lat: 48.21, lon: 16.37 })
    expect(liveTogetherPrefs([{ ...list[0], lat: 999 }], NOW)).toEqual([])
    const typed = rememberTogether(undefined, req, NOW, { label: 'other' })
    expect(liveTogetherPrefs(typed, NOW)[0].lat).toBeUndefined()
  })
})

describe('readTogetherAsk / fitOfAsk', () => {
  it('reads back what togetherAsk wrote', () => {
    const r = { activity: 'padel', phrase: 'play padel', area: 'Wien 7', radiusKm: 5, beforeAt: new Date(2026, 9, 22).getTime() }
    expect(readTogetherAsk(togetherAsk(r, 'en').text)).toMatchObject({ activity: 'padel', area: 'Wien 7', radiusKm: 5 })
    expect(readTogetherAsk('Looking for company: hiking')).toEqual({ activity: 'hiking' })
    expect(readTogetherAsk('Can I borrow a tent?')).toBeNull()
  })
  const prefs = (...r) => r.reduce((l, q, i) => rememberTogether(l, q, NOW + i), undefined)
  it('fits an own setting of the same activity; an area is compared only when both have one', () => {
    const l = prefs({ activity: 'padel', area: 'Wien' }, { activity: 'chess' })
    expect(fitOfAsk('Looking for company: play padel near Wien 7 (within 5 km)', l, NOW)?.activity).toBe('padel')
    expect(fitOfAsk('Looking for company: padel near Graz', l, NOW)).toBeNull()
    expect(fitOfAsk('Looking for company: padel', l, NOW)?.activity).toBe('padel')
    expect(fitOfAsk('Looking for company: chess near Graz', l, NOW)?.activity).toBe('chess')
  })
  it('does not fit a different activity, a plain ask or no settings', () => {
    const l = prefs({ activity: 'padel' })
    expect(fitOfAsk('Looking for company: hiking', l, NOW)).toBeNull()
    expect(fitOfAsk('Do you own a padel racket?', l, NOW)).toBeNull()
    expect(fitOfAsk('Looking for company: padel', undefined, NOW)).toBeNull()
  })
})

describe('LLM draft hook', () => {
  it('is off, so the plain reading is used', async () => {
    expect(TOGETHER_LLM_DRAFT).toBe(false)
    const ask = async () => { throw new Error('model must not be called') }
    expect((await draftOrPlain('I want to play padel with me', NOW, ask))?.activity).toBe('padel')
  })
  it('when on: asks once only if activity or time is missing, range-checks, falls back', async () => {
    const draft = JSON.stringify({ activity: 'padel', beforeAt: NOW + 86_400_000, radiusKm: 9999 })
    let n = 0
    const ask = async () => { n++; return draft }
    const r = await draftOrPlain('who is up for something sporty', NOW, ask, true)
    expect(n).toBe(1)
    expect(r).toEqual({ activity: 'padel', beforeAt: NOW + 86_400_000 })
    expect(await draftOrPlain('who is up for something sporty', NOW, async () => 'junk', true)).toBeNull()
    n = 0
    await draftOrPlain('I want to play padel before Thursday', NOW, ask, true)
    expect(n).toBe(0)
  })
})
