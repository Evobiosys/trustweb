/**
 * Wave 3 (2026-10-07), the pure parts:
 *   item 1: "Ask only my direct contacts": the stored setting, the flag an ask
 *     carries, and what a receiving device may do with it.
 */
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { directFlag, mayPassOn, surfacesHere } from '../../src/direct_ask.ts'
import { askDirectOnly } from '../../src/model.ts'
import { S } from '../../src/strings.ts'

const QUERY = {
  v: 1, t: 'query', from: { id: 'sam', displayName: 'Sam' }, templateId: 'free', templateVersion: 1,
  qid: 'q1', issuedAt: 1, freeText: 'Who is hiring?',
}

describe('wave 3 item 1: ask only my direct contacts', () => {
  it('is off unless the record says exactly true (absent, false, odd values: off)', () => {
    expect(askDirectOnly({})).toBe(false)
    for (const v of [false, 'true', 1, null, {}]) expect(askDirectOnly({ askDirectOnly: v })).toBe(false)
    expect(askDirectOnly({ askDirectOnly: true })).toBe(true)
  })

  it('an ask carries direct: true only with the setting on; off adds nothing (so the wire is unchanged by default)', () => {
    expect(directFlag(true)).toEqual({ direct: true })
    expect(directFlag(false)).toEqual({})
    expect('direct' in { ...QUERY, ...directFlag(false) }).toBe(false)
  })

  it('the flag survives the wire; an old build would simply ignore it (parseQuery picks known fields)', () => {
    const q = { ...QUERY, ...directFlag(true) }
    expect(decodeFromQr(encodeForQr(q))).toEqual(q)
  })

  it('a receiving device never passes on a direct ask, nor one already passed on once', () => {
    expect(mayPassOn(QUERY)).toBe(true)
    expect(mayPassOn({ ...QUERY, direct: true })).toBe(false)
    expect(mayPassOn({ ...QUERY, relayed: true })).toBe(false)
  })

  it('a direct ask that arrives passed on (relayed) was forwarded against the asker\'s wish: never shown', () => {
    expect(surfacesHere(QUERY)).toBe(true)
    expect(surfacesHere({ ...QUERY, direct: true })).toBe(true)
    expect(surfacesHere({ ...QUERY, relayed: true })).toBe(true)
    expect(surfacesHere({ ...QUERY, relayed: true, direct: true })).toBe(false)
  })

  it('the asker\'s copy says what the setting does, in Settings and in the query dock', () => {
    expect(S.setDirectOnly).toBe('Ask only my direct contacts')
    expect(S.setDirectOnlyHint).toMatch(/never passes your ask on/)
    expect(S.queryDirectOnly).toMatch(/Only your direct contacts are asked/)
  })
})
