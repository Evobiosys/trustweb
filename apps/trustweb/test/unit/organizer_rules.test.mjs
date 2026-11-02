/** Organizer page rules (wave 8): invitees, srv link, mailto, CSV, limits, payload, key, logo. */
import { MAX_LOGO_CHARS, csv, errorWords, eventPayload, limitsLine, logoOk, mailto, parseInvitees, parseKey, withSrv } from '../../src/organizer_rules.ts'

describe('organizer rules', () => {
  it('parseInvitees trims, lowercases, dedupes and sorts out bad lines', () => {
    expect(parseInvitees(' Anna@Example.at \nben@example.at\r\nanna@example.at\n\nnot an mail\nx@')).toEqual({ emails: ['anna@example.at', 'ben@example.at'], bad: ['not an mail', 'x@'] })
  })

  it('withSrv puts srv beside ev_host and replaces an older one', () => {
    const l = 'https://app.trustweb.one/#ev_host=abc'
    expect(withSrv(l, '0123456789abcdef')).toBe(`${l}&srv=0123456789abcdef`)
    expect(withSrv(withSrv(l, 'aa'), 'bb')).toBe(`${l}&srv=bb`)
  })

  it('eventPayload leaves empty optional fields out and splits themes', () => {
    expect(eventPayload({ name: ' Forum ', from: '2026-10-20T18:00', to: '', where: 'Wien', conditions: '', themes: 'trust, commons, trust,', tagName: '', invitees: '' }, 'Anna'))
      .toEqual({ name: 'Forum', from: '2026-10-20T18:00', where: 'Wien', themes: ['trust', 'commons'], organizer: 'Anna' })
  })

  it('mailto keeps recipients in bcc and encodes subject and body', () => {
    const u = mailto({ name: 'Forum & Fest' }, 'https://x.at/#ev_host=a&srv=b', ['a@x.at', 'b@x.at'])
    expect(u.startsWith('mailto:?bcc=a%40x.at,b%40x.at&subject=Forum%20%26%20Fest&body=')).toBe(true)
    expect(decodeURIComponent(u.split('body=')[1])).toContain('https://x.at/#ev_host=a&srv=b')
  })

  it('csv quotes commas, quotes and newlines and defuses formulas', () => {
    const e = { id: '1', link: '', invitees: ['a@x.at'], counts: { opened: 1, joined: 2, tagged: 3 }, event: { name: 'A, "B"', from: '2026-10-20', where: '=cmd' } }
    expect(csv([e])).toBe('name,from,where,invitees,opened,joined,tagged\r\n"A, ""B""",2026-10-20,\'=cmd,1,1,2,3\r\n')
  })

  it('limitsLine and errorWords speak in words', () => {
    expect(limitsLine('free', { events: 3, invitees: 25 })).toBe('Free plan: 3 events, 25 invitees per event. Hosting and support: connect@japossert.com')
    expect(limitsLine('hosted', { events: 50, invitees: 500 })).toBe('Hosted plan: 50 events, 500 invitees per event.')
    expect(errorWords(409, 'limit_invitees', { events: 3, invitees: 25 })).toContain('25 invitees')
    expect(errorWords(403, 'forbidden', { events: 3, invitees: 25 })).not.toContain('{')
  })

  const FORM = { name: 'Forum', from: '2026-10-20T18:00', to: '', where: 'Wien', conditions: '', themes: '', tagName: '', invitees: '' }
  const PNG = 'data:image/png;base64,iVBORw0KGgo='

  it('eventPayload carries a logo only when given and non-empty', () => {
    expect(eventPayload(FORM, 'Anna', PNG)).toEqual({ name: 'Forum', from: '2026-10-20T18:00', where: 'Wien', organizer: 'Anna', logo: PNG })
    expect(eventPayload(FORM, 'Anna', '')).toEqual({ name: 'Forum', from: '2026-10-20T18:00', where: 'Wien', organizer: 'Anna' })
    expect('logo' in eventPayload(FORM, 'Anna')).toBe(false)
  })
})

describe('organizer key', () => {
  const ORG = 'Ab3_-xYz0123456789abcd'
  const SECRET = 'A'.repeat(20) + '_-' + 'z9'.repeat(10) + 'q'
  it('fixture shapes are the server shapes', () => {
    expect(ORG).toHaveLength(22)
    expect(SECRET).toHaveLength(43)
  })

  it('accepts the line the page shows, with whitespace and extra keys', () => {
    const line = JSON.stringify({ org: ORG, secret: SECRET })
    expect(parseKey(line)).toEqual({ org: ORG, secret: SECRET })
    expect(parseKey(`  \n${line}\n\t `)).toEqual({ org: ORG, secret: SECRET })
    expect(parseKey(JSON.stringify({ org: ORG, secret: SECRET, name: 'Forum', plan: 'free' }))).toEqual({ org: ORG, secret: SECRET })
  })

  it('rejects non-JSON, wrong shapes and wrong lengths', () => {
    for (const bad of [
      '', '   ', 'hello', ORG, `${ORG} ${SECRET}`, '{"org":', 'null', '[]', '42', '"x"',
      JSON.stringify([ORG, SECRET]),
      JSON.stringify({ org: ORG }),
      JSON.stringify({ secret: SECRET }),
      JSON.stringify({ org: ORG.slice(1), secret: SECRET }),
      JSON.stringify({ org: ORG + 'a', secret: SECRET }),
      JSON.stringify({ org: ORG, secret: SECRET.slice(1) }),
      JSON.stringify({ org: ORG, secret: SECRET + 'a' }),
      JSON.stringify({ org: ORG.slice(1) + '+', secret: SECRET }),
      JSON.stringify({ org: ORG, secret: SECRET.slice(1) + '=' }),
      JSON.stringify({ org: 12, secret: SECRET }),
      JSON.stringify({ org: ORG, secret: null }),
      JSON.stringify({ org: ` ${ORG}`, secret: SECRET }),
    ]) expect(parseKey(bad)).toBeNull()
  })
})

describe('organizer logo', () => {
  it('logoOk accepts png, jpeg, webp and gif data URLs up to the cap', () => {
    for (const t of ['png', 'jpeg', 'webp', 'gif']) expect(logoOk(`data:image/${t};base64,AAAA`)).toBe(true)
    expect(logoOk('data:image/png;base64,AAA=')).toBe(true)
    expect(logoOk('data:image/png;base64,AA==')).toBe(true)
    const head = 'data:image/png;base64,'
    expect(logoOk(head + 'A'.repeat(MAX_LOGO_CHARS - head.length))).toBe(true)
    expect(logoOk(head + 'A'.repeat(MAX_LOGO_CHARS - head.length + 1))).toBe(false)
  })

  it('logoOk refuses other types, other schemes and broken base64', () => {
    for (const bad of [
      '', 'data:image/svg+xml;base64,AAAA', 'data:image/bmp;base64,AAAA', 'data:text/html;base64,AAAA',
      'data:image/png,AAAA', 'data:image/png;base64,', 'data:image/png;base64,AA===', 'data:image/png;base64,AA AA',
      'data:image/png;base64,AA-_', 'https://example.org/logo.png', ' data:image/png;base64,AAAA', 'data:image/PNG;base64,AAAA',
    ]) expect(logoOk(bad)).toBe(false)
  })
})
