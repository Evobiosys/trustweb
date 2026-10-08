/**
 * "Their TrustWeb code, name or DID" (src/add_by_code.ts, wave 6b): the parser in its pinned order (table-driven, every form and
 * hostile inputs), the resolver's validation of where a redirect ended (only our origins, only the ?connect= shape), and the DID
 * path (relay only, no server, honest about another relay).
 */
import {
  AddKind, DidProblem, ParseError, ResolveError, didReadiness, linkFromFinalUrl, paramsForDid, parseAddInput, resolveAddInput, resolveCode, resolveName,
} from '../../src/add_by_code.ts'
import { createIdentity } from '../../../demo/src/did.ts'
import { buildConnectLinkUrl } from '../../../demo/src/connect_link.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const IDEA2 = 'https://app.idea2.site'
const CODE = 'AbCdEfGhIjKlMnOpQrStUv'
const DID = createIdentity(`${ORIGIN}/relay`).did
const OTHER_DID = createIdentity('https://elsewhere.example/relay').did
const LONG = buildConnectLinkUrl(ORIGIN + '/', DID, { id: 'p1p1p1p1p1p1', displayName: 'Ada Lovelace' })

const parse = (s, origin = ORIGIN) => parseAddInput(s, origin)

describe('parseAddInput: the pinned order', () => {
  it.each([
    ['@ada', 'ada'], ['@Ada', 'ada'], ['  @ada.lovelace  ', 'ada.lovelace'], ['ada', 'ada'], ['ADA_99', 'ada_99'], ['a-b', 'a-b'], ['@jakob', 'jakob'],
  ])('%s is the name %s', (raw, name) => expect(parse(raw)).toEqual({ ok: true, kind: AddKind.Name, name }))

  it('a bare 22 character value is a code (and keeps its case)', () => expect(parse(CODE)).toEqual({ ok: true, kind: AddKind.Code, code: CODE }))
  it('a /c/<code> url on either app host is a code', () => {
    for (const u of [`${ORIGIN}/c/${CODE}`, `${IDEA2}/c/${CODE}`, `${ORIGIN}/c/${CODE}/`, `${ORIGIN}/c/${CODE}#n=1`, `app.trustintheweb.org/c/${CODE}`]) {
      expect(parse(u)).toEqual({ ok: true, kind: AddKind.Code, code: CODE })
    }
  })
  it('a /who/<name> url is a name', () => expect(parse(`${ORIGIN}/who/ada`)).toEqual({ ok: true, kind: AddKind.Name, name: 'ada' }))
  it('a did:peer:2 value is a DID', () => expect(parse(DID)).toEqual({ ok: true, kind: AddKind.Did, did: DID }))
  it('a pasted ?connect= link (also under /trustweb/) is a long link, name optional', () => {
    const a = parse(LONG)
    expect(a.ok && a.kind === AddKind.LongLink && a.link.did === DID && a.link.from.id === 'p1p1p1p1p1p1' && a.link.from.displayName === 'Ada Lovelace').toBe(true)
    const noName = parse(LONG.replace(/&name=[^&]*/, ''))
    expect(noName.ok && noName.kind === AddKind.LongLink && noName.link.from.displayName === '').toBe(true)
    expect(parse(`${IDEA2}/trustweb/?connect=${encodeURIComponent(DID)}&id=abc`).ok).toBe(true)
  })
  it('"@" wins over everything: @ plus a code-shaped word is a bad name, not a code', () => {
    expect(parse('@' + CODE)).toEqual({ ok: false, error: ParseError.BadName })
  })
  it('a 22 character lowercase word is a code, never a name', () => {
    expect(parse('abcdefghijklmnopqrstuv').kind).toBe(AddKind.Code)
  })
  it('the page\'s own origin is read too (a local or preview build)', () => {
    expect(parse(`http://127.0.0.1:8984/c/${CODE}`, 'http://127.0.0.1:8984')).toEqual({ ok: true, kind: AddKind.Code, code: CODE })
  })
})

describe('parseAddInput: what is refused', () => {
  it.each([
    ['', ParseError.Empty], ['   ', ParseError.Empty], ['‮\u0007', ParseError.Empty],
    ['x'.repeat(3000), ParseError.TooLong],
    ['ab', ParseError.BadName], ['@a', ParseError.BadName], ['-ada', ParseError.BadName], ['ada-', ParseError.BadName], ['a'.repeat(31), ParseError.BadName],
    ['ada lovelace', ParseError.BadName], ['@ada!', ParseError.BadName], ['ada@example.org', ParseError.BadName], ['@', ParseError.BadName],
    ['did:peer:', ParseError.BadDid], ['did:peer:2.Vzbroken', ParseError.BadDid], ['did:peer:0z6Mk', ParseError.BadDid],
    ['https://evil.example/c/' + CODE, ParseError.OtherHost], ['https://app.trustintheweb.org.evil.example/c/' + CODE, ParseError.OtherHost],
    ['http://app.trustintheweb.org/c/' + CODE, ParseError.OtherHost], ['https://app.trustintheweb.org:8443/c/' + CODE, ParseError.OtherHost],
    ['https://user:pw@app.trustintheweb.org/c/' + CODE, ParseError.OtherHost], ['javascript://app.trustintheweb.org/%0aalert(1)', ParseError.OtherHost],
    ['ftp://app.trustintheweb.org/c/' + CODE, ParseError.OtherHost], ['file:///etc/passwd', ParseError.OtherHost], ['evil.example/c/' + CODE, ParseError.OtherHost],
    [`${ORIGIN}/`, ParseError.NotAConnectLink], [`${ORIGIN}/c/short`, ParseError.NotAConnectLink], [`${ORIGIN}/?connect=`, ParseError.NotAConnectLink],
    [`${ORIGIN}/?handover=1#k=TW1R-AAAAA`, ParseError.NotAConnectLink],
  ])('%j is refused (%s)', (raw, error) => expect(parse(raw)).toEqual({ ok: false, error }))

  it('never throws on odd input', () => {
    for (const odd of [null, undefined, 7, {}, '%', '%E0%A4%A', '@%zz', 'https://', 'https://%', '\u0000', 'a'.repeat(2048), `${ORIGIN}/who/%E0%A4%A`]) {
      expect(() => parseAddInput(odd, ORIGIN)).not.toThrow()
    }
  })
  it('a url on another host is rejected at parse time (so it is never fetched)', async () => {
    const calls = []
    const out = await resolveAddInput({ origin: ORIGIN, fetch: async (...a) => { calls.push(a); throw new Error('no') } }, 'https://evil.example/c/' + CODE)
    expect(out).toEqual({ ok: false, failure: { type: 'parse', error: ParseError.OtherHost } })
    expect(calls).toHaveLength(0)
  })
})

describe('linkFromFinalUrl: where a redirect may end', () => {
  it('accepts a connect link on either app origin or this page\'s own', () => {
    expect(linkFromFinalUrl(LONG, ORIGIN)?.did).toBe(DID)
    expect(linkFromFinalUrl(LONG.replace(ORIGIN, IDEA2), ORIGIN)?.did).toBe(DID)
    expect(linkFromFinalUrl('http://127.0.0.1:9/?connect=' + encodeURIComponent(DID) + '&id=x', 'http://127.0.0.1:9')?.did).toBe(DID)
  })
  it.each([
    'https://evil.example/?connect=' + encodeURIComponent(DID) + '&id=x', `${ORIGIN}/`, `${ORIGIN}/c/${CODE}`, 'not a url', '',
    'http://app.trustintheweb.org/?connect=x&id=y', 'https://u:p@app.trustintheweb.org/?connect=x&id=y',
  ])('refuses %j', (u) => expect(linkFromFinalUrl(u, ORIGIN)).toBeNull())
})

/** A fake fetch that answers like a followed redirect: status, final url, redirected. */
const answer = (o) => async (url, init) => {
  answer.calls.push({ url, init })
  if (o === 'offline') throw new TypeError('offline')
  if (o === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  return { status: o.status ?? 200, ok: (o.status ?? 200) < 300, url: o.url ?? '', redirected: o.redirected ?? true }
}
answer.calls = []
const deps = (o, extra = {}) => { answer.calls = []; return { origin: ORIGIN, fetch: answer(o), ...extra } }

describe('resolveCode / resolveName', () => {
  it('GETs /c/<code> on its own origin, following the redirect, and reads the link where it ended', async () => {
    const d = deps({ url: LONG })
    const out = await resolveCode(d, CODE)
    expect(out.ok && out.link.did === DID && out.link.from.displayName === 'Ada Lovelace').toBe(true)
    expect(answer.calls).toHaveLength(1)
    expect(answer.calls[0].url).toBe(`${ORIGIN}/c/${CODE}`)
    expect(answer.calls[0].init.method).toBe('GET')
    expect(answer.calls[0].init.redirect).toBe('follow')
    expect(answer.calls[0].init.credentials).toBe('omit')
    expect(answer.calls[0].init.referrerPolicy).toBe('no-referrer')
  })
  it('GETs /who/<name>', async () => {
    const out = await resolveName(deps({ url: LONG }), 'ada')
    expect(out.ok).toBe(true)
    expect(answer.calls[0].url).toBe(`${ORIGIN}/who/ada`)
  })
  it('404 is NotFound, 429 RateLimited, 5xx Server', async () => {
    expect(await resolveCode(deps({ status: 404, redirected: false }), CODE)).toEqual({ ok: false, error: ResolveError.NotFound })
    expect(await resolveCode(deps({ status: 429, redirected: false }), CODE)).toEqual({ ok: false, error: ResolveError.RateLimited })
    expect(await resolveCode(deps({ status: 502, redirected: false }), CODE)).toEqual({ ok: false, error: ResolveError.Server })
  })
  it('a redirect that ended on another origin is refused, not followed into the person\'s web', async () => {
    const out = await resolveCode(deps({ url: 'https://evil.example/?connect=' + encodeURIComponent(DID) + '&id=x' }), CODE)
    expect(out).toEqual({ ok: false, error: ResolveError.Refused })
  })
  it('an answer that did not redirect, or ended on a page with no connect link, is refused', async () => {
    expect(await resolveCode(deps({ url: LONG, redirected: false }), CODE)).toEqual({ ok: false, error: ResolveError.Refused })
    expect(await resolveCode(deps({ url: `${ORIGIN}/` }), CODE)).toEqual({ ok: false, error: ResolveError.Refused })
  })
  it('offline and a silent server are Network', async () => {
    expect(await resolveCode(deps('offline'), CODE)).toEqual({ ok: false, error: ResolveError.Network })
    expect(await resolveCode(deps('hang', { timeoutMs: 20 }), CODE)).toEqual({ ok: false, error: ResolveError.Network })
  })
  it('a malformed code or name never reaches the network', async () => {
    const d = deps({ url: LONG })
    expect(await resolveCode(d, 'short')).toEqual({ ok: false, error: ResolveError.NotFound })
    expect(await resolveName(d, 'A')).toEqual({ ok: false, error: ResolveError.NotFound })
    expect(await resolveName(d, CODE)).toEqual({ ok: false, error: ResolveError.NotFound })
    expect(answer.calls).toHaveLength(0)
  })
})

describe('resolveAddInput', () => {
  it('a code asks the server once; a long link and a DID ask nothing', async () => {
    let d = deps({ url: LONG })
    expect((await resolveAddInput(d, CODE)).ok).toBe(true)
    expect(answer.calls).toHaveLength(1)
    d = deps({ url: LONG })
    expect((await resolveAddInput(d, LONG)).ok).toBe(true)
    expect((await resolveAddInput(d, DID)).ok).toBe(true)
    expect(answer.calls).toHaveLength(0)
  })
  it('a link or a code that resolves to a DID of the OTHER relay is stopped with the reason, never connected', async () => {
    const other = buildConnectLinkUrl(ORIGIN + '/', OTHER_DID, { id: 'p1p1p1p1p1p1', displayName: 'Zed' })
    const pasted = await resolveAddInput(deps({ url: LONG }), other)
    expect(pasted).toEqual({ ok: false, failure: { type: 'did', problem: DidProblem.OtherRelay, relayOrigin: 'https://elsewhere.example' } })
    const viaCode = await resolveAddInput(deps({ url: other }), CODE)
    expect(viaCode).toEqual({ ok: false, failure: { type: 'did', problem: DidProblem.OtherRelay, relayOrigin: 'https://elsewhere.example' } })
    const viaName = await resolveAddInput(deps({ url: other }), '@zed.z')
    expect(viaName.ok).toBe(false)
  })
  it('a name asks /who/', async () => {
    const d = deps({ url: LONG })
    const out = await resolveAddInput(d, '@Ada')
    expect(out.ok && out.kind === AddKind.Name).toBe(true)
    expect(answer.calls[0].url).toBe(`${ORIGIN}/who/ada`)
  })
  it('a server failure is reported with what was asked for', async () => {
    const out = await resolveAddInput(deps({ status: 404, redirected: false }), '@ada')
    expect(out).toEqual({ ok: false, failure: { type: 'resolve', error: ResolveError.NotFound, kind: AddKind.Name } })
  })
})

describe('the DID path: the relay only', () => {
  it('a DID whose service block names this origin can connect', () => {
    expect(didReadiness(DID, ORIGIN)).toEqual({ ok: true, relayOrigin: ORIGIN })
  })
  it('a DID on another relay cannot, and says which', () => {
    expect(didReadiness(OTHER_DID, ORIGIN)).toEqual({ ok: false, problem: DidProblem.OtherRelay, relayOrigin: 'https://elsewhere.example' })
  })
  it('a broken DID cannot', () => expect(didReadiness('did:peer:2.Vz', ORIGIN)).toEqual({ ok: false, problem: DidProblem.BadDid }))
  it('a DID on another APP host can: the app hosts share one relay (review 6b, wave 6c)', () => {
    const idea2Did = createIdentity('https://app.idea2.site/relay').did
    const orgDid = createIdentity('https://app.trustintheweb.org/relay').did
    expect(didReadiness(idea2Did, 'https://app.trustweb.one')).toEqual({ ok: true, relayOrigin: 'https://app.idea2.site' })
    expect(didReadiness(orgDid, 'https://app.trustweb.one')).toEqual({ ok: true, relayOrigin: 'https://app.trustintheweb.org' })
    expect(didReadiness(DID, 'https://app.idea2.site')).toEqual({ ok: true, relayOrigin: ORIGIN })
  })
  it('a local or preview build reaches its own relay only, even for an app-host DID', () => {
    expect(didReadiness(DID, 'http://127.0.0.1:8983')).toEqual({ ok: false, problem: DidProblem.OtherRelay, relayOrigin: ORIGIN })
    expect(didReadiness(OTHER_DID, 'https://app.trustweb.one')).toEqual({ ok: false, problem: DidProblem.OtherRelay, relayOrigin: 'https://elsewhere.example' })
  })
  it('connect params for a bare DID: a stable local id, no name', () => {
    const a = paramsForDid(DID)
    expect(a).toEqual(paramsForDid(DID))
    expect(a.did).toBe(DID)
    expect(a.from.displayName).toBe('')
    expect(a.from.id).toMatch(/^d[0-9a-f]{16}$/)
    expect(paramsForDid(OTHER_DID).from.id).not.toBe(a.from.id)
  })
  it('adding a DID sends nothing to any server', async () => {
    const d = deps({ url: LONG })
    const out = await resolveAddInput(d, DID)
    expect(out.ok && out.kind === AddKind.Did).toBe(true)
    expect(answer.calls).toHaveLength(0)
  })
  it('a DID on another relay stops before any request, with a failure the sheet can word', async () => {
    const d = deps({ url: LONG })
    const out = await resolveAddInput(d, OTHER_DID)
    expect(out).toEqual({ ok: false, failure: { type: 'did', problem: DidProblem.OtherRelay, relayOrigin: 'https://elsewhere.example' } })
    expect(answer.calls).toHaveLength(0)
  })
})
