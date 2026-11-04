// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { toolsRowAfterTap } from '../../src/row_tools.ts'

describe('row tools (row_tools.ts)', () => {
  it('a tap on a row opens only that row', () => {
    expect(toolsRowAfterTap(null, 'a')).toBe('a')
    expect(toolsRowAfterTap('a', 'b')).toBe('b')
  })
  it('a tap on the open row closes it', () => {
    expect(toolsRowAfterTap('a', 'a')).toBe(null)
  })
  it('a tap outside every row closes the open one', () => {
    expect(toolsRowAfterTap('a', null)).toBe(null)
  })
})
