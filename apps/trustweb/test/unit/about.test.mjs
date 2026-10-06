/**
 * Settings > About (src/about.ts, wave 1733 item 7): the four website pages
 * the contract names, under idea2.site/trustweb, and EvoBioSys as the maker.
 */
import { ABOUT_PAGES, AboutPage, EVOBIOSYS_URL, aboutUrl } from '../../src/about.ts'

describe('about links', () => {
  it('point at the website pages the contract names, in this order', () => {
    expect(ABOUT_PAGES.map(aboutUrl)).toEqual([
      'https://idea2.site/trustweb/faq.html',
      'https://idea2.site/trustweb/feedback.html',
      'https://idea2.site/trustweb/privacy.html',
      'https://idea2.site/trustweb/imprint.html',
    ])
  })
  it('name EvoBioSys as the maker, never a GitHub repository', () => {
    expect(EVOBIOSYS_URL).toBe('https://evobiosys.org/')
    for (const p of Object.values(AboutPage)) expect(aboutUrl(p)).not.toMatch(/github/i)
  })
})
