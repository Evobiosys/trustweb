/** Wave 7: colour tags give a person one arc per tag they have, side by side (colour_tags.ts). */
import { FAMILY_PRESET, arcsGradient, tagColours } from '../../src/colour_tags.ts'
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
})
