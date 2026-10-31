// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { pagesToKeep } from '../../src/page_stack.ts'

describe('pagesToKeep: how many pages stay open after a popstate', () => {
  it('keeps the numbered depth the state names', () => {
    expect(pagesToKeep({ twPage: 2 })).toBe(2)
    expect(pagesToKeep({ twPage: 0 })).toBe(0)
  })
  it('closes every page for a state that is not a page entry', () => {
    expect(pagesToKeep(null)).toBe(0)
    expect(pagesToKeep({})).toBe(0)
  })
  it('closes every page when the entry beneath is a web page ("card"/"more"), not a number: Back must pop the page at once', () => {
    expect(pagesToKeep({ twPage: 'card' })).toBe(0)
    expect(pagesToKeep({ twPage: 'more' })).toBe(0)
  })
})
