/**
 * Wave 3 (2026-10-07), the pure parts:
 *   item 1: "Ask only my direct contacts": the stored setting, the flag an ask
 *     carries, and what a receiving device may do with it.
 *   item 2: transcription on a server: Berget and the fallback read from the
 *     status; the yes bound to provider, region, data policy and fallback (D7);
 *     the old bare timestamp is no yes; "Automatic" never uses the server; the
 *     sheet's copy; failed and lost jobs are not charged to the person.
 *   item 3: web results inside the app: the engine list, the answer read as
 *     untrusted data, the request (POST, words in the body), the errors, the
 *     once-per-engine yes, the link-outs.
 */
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { directFlag, mayPassOn, surfacesHere } from '../../src/direct_ask.ts'
import { askDirectOnly, ENGINE_CHOICES, InferenceRegion, ProviderDataPolicy, TranscribeProviderName, TRANSCRIPTION_CHOICES, TranscriptionChoice, transcriptionChoice } from '../../src/model.ts'
import { consentCovers, consentFor, giveConsent, hasAnyConsent, readConsent, serverTranscribesByItself, withdrawConsent } from '../../src/server_consent.ts'
import { parseProviderInfo, parseStatus } from '../../src/swiss_server.ts'
import { S } from '../../src/strings.ts'
import { errorOf, fetchEngines, giveWebConsent, parseEngines, parseResults, searchWeb, webConsents, webQuery, WebSearchError } from '../../src/web_results.ts'
import { engineLinkUrl } from '../../src/web_search.ts'

const QUERY = {
  v: 1, t: 'query', from: { id: 'sam', displayName: 'Sam' }, templateId: 'free', templateVersion: 1,
  qid: 'q1', issuedAt: 1, freeText: 'Who is hiring?',
}

describe('wave 3 item 1: ask only my direct contacts', () => {
  it('is off unless the record says exactly true (absent, false, odd values: off)', () => {
    expect(askDirectOnly({})).toBe(false)
    for (const v of [false, 'true', 1, null, {}]) expect(askDirectOnly({ askDirectOnly: v })).toBe(false)
    expect(askDirectOnly({ askDirectOnly: true })).toBe(true)
  })

  it('an ask carries direct: true only with the setting on; off adds nothing (so the wire is unchanged by default)', () => {
    expect(directFlag(true)).toEqual({ direct: true })
    expect(directFlag(false)).toEqual({})
    expect('direct' in { ...QUERY, ...directFlag(false) }).toBe(false)
  })

  it('the flag survives the wire; an old build would simply ignore it (parseQuery picks known fields)', () => {
    const q = { ...QUERY, ...directFlag(true) }
    expect(decodeFromQr(encodeForQr(q))).toEqual(q)
  })

  it('a receiving device never passes on a direct ask, nor one already passed on once', () => {
    expect(mayPassOn(QUERY)).toBe(true)
    expect(mayPassOn({ ...QUERY, direct: true })).toBe(false)
    expect(mayPassOn({ ...QUERY, relayed: true })).toBe(false)
  })

  it('a direct ask that arrives passed on (relayed) was forwarded against the asker\'s wish: never shown', () => {
    expect(surfacesHere(QUERY)).toBe(true)
    expect(surfacesHere({ ...QUERY, direct: true })).toBe(true)
    expect(surfacesHere({ ...QUERY, relayed: true })).toBe(true)
    expect(surfacesHere({ ...QUERY, relayed: true, direct: true })).toBe(false)
  })

  it('the asker\'s copy says what the setting does, in Settings and in the query dock', () => {
    expect(S.setDirectOnly).toBe('Ask only my direct contacts')
    expect(S.setDirectOnlyHint).toMatch(/never passes your ask on/)
    expect(S.queryDirectOnly).toMatch(/Only your direct contacts are asked/)
  })
})

const BERGET = { transcribe: { enabled: true, provider: 'berget', region: 'se', dataPolicy: null, fallback: { provider: 'openrouter', region: 'us', dataPolicy: 'deny' } } }
const BERGET_ALONE = { transcribe: { enabled: true, provider: 'berget', region: 'se', dataPolicy: null, fallback: null } }

describe('wave 3 item 2: transcription on a server, never the default, the yes bound to its route', () => {
  it('reads Berget in Sweden and its OpenRouter fallback from the status block (the berget agent\'s shape)', () => {
    const p = parseProviderInfo(BERGET)
    expect(p).toEqual({ provider: TranscribeProviderName.Berget, region: InferenceRegion.Se, dataPolicy: null,
      fallback: { provider: TranscribeProviderName.OpenRouter, region: InferenceRegion.Us, dataPolicy: ProviderDataPolicy.Deny } })
    expect(parseProviderInfo(BERGET_ALONE).fallback).toBeNull()
    expect(parseStatus({ hosted: true, transcribe: true, provider: BERGET }).provider.fallback.provider).toBe('openrouter')
  })

  it('a fallback the server does not mention stays unsaid; one this build cannot name is still a fallback', () => {
    expect('fallback' in parseProviderInfo({ transcribe: { provider: 'infomaniak', region: 'ch', dataPolicy: null } })).toBe(false)
    expect(parseProviderInfo({ transcribe: { provider: 'berget', region: 'se', fallback: false } }).fallback).toBeNull()
    expect(parseProviderInfo({ transcribe: { provider: 'berget', region: 'se', fallback: true } }).fallback).toEqual({ provider: null, region: null, dataPolicy: null })
    expect(parseProviderInfo({ transcribe: { provider: 'berget', region: 'se', fallback: { provider: 'acme', region: 'mars' } } }).fallback).toEqual({ provider: null, region: null, dataPolicy: null })
  })

  it('the sheet names provider and region as Jakob wrote them, the data policy, and the fallback', () => {
    expect(S.serverRouteLabel(parseProviderInfo(BERGET))).toBe('Berget, Sweden (EU)')
    expect(S.serverRouteLabel({ provider: TranscribeProviderName.OpenRouter, region: InferenceRegion.Us, dataPolicy: ProviderDataPolicy.Deny })).toBe('OpenRouter, USA')
    expect(S.serverRouteLabel({ provider: TranscribeProviderName.Infomaniak, region: InferenceRegion.Ch, dataPolicy: null })).toBe('Infomaniak, Switzerland')
    expect(S.serverRouteLabel(null)).toBe('an outside transcription service')
    expect(S.serverWhere(parseProviderInfo(BERGET))).toBe('Processed by: Berget, Sweden (EU).')
    expect(S.serverPolicy(parseProviderInfo(BERGET))).toMatch(/its own terms apply/)
    expect(S.serverPolicy({ provider: TranscribeProviderName.OpenRouter, region: InferenceRegion.Us, dataPolicy: ProviderDataPolicy.Deny })).toMatch(/no data collection/)
    expect(S.serverFallback(parseProviderInfo(BERGET))).toBe('Fallback: when it is down, OpenRouter, USA transcribes instead, asking for "no data collection". Your yes covers both.')
    expect(S.serverFallback(parseProviderInfo(BERGET_ALONE))).toMatch(/^No fallback/)
    expect(S.serverFallback({ provider: TranscribeProviderName.Infomaniak, region: InferenceRegion.Ch, dataPolicy: null })).toBeNull()
    expect(S.consentBody(parseProviderInfo(BERGET), 10)).toMatch(/transcription service of Berget in Sweden \(EU\)/)
  })

  it('the yes is stored with provider, region, data policy and fallback, and covers exactly that route', () => {
    const s = { serverTranscriptionConsentAt: 5 }
    giveConsent(s, parseProviderInfo(BERGET), 1000)
    expect(s.serverTranscriptionConsent).toEqual({ at: 1000, provider: 'berget', region: 'se', dataPolicy: null, fallback: { provider: 'openrouter', region: 'us', dataPolicy: 'deny' } })
    expect('serverTranscriptionConsentAt' in s).toBe(false)
    const c = readConsent(s)
    expect(consentCovers(c, parseProviderInfo(BERGET))).toBe(true)
    // Any change asks again: another provider or region, another data policy, a fallback added, removed or changed.
    expect(consentCovers(c, parseProviderInfo({ transcribe: { provider: 'openrouter', region: 'us', dataPolicy: 'deny' } }))).toBe(false)
    expect(consentCovers(c, parseProviderInfo(BERGET_ALONE))).toBe(false)
    expect(consentCovers(c, parseProviderInfo({ transcribe: { ...BERGET.transcribe, fallback: { provider: 'openrouter', region: 'us', dataPolicy: 'allow' } } }))).toBe(false)
    expect(consentCovers(c, parseProviderInfo({ transcribe: { ...BERGET.transcribe, region: 'eu' } }))).toBe(false)
    const alone = consentFor(parseProviderInfo(BERGET_ALONE), 1)
    expect(consentCovers(alone, parseProviderInfo(BERGET))).toBe(false)
    // A server that does not say whether it has a fallback reads as "none", as at the yes.
    const info = consentFor(parseProviderInfo({ transcribe: { provider: 'infomaniak', region: 'ch', dataPolicy: null } }), 1)
    expect(consentCovers(info, parseProviderInfo({ transcribe: { provider: 'infomaniak', region: 'ch', dataPolicy: null, fallback: null } }))).toBe(true)
  })

  it('the old bare timestamp names no route: no yes (it can still be taken back); odd shapes read as no yes, untouched', () => {
    const legacy = { serverTranscriptionConsentAt: 5 }
    expect(readConsent(legacy)).toBeNull()
    expect(consentCovers(readConsent(legacy), parseProviderInfo(BERGET))).toBe(false)
    expect(hasAnyConsent(legacy)).toBe(true)
    for (const odd of [1, 'yes', [], { at: 'x', provider: 'berget', region: 'se', dataPolicy: null, fallback: null },
      { at: 1, provider: 2, region: 'se', dataPolicy: null, fallback: null }, { at: 1, provider: 'berget', region: 'se', dataPolicy: null, fallback: 'x' },
      { at: 1, provider: 'berget', region: 'se', dataPolicy: null }]) {
      const s = { serverTranscriptionConsent: odd }
      expect(readConsent(s)).toBeNull()
      expect(s.serverTranscriptionConsent).toBe(odd)
    }
  })

  it('withdrawing removes both generations; a server choice becomes "Automatic"', () => {
    const s = { transcription: 'server', serverTranscriptionConsentAt: 5 }
    giveConsent(s, parseProviderInfo(BERGET), 1)
    s.serverTranscriptionConsentAt = 7
    withdrawConsent(s)
    expect(s).toEqual({ transcription: 'auto' })
    const t = { transcription: 'on-device', serverTranscriptionConsentAt: 5 }
    withdrawConsent(t)
    expect(t).toEqual({ transcription: 'on-device' })
  })

  it('"Automatic" never sends audio to the server; only the server button\'s choice, with the server on and the yes covering it', () => {
    for (const c of TRANSCRIPTION_CHOICES) {
      for (const on of [true, false]) for (const covered of [true, false]) {
        expect(serverTranscribesByItself(c, on, covered)).toBe(c === TranscriptionChoice.Server && on && covered)
      }
    }
  })

  it('the engine list is Automatic, TalkWeave, On this device, Later; a stored "server" stays readable', () => {
    expect(ENGINE_CHOICES).toEqual(['auto', 'talkweave', 'on-device', 'later'])
    expect(transcriptionChoice({ transcription: 'server' })).toBe(TranscriptionChoice.Server)
    expect(S.setServerButton).toBe('Transcribe on a server (see where)')
  })

  it('failed and lost jobs say they are not charged to the person; no line says "may still have been charged"', () => {
    expect(S.jobNotCharged).toBe('Not charged to you: failures are not charged to your allowance.')
    const all = Object.values(S).filter((v) => typeof v === 'string').join(' ')
    expect(all).not.toMatch(/may still have been charged|may have been charged/)
  })
})

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const BRAVE = { id: 'brave', label: 'Brave' }

describe('wave 3 item 3: web results inside the app (websearch-api-contract v1.0)', () => {
  it('offers only engines with an API and a key; link-only, unconfigured, odd or doubled entries never', () => {
    expect(parseEngines({ engines: [
      { id: 'brave', label: 'Brave', mode: 'api', configured: true },
      { id: 'mojeek', label: 'Mojeek', mode: 'api', configured: false },
      { id: 'qwant', label: 'Qwant', mode: 'link_only', configured: true },
      { id: 'Bad Id', label: 'X', mode: 'api', configured: true },
      { id: 'brave', label: 'Brave again', mode: 'api', configured: true },
      { id: 'nolabel', mode: 'api', configured: true },
      null, 'brave',
    ] })).toEqual([BRAVE])
    for (const v of [null, {}, { engines: 'x' }, [], 'x']) expect(parseEngines(v)).toEqual([])
  })

  it('reads an answer as untrusted data: http(s) links only, host from the URL, text capped, unknown fields ignored', () => {
    const r = parseResults({ engine: 'brave', label: 'Brave', untrusted: true, more: 1, results: [
      { title: '  Cargo\n bikes ', url: 'https://example.org/a', snippet: 'x'.repeat(500) },
      { title: 'js', url: 'javascript:alert(1)' }, { title: 'data', url: 'data:text/html,hi' }, { title: 'rel', url: '/relative' },
      { title: '', url: 'http://bikes.example.net/' }, { url: 'https://' + 'a'.repeat(2001) }, 'x', null,
    ] }, BRAVE)
    expect(r.engine).toEqual(BRAVE)
    expect(r.results.map((x) => [x.title, x.host])).toEqual([['Cargo bikes', 'example.org'], ['bikes.example.net', 'bikes.example.net']])
    expect(r.results[0].snippet.length).toBe(400)
    expect(parseResults({ results: Array.from({ length: 15 }, (_, i) => ({ title: 't', url: `https://e.org/${i}` })) }, BRAVE).results.length).toBe(10)
    expect(parseResults({ results: [] }, BRAVE)).toEqual({ engine: BRAVE, results: [] })
    for (const v of [null, {}, { results: 'x' }]) expect(parseResults(v, BRAVE)).toBeNull()
  })

  it('maps every error answer to its own words; unknown codes by status', () => {
    expect(errorOf(503, { error: 'not_configured' })).toBe(WebSearchError.NotConfigured)
    expect(errorOf(503, { error: 'busy' })).toBe(WebSearchError.Busy)
    expect(errorOf(429, { error: 'engine_daily_cap' })).toBe(WebSearchError.DailyCap)
    expect(errorOf(429, null)).toBe(WebSearchError.RateLimited)
    expect(errorOf(504, { error: 'nope' })).toBe(WebSearchError.Timeout)
    expect(errorOf(500, null)).toBe(WebSearchError.Network)
    for (const e of Object.values(WebSearchError)) expect(S.webResultsError[e]).toMatch(/\w/)
  })

  it('searches with POST, the words in the JSON body (never in the URL), no referrer; empty words send nothing', async () => {
    const calls = []
    const f = async (url, init) => { calls.push({ url, init }); return json(200, { engine: 'brave', label: 'Brave', results: [{ title: 'T', url: 'https://e.org/', snippet: 's' }], untrusted: true }) }
    const out = await searchWeb(BRAVE, '  cargo   bike ', f)
    expect(out.ok).toBe(true)
    expect(out.results[0].host).toBe('e.org')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/websearch')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.referrerPolicy).toBe('no-referrer')
    expect(JSON.parse(calls[0].init.body)).toEqual({ q: 'cargo bike', engine: 'brave' })
    expect(await searchWeb(BRAVE, '   ', f)).toEqual({ ok: false, error: WebSearchError.BadRequest })
    expect(calls).toHaveLength(1)
    expect(webQuery('x'.repeat(300)).length).toBe(200)
  })

  it('a refusal, a torn body or no server at all is an error, never results', async () => {
    expect(await searchWeb(BRAVE, 'q', async () => json(503, { error: 'not_configured', engine: 'brave' }))).toEqual({ ok: false, error: WebSearchError.NotConfigured })
    expect(await searchWeb(BRAVE, 'q', async () => new Response('<html>', { status: 200 }))).toEqual({ ok: false, error: WebSearchError.Network })
    expect(await searchWeb(BRAVE, 'q', async () => { throw new TypeError('offline') })).toEqual({ ok: false, error: WebSearchError.Network })
    expect(await searchWeb(BRAVE, 'q', async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e })).toEqual({ ok: false, error: WebSearchError.Timeout })
  })

  it('the engine list: no route (404), HTML or no server = none (the button never shows)', async () => {
    expect(await fetchEngines(async () => json(404, { error: 'not_found' }))).toEqual([])
    expect(await fetchEngines(async () => new Response('<!doctype html>', { status: 200 }))).toEqual([])
    expect(await fetchEngines(async () => { throw new TypeError('offline') })).toEqual([])
    expect(await fetchEngines(async () => json(200, { engines: [{ id: 'brave', label: 'Brave', mode: 'api', configured: true }] }))).toEqual([BRAVE])
  })

  it('the yes is remembered once per engine, idempotent; odd stored values read as none', () => {
    const s = {}
    giveWebConsent(s, 'brave')
    giveWebConsent(s, 'brave')
    giveWebConsent(s, 'mojeek')
    giveWebConsent(s, 'Not An Id')
    expect(s.webSearchConsent).toEqual(['brave', 'mojeek'])
    expect(webConsents({ webSearchConsent: 'brave' })).toEqual([])
    expect(webConsents({ webSearchConsent: ['brave', 3, null, 'Bad Id'] })).toEqual(['brave'])
  })

  it('"Search on <engine> yourself": the wave-2 link-outs plus Mojeek; nothing for an engine without a known page', () => {
    expect(engineLinkUrl('brave', 'cargo bike')).toBe('https://search.brave.com/search?q=cargo%20bike')
    expect(engineLinkUrl('mojeek', 'a&b')).toBe('https://www.mojeek.com/search?q=a%26b')
    expect(engineLinkUrl('metager', 'x')).toBeNull()
    expect(engineLinkUrl('brave', '  ')).toBeNull()
  })

  it('the binding copy of the contract', () => {
    expect(S.webResultsVia('Brave')).toBe('Outside TrustWeb, untrusted results, via Brave.')
    expect(S.webResultsSent('Brave')).toBe('Your words were sent to Brave through our server. Your device address was not.')
    expect(S.webResultsYourself('Brave')).toBe('Search on Brave yourself')
    expect(S.webResultsConsent('Brave')).toBe('Searching here sends your words to Brave. Continue?')
  })
})
