// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { cardPopAction, pagesToKeep } from '../../src/page_stack.ts'

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

describe('cardPopAction: what a popstate does to the card page', () => {
  it('collapses only when the card\'s own entry comes back while expanded', () => {
    expect(cardPopAction({ twPage: 'card' }, true)).toBe('collapse')
  })
  it('does nothing while a page or the expanded entry is still on top', () => {
    expect(cardPopAction({ twPage: 'card-expanded' }, true)).toBe('none')
    expect(cardPopAction({ twPage: 1 }, true)).toBe('none')
  })
  it('leaves the page when the state is no card entry', () => {
    expect(cardPopAction(null, true)).toBe('leave')
    expect(cardPopAction(null, false)).toBe('leave')
    expect(cardPopAction({ twPage: 'card' }, false)).toBe('leave')
  })
})
