// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 small-ui-a: in focus mode an approve jumps at once to the next row not yet reviewed (src/dev_preview_rules.ts focusAfterApprove). */
import { focusAfterApprove } from '../../src/dev_preview_rules.ts'

const row = (key, extra = {}) => ({ key, branch: `w/${key}`, title: key, requires: [], checked: false, ...extra })
const approved = (key) => row(key, { checked: true, verdict: 'merge' })
const rejected = (key) => row(key, { checked: false, verdict: 'needs-work' })

describe('focusAfterApprove', () => {
  it('jumps to the next row that is not reviewed yet', () => {
    const f = [approved('a'), row('b'), row('c')]
    expect(focusAfterApprove(f, 'b', 'b')).toBe('c')
    expect(focusAfterApprove([row('a'), row('b'), row('c')], 'a', 'a')).toBe('b')
  })
  it('skips rows that are approved or marked needs work', () => {
    expect(focusAfterApprove([row('a'), approved('b'), rejected('c'), row('d')], 'a', 'a')).toBe('d')
  })
  it('wraps around to an earlier unreviewed row', () => {
    expect(focusAfterApprove([row('a'), approved('b'), row('c')], 'c', 'c')).toBe('a')
  })
  it('treats the pressed row as approved already (the verdict is not stored yet)', () => {
    expect(focusAfterApprove([row('a'), row('b')], 'a', 'a')).toBe('b')
  })
  it('stays on the pressed row when nothing is left to review', () => {
    expect(focusAfterApprove([approved('a'), row('b')], 'b', 'b')).toBe('b')
  })
  it('a press from the full list leaves the focus empty', () => {
    expect(focusAfterApprove([row('a'), row('b')], null, 'a')).toBeNull()
    expect(focusAfterApprove([row('a'), row('b')], 'a', 'b')).toBeNull()
  })
  it('rows already merged to main never count', () => {
    expect(focusAfterApprove([row('a'), row('b', { merged: true }), row('c')], 'a', 'a')).toBe('c')
  })
})
