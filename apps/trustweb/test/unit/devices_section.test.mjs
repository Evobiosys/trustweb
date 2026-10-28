import { devicesSectionChildren } from '../../src/devices_section.ts'

describe('devicesSectionChildren', () => {
  const group = ['G1', 'G2']
  const card = 'CARD'
  it('eligible phone: device sync, then the backup card', () => {
    expect(devicesSectionChildren({ eligible: true, devices: () => group, backupCard: () => card })).toEqual(['G1', 'G2', 'CARD'])
  })
  it('not eligible (or inventory off): the backup card still shows, device sync does not', () => {
    let asked = false
    expect(devicesSectionChildren({ eligible: false, devices: () => { asked = true; return group }, backupCard: () => card })).toEqual(['CARD'])
    expect(asked).toBe(false)
  })
  it('no backup service: only the device group (or nothing, so the section is not drawn)', () => {
    expect(devicesSectionChildren({ eligible: true, devices: () => group, backupCard: () => null })).toEqual(['G1', 'G2', null])
    expect(devicesSectionChildren({ eligible: false, devices: () => group, backupCard: () => null }).some(Boolean)).toBe(false)
  })
})
