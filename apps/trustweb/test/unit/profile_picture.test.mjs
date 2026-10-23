/** Wave 19 profile picture (profile.ts, image_store.ts fitSize, apps/demo wire.ts `pic`): who may get it, what a receiver accepts. */
import { DEFAULT_PICTURE_AUDIENCE, audienceOf, buildProfileText, parseProfileText, profileFor, receiveProfileText, repairProfile } from '../../src/profile.ts'
import { fitSize, MAX_SIDE, SHARE_SIDE } from '../../src/image_store.ts'
import { routeText, TextKind } from '../../src/chat.ts'
import { Ring } from '../../src/model.ts'
import { PIC_MAX_LEN, isJpegDataUrl } from '../../../demo/src/types.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'

const APP = 'https://app.trustintheweb.org/'
const NOW = 1_800_000_000_000
const PIC = 'data:image/jpeg;base64,' + 'A'.repeat(400)
const who = (ring) => ({ ring })
const mine = (audience) => ({ norms: [], pictureId: 'pic1', pictureAt: NOW, audience })
const ME = { id: 'did:x', displayName: 'A' }

describe('fitSize', () => {
  it('scales the long side down to the cap, never up, keeps the ratio', () => {
    expect(fitSize(4000, 2000, 1000)).toEqual({ w: 1000, h: 500 })
    expect(fitSize(300, 600, 160)).toEqual({ w: 80, h: 160 })
    expect(fitSize(100, 50, 1280)).toEqual({ w: 100, h: 50 })
    expect(fitSize(1, 5000, 160)).toEqual({ w: 1, h: 160 })
    expect(SHARE_SIDE).toBe(160)
    expect(MAX_SIDE).toBeGreaterThan(SHARE_SIDE)
  })
})

describe('profileFor with a picture: defaults to friends', () => {
  it('default audience is Friends; audienceOf reads it', () => {
    expect(DEFAULT_PICTURE_AUDIENCE).toBe('friend')
    expect(audienceOf(mine(), 'picture')).toBe('friend')
  })
  it('audience matrix: close/friend/acquaintance/unsorted/intending x close/friend/acquaintance/nobody', () => {
    const rings = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted]
    const seen = (a) => rings.map((r) => profileFor(mine({ picture: a }), who(r), PIC)?.picture === PIC)
    expect(seen('close')).toEqual([true, false, false, false, false])
    expect(seen('friend')).toEqual([true, true, false, false, false])
    expect(seen('acquaintance')).toEqual([true, true, true, false, false])
    expect(seen('nobody')).toEqual([false, false, false, false, false])
    expect(seen(undefined)).toEqual([true, true, false, false, false])
  })
  it('no picture handed in: nothing to send; a picture-only profile is still a profile', () => {
    expect(profileFor(mine(), who(Ring.Close))).toBeNull()
    expect(profileFor(mine(), who(Ring.Close), PIC)).toEqual({ norms: [], picture: PIC, at: NOW })
  })
  it('the picture never rides in the text; the text carries only a marker', () => {
    const t = buildProfileText(APP, mine(), who(Ring.Close), PIC)
    expect(t).not.toContain('base64')
    expect(t.length).toBeLessThan(480)
    expect(routeText(APP, t)).toBe(TextKind.Profile)
  })
})

describe('receiving a picture', () => {
  it('isJpegDataUrl: image/jpeg;base64 only, within the cap', () => {
    expect(isJpegDataUrl(PIC)).toBe(true)
    for (const bad of ['data:image/png;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,', 'data:image/jpeg;base64,AA AA', 'data:image/jpeg;base64,<script>',
      'https://x/y.jpg', 42, null, 'data:image/jpeg;base64,' + 'A'.repeat(PIC_MAX_LEN)]) expect(isJpegDataUrl(bad)).toBe(false)
    expect(isJpegDataUrl('data:image/jpeg;base64,' + 'A'.repeat(PIC_MAX_LEN - 23))).toBe(true)
  })
  it('a picture-only profile text plus a valid picture lands on the card; a bad one leaves nothing', () => {
    const t = buildProfileText(APP, mine(), who(Ring.Close), PIC)
    const card = {}
    expect(receiveProfileText(APP, card, t, NOW, 'data:image/png;base64,AAAA')).toBe(false)
    expect(card.theirProfile).toBeUndefined()
    expect(receiveProfileText(APP, card, t, NOW, PIC)).toBe(true)
    expect(card.theirProfile.picture).toBe(PIC)
    expect(receiveProfileText(APP, card, t, NOW, PIC)).toBe(false)
  })
  it('a text profile with an invalid picture still lands, without the picture', () => {
    const p = { norms: [{ norm: 'text-first', text: '', at: NOW, by: 'me' }], pictureId: 'p', pictureAt: NOW }
    const t = buildProfileText(APP, p, who(Ring.Close), PIC)
    expect(parseProfileText(APP, t, NOW, 'javascript:alert(1)').picture).toBeUndefined()
    expect(parseProfileText(APP, t, NOW, PIC).picture).toBe(PIC)
  })
  it('an older sender (no marker, no picture) parses exactly as before', () => {
    const t = `${APP}?profile=1#p=${encodeURIComponent(JSON.stringify({ n: [['text-first', '']], at: NOW }))}`
    expect(parseProfileText(APP, t, NOW)).toEqual({ norms: [{ norm: 'text-first', text: '' }], favourite: undefined, intro: undefined, at: NOW })
  })
})

describe('the wire: chat `pic` (apps/demo wire.ts parseChat)', () => {
  const chat = (extra = {}) => ({ v: 1, t: 'chat', from: ME, text: 'x', ts: NOW, ...extra })
  it('a valid picture travels; absent parses as before', () => {
    expect(decodeFromQr(encodeForQr(chat({ pic: PIC })))).toEqual(chat({ pic: PIC }))
    expect(decodeFromQr(encodeForQr(chat()))).toEqual(chat())
  })
  it('present and invalid (mime, oversize, not a string) rejects the envelope', () => {
    for (const bad of ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,' + 'A'.repeat(PIC_MAX_LEN), 5, null]) expect(decodeFromQr(JSON.stringify(chat({ pic: bad })))).toBeNull()
  })
})

describe('repairProfile keeps the picture fields', () => {
  it('an audience for the picture section survives; an unknown one goes', () => {
    const s = { profile: { norms: [], pictureId: 'p', audience: { picture: 'close', bogus: 'close' } } }
    expect(repairProfile(s)).toBe(true)
    expect(s.profile.audience).toEqual({ picture: 'close' })
    expect(s.profile.pictureId).toBe('p')
  })
})
