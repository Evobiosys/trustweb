/** Organizer page rules (wave 8): invitees, srv link, mailto, CSV, limits, payload. */
import { csv, errorWords, eventPayload, limitsLine, mailto, parseInvitees, withSrv } from '../../src/organizer_rules.ts'

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
})
