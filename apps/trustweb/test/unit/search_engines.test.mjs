// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The "also search online" engines (search_engines.ts). */
import { ENGINES, DEFAULT_ENGINE, engineById, engineUrl, isAdvanced } from '../../src/search_engines.ts'

describe('search engines', () => {
  it('defaults to Ecosia', () => expect(DEFAULT_ENGINE).toBe('ecosia'))
  it('lists the visible seven and hides Google, Perplexity, Bing under Advanced', () => {
    expect(ENGINES.filter((e) => !isAdvanced(e.id)).map((e) => e.id)).toEqual(['ecosia', 'qwant', 'metager', 'mojeek', 'brave', 'startpage', 'duckduckgo'])
    expect(ENGINES.filter((e) => isAdvanced(e.id)).map((e) => e.id)).toEqual(['google', 'perplexity', 'bing'])
  })
  it('marks Startpage, DuckDuckGo and MetaGer private', () => {
    expect(ENGINES.filter((e) => e.private).map((e) => e.id).sort()).toEqual(['duckduckgo', 'metager', 'startpage'])
  })
  it('builds the url with the encoded words', () => {
    expect(engineUrl('ecosia', ' spare room ')).toBe('https://www.ecosia.org/search?q=spare%20room')
    expect(engineUrl('metager', 'a&b')).toBe('https://metager.org/meta/meta.ger3?eingabe=a%26b')
    expect(engineUrl('startpage', 'x')).toBe('https://www.startpage.com/do/search?q=x')
  })
  it('opens the empty search page for no words and falls back to Ecosia for an unknown id', () => {
    expect(engineUrl('ecosia', '  ')).toBe('https://www.ecosia.org/search?q=')
    expect(engineUrl('nope', 'x')).toBe('https://www.ecosia.org/search?q=x')
    expect(engineById(undefined).id).toBe('ecosia')
  })
})
