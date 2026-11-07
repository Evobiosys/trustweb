// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { renderTrustPath } from '../../src/trust_path.ts'
describe('renderTrustPath', () => {
  it('draws through every point and names the path', () => {
    const r = renderTrustPath([{ x: 180, y: 180 }, { x: 180, y: 84.56 }, { x: 290.2, y: 40 }], ['you', 'Lena', 'Omar'])
    expect(r.d).toBe('M180.0 180.0 L180.0 84.6 L290.2 40.0')
    expect(r.label).toBe('you - Lena - Omar')
  })
  it('never contains a number in the label', () => {
    expect(renderTrustPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], ['you', 'Ana']).label).not.toMatch(/\d/)
  })
  it('rejects mismatched or short input', () => {
    expect(() => renderTrustPath([{ x: 0, y: 0 }], ['you'])).toThrow(RangeError)
    expect(() => renderTrustPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], ['you'])).toThrow(RangeError)
  })
})
