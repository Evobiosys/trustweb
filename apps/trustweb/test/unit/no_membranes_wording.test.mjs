// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 views-eye: the tab and its views are called "Web"; no user string says "membrane(s)". */
import { S } from '../../src/strings.ts'

function walk(v, out) {
  if (typeof v === 'string') out.push(v)
  else if (typeof v === 'function') { try { walk(v('Zone', 3, 'x'), out) } catch { /* needs another shape */ } }
  else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x, out)
}

describe('Web wording', () => {
  it('names the tab and the rings view Web', () => {
    expect(S.navWeb).toBe('Web')
    expect(S.netRings).toBe('Web')
    expect(S.tabLabel.web).toBe('Web')
  })
  it('has no user string containing "membrane"', () => {
    const all = []
    walk(S, all)
    expect(all.filter((s) => /membrane/i.test(s))).toEqual([])
  })
})
