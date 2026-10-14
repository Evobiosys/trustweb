import { describe, expect, it } from 'vitest'
import { DEV_CLOSE, emptyClose, isClose, stops } from '../../src/close'

const RES = 'xu0y_4Pu3sOL'
const HOST = 'Hy23JQYtvEKW'

describe('close to me', () => {
  it('splits a corridor into its cities and keeps a hyphenated city whole', () => {
    expect(stops('Vienna - Graz - Ljubljana')).toEqual(['vienna', 'graz', 'ljubljana'])
    expect(stops('Baden-Baden')).toEqual(['baden-baden'])
  })
  it('matches case-insensitive substrings and Tana ref labels in the chosen fields only', () => {
    const c = { ...emptyClose(), places: ['Vienna - Graz - Ljubljana', 'Austria'] }
    expect(isClose({ [RES]: 'graz, Styria' }, c)).toBe(true)
    expect(isClose({ [HOST]: [{ label: 'Republic of Austria', tanaId: 'x' }] }, c)).toBe(true)
    expect(isClose({ [RES]: 'Berlin' }, c)).toBe(false)
    expect(isClose({ 'tw-context': 'Graz' }, c)).toBe(false)
    expect(isClose({ [HOST]: 'Graz' }, { ...c, fields: [RES] })).toBe(false)
  })
  it('the dev set drops corridor labels and reads comma lists', () => {
    expect(stops(DEV_CLOSE.places[2]).slice(0, 2)).toEqual(['wien', 'mödling'])
    expect(stops(DEV_CLOSE.places[5])).toContain('st. pölten')
    expect(isClose({ [RES]: 'Feldbach' }, DEV_CLOSE)).toBe(true)
    expect(isClose({ [RES]: 'Berlin' }, DEV_CLOSE)).toBe(false)
  })
  it('nobody is close without places', () => {
    expect(isClose({ [RES]: 'Graz' }, emptyClose())).toBe(false)
  })
})
