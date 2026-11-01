// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { activateKey } from '../../src/key_press.ts'

const press = (key, same = true) => {
  let hit = 0, prevented = false
  const target = {}
  activateKey(() => { hit++ })({ key, target, currentTarget: same ? target : {}, preventDefault: () => { prevented = true } })
  return { hit, prevented }
}

describe('key_press activateKey', () => {
  it('presses on Enter and Space', () => {
    expect(press('Enter')).toEqual({ hit: 1, prevented: true })
    expect(press(' ')).toEqual({ hit: 1, prevented: true })
  })
  it('ignores other keys and keys typed into a child', () => {
    expect(press('a').hit).toBe(0)
    expect(press('Enter', false).hit).toBe(0)
  })
})
