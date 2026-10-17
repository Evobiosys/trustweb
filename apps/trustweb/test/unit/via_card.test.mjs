/** The #via card opens when both the add sheet is closed and their links arrived, in either order (src/via_card.ts). */
import { createViaCard } from '../../src/via_card.ts'

describe('via card', () => {
  it('links after the sheet closed: opens at once', () => {
    const v = createViaCard(); v.expect('p')
    expect(v.contact('p', false)).toBe(true)
  })
  it('links answer while the sheet is open (fast answer): opens when the sheet closes, once', () => {
    const v = createViaCard(); v.expect('p')
    expect(v.contact('p', true)).toBe(false)
    expect(v.closed('p')).toBe(true)
    expect(v.closed('p')).toBe(false)
  })
  it('sheet closes first: nothing yet, then the links open it; another person never does', () => {
    const v = createViaCard(); v.expect('p')
    expect(v.closed('p')).toBe(false)
    expect(v.contact('q', false)).toBe(false)
    expect(v.contact('p', false)).toBe(true)
  })
})
