/**
 * Settings > About (src/about.ts, wave 1733 item 7): the four website pages
 * the contract names, on trustintheweb.org (Feedback is the mail link), and EvoBioSys as the maker.
 */
import { ABOUT_PAGES, AboutPage, DEFAULT_SITE_URL, EVOBIOSYS_URL, aboutUrl, resolveSiteUrl } from '../../src/about.ts'

describe('about links', () => {
  it('point at the website pages the contract names, in this order', () => {
    expect(ABOUT_PAGES.map(aboutUrl)).toEqual([
      'https://trustintheweb.org/faq.html',
      'mailto:connect@trustweb.one?subject=TrustWeb%20help',
      'https://trustintheweb.org/privacy.html',
      'https://trustintheweb.org/imprint.html',
    ])
  })
  it('name EvoBioSys as the maker, never a GitHub repository', () => {
    expect(EVOBIOSYS_URL).toBe('https://evobiosys.org/')
    for (const p of Object.values(AboutPage)) expect(aboutUrl(p)).not.toMatch(/github/i)
  })
})

describe('the website a build links to (wave 3: app.trustintheweb.org links to trustintheweb.org)', () => {
  it('takes a plain https URL ending in a slash', () => {
    expect(resolveSiteUrl('https://trustintheweb.org/')).toBe('https://trustintheweb.org/')
  })
  it('falls back to trustintheweb.org for anything else', () => {
    for (const bad of [undefined, null, '', 42, 'http://trustintheweb.org/', 'https://trustintheweb.org', 'https://trustintheweb.org/?x=1',
      'https://trustintheweb.org/#a', 'javascript:alert(1)//', 'not a url/', 'HTTPS://TrustInTheWeb.org/']) {
      expect(resolveSiteUrl(bad)).toBe(DEFAULT_SITE_URL)
    }
  })
  it('is trustintheweb.org when the build names none', () => {
    expect(aboutUrl(AboutPage.Faq)).toBe(DEFAULT_SITE_URL + 'faq.html')
  })
})
