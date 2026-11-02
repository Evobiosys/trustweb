// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Organizer hardening (client side): "sign in with my key" parsing, the logo data URL check, the join sheet's public fetch. */
import { logoOk, parseOrgKey } from '../../src/organizer_rules.ts'
import { fetchEventPublic } from '../../src/org_hits.ts'

const ORG = 'A'.repeat(21) + '_'
const SECRET = 'b'.repeat(42) + '-'
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const SRV = '0123456789abcdef'

describe('parseOrgKey', () => {
  it('reads the key exactly as the page shows it, with whitespace around', () => {
    expect(parseOrgKey(`  {"org":"${ORG}","secret":"${SECRET}"}\n`)).toEqual({ org: ORG, secret: SECRET })
  })

  it('reads the stored account shape too (name is ignored: the server answers it)', () => {
    expect(parseOrgKey(JSON.stringify({ org: ORG, secret: SECRET, name: 'Sample Org' }))).toEqual({ org: ORG, secret: SECRET })
  })

  it('refuses anything else', () => {
    for (const t of ['', 'not json', '[]', 'null', '42', `{"org":"${ORG}"}`, `{"org":"short","secret":"${SECRET}"}`,
      `{"org":"${ORG}","secret":"${SECRET}x"}`, `{"org":"${ORG}","secret":"${'b'.repeat(42)}!"}`, `{"org":5,"secret":"${SECRET}"}`]) {
      expect(parseOrgKey(t)).toBeNull()
    }
  })
})

describe('logoOk', () => {
  it('takes a small png, jpeg or webp data URL only', () => {
    expect(logoOk(PNG)).toBe(true)
    expect(logoOk('data:image/jpeg;base64,/9j/4AAQ')).toBe(true)
    expect(logoOk('data:image/webp;base64,UklGRg==')).toBe(true)
    expect(logoOk('data:image/svg+xml;base64,PHN2Zy8+')).toBe(false)
    expect(logoOk('https://cdn.example.org/logo.png')).toBe(false)
    expect(logoOk(`data:image/png;base64,${'A'.repeat(9000)}`)).toBe(false)
  })
})

describe('fetchEventPublic', () => {
  it('GETs /org/event/<srv>/public and returns {name, logo}', async () => {
    const calls = []
    const got = await fetchEventPublic(async (u) => { calls.push(u); return { ok: true, json: async () => ({ name: 'Sample Meetup', logo: PNG }) } }, SRV)
    expect(calls).toEqual([`/org/event/${SRV}/public`])
    expect(got).toEqual({ name: 'Sample Meetup', logo: PNG })
  })

  it('drops a logo that is not a safe data URL, and answers null on any failure', async () => {
    const reply = (body, ok = true) => async () => ({ ok, json: async () => body })
    expect(await fetchEventPublic(reply({ name: 'X', logo: 'https://cdn.example.org/a.png' }), SRV)).toEqual({ name: 'X', logo: null })
    expect(await fetchEventPublic(reply({ name: 'X', logo: null }, false), SRV)).toBeNull()
    expect(await fetchEventPublic(reply({ nope: 1 }), SRV)).toBeNull()
    expect(await fetchEventPublic(async () => { throw new Error('offline') }, SRV)).toBeNull()
    expect(await fetchEventPublic(reply({ name: 'X', logo: null }), 'not-an-id')).toBeNull()
  })
})
