/** Wave 7: colour tags give a person one arc per tag they have, side by side (colour_tags.ts). */
import { FAMILY_PRESET, arcsGradient, tagColours } from '../../src/colour_tags.ts'
import { Audience, Ring } from '../../src/model.ts'
import { itemAdmits } from '../../src/cascade.ts'
import { FAMILY_FIELD } from '../../src/rings_layout.ts'

const tags = [...FAMILY_PRESET, { id: 'ConGRasNilsz', colour: '#e65100' }]

describe('colour tags', () => {
  it('colours a person by the tags they have, in the order the tags were chosen', () => {
    expect(tagColours({ ring: 'friend', fields: {} }, tags)).toEqual([])
    expect(tagColours({ ring: 'friend', fields: { [FAMILY_FIELD]: 'true' } }, tags)).toEqual(['#7b1fa2'])
    expect(tagColours({ ring: 'family', fields: { ConGRasNilsz: 'true' } }, tags)).toEqual(['#7b1fa2', '#e65100'])
  })
  it('draws hard-stop arcs, never a blend', () => {
    expect(arcsGradient([])).toBeNull()
    const g = arcsGradient(['#7b1fa2', '#e65100'])
    expect(g).toContain('#7b1fa2 3deg 177deg')
    expect(g).toContain('#e65100 183deg 357deg')
  })
  it('"selected tags" admit a tag holder next to the rings, for direct asks only; no tags selected: the rings alone decide', () => {
    const item = { audience: Audience.Close, tagAudience: [FAMILY_FIELD] }
    expect(itemAdmits({ audience: Audience.Close }, Ring.Acquaintance, 0, [FAMILY_FIELD])).toBe(false)
    expect(itemAdmits(item, Ring.Acquaintance, 0, [])).toBe(false)
    expect(itemAdmits(item, Ring.Acquaintance, 0, [FAMILY_FIELD])).toBe(true)
    expect(itemAdmits(item, Ring.Acquaintance, 1, [FAMILY_FIELD])).toBe(false)
    expect(itemAdmits(item, Ring.Close, 0, [])).toBe(true)
  })
})
