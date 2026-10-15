import { linkOrigin } from '../../src/link_origin.ts'
import { AddKind, ParseError, parseAddInput } from '../../src/add_by_code.ts'
import { createIdentity } from '../../../demo/src/did.ts'
import { buildConnectLinkUrl } from '../../../demo/src/connect_link.ts'

const LIVE = 'https://app.trustweb.one'
const DID = createIdentity(`${LIVE}/relay`).did
const link = (base) => buildConnectLinkUrl(base, DID, { id: 'p1p1p1p1p1p1', displayName: 'Ada Lovelace' })

describe('linkOrigin', () => {
  it.each(['https://app.trustweb.one', 'https://app.idea2.site', 'https://app.trustintheweb.org'])('keeps %s', (o) => expect(linkOrigin(o)).toBe(o))
  it.each(['http://127.0.0.1:5202', 'http://localhost:5173', 'http://192.168.1.20:5202', 'https://dev.trustweb.one'])('maps %s to the live app', (o) => expect(linkOrigin(o)).toBe(LIVE))
})

describe('parseAddInput: pasted connect links by origin', () => {
  const ok = (r) => expect(r).toMatchObject({ ok: true, kind: AddKind.LongLink })
  it('production origin', () => ok(parseAddInput(link(LIVE + '/'), 'http://127.0.0.1:5302')))
  it('own origin', () => ok(parseAddInput(link('https://app.idea2.site/'), 'https://app.idea2.site')))
  it('loopback link on a loopback page', () => {
    ok(parseAddInput(link('http://127.0.0.1:5202/'), 'http://127.0.0.1:5302'))
    ok(parseAddInput(link('http://localhost:5202/'), 'http://localhost:5302'))
    ok(parseAddInput(link('http://localhost:5202/'), 'http://127.0.0.1:5302'))
  })
  it('loopback link on a public page is rejected', () => {
    expect(parseAddInput(link('http://127.0.0.1:5202/'), LIVE)).toEqual({ ok: false, error: ParseError.OtherHost })
    expect(parseAddInput(link('http://localhost:5202/'), 'https://dev.trustweb.one')).toEqual({ ok: false, error: ParseError.OtherHost })
  })
  it('a LAN or other http host is rejected on a loopback page', () => {
    for (const b of ['http://192.168.1.20:5202/', 'http://evil.example:5202/', 'https://evil.example/']) {
      expect(parseAddInput(link(b), 'http://127.0.0.1:5302')).toEqual({ ok: false, error: ParseError.OtherHost })
    }
  })
})
