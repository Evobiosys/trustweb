// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { endpointRule, ingestTarget, makeAsk, mayRun } from '../../src/ext/obsidian/obsidian_endpoint.ts'

const pc24 = { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' }
const spy = (body = { choices: [{ message: { content: '{"people":[]}' } }] }, ok = true, status = 200) => {
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); return { ok, status, json: async () => body } }
  return { f, calls }
}

describe('ingestTarget: only the owner\'s own Custom endpoint (pc24 preset) or a local Ollama', () => {
  it('pc24 preset is allowed; Ollama (loopback) and other hosts need the per-host confirm; all shown with their host', () => {
    expect(ingestTarget(pc24)).toEqual({ ok: true, host: 'localhost:11435', model: 'qwen3.6:35b', label: 'pc24', trust: 'allowed', loopback: true })
    expect(ingestTarget({ ...pc24, name: undefined, baseUrl: 'https://llm.example.org/v1' })).toMatchObject({ ok: true, host: 'llm.example.org', label: 'llm.example.org', trust: 'confirm' })
    expect(ingestTarget({ preset: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'gemma4:e4b' })).toMatchObject({ ok: true, host: 'localhost:11434', trust: 'confirm', loopback: true })
  })
  it('no endpoint, or one without address or model: none', () => {
    expect(ingestTarget(undefined)).toEqual({ ok: false, why: 'none' })
    expect(ingestTarget({ ...pc24, baseUrl: '' })).toEqual({ ok: false, why: 'none' })
    expect(ingestTarget({ ...pc24, model: ' ' })).toEqual({ ok: false, why: 'none' })
  })
  it('a cloud preset (subscription, OpenAI, Claude) is refused even when it is set up', () => {
    for (const preset of ['tw-subscription', 'openai', 'claude']) expect(ingestTarget({ preset, baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm' })).toEqual({ ok: false, why: 'cloud' })
  })
})

describe('makeAsk', () => {
  it('refused target: no function, so no request can be made', () => {
    const { f, calls } = spy()
    expect(makeAsk(undefined, f)).toBeNull()
    expect(makeAsk({ ...pc24, preset: 'openai' }, f)).toBeNull()
    expect(calls).toHaveLength(0)
  })
  it('one POST to the endpoint\'s chat/completions with the system prompt, the notes and no thinking on pc24; returns the JSON', async () => {
    const { f, calls } = spy({ choices: [{ message: { content: '```json\n{"people":[{"name":"A B"}]}\n```' } }] })
    const out = await makeAsk(pc24, f)('SYSTEM', 'USER TEXT')
    expect(out).toEqual({ people: [{ name: 'A B' }] })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:11435/v1/chat/completions')
    const body = JSON.parse(calls[0].init.body)
    expect(body.model).toBe('qwen3.6:35b')
    expect(body.stream).toBe(false)
    expect(body.reasoning_effort).toBe('none')
    expect(body.messages).toEqual([{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'USER TEXT' }])
    expect(body.max_tokens).toBeGreaterThan(1000)
    expect(calls[0].init.headers.Authorization).toBeUndefined()
  })
  it('a key goes only as the Authorization header to the endpoint; no thinking switch for other endpoints', async () => {
    const { f, calls } = spy()
    await makeAsk({ ...pc24, name: undefined, baseUrl: 'https://llm.example.org/v1', apiKey: 'sekret' }, f)('s', 'u')
    expect(calls[0].init.headers.Authorization).toBe('Bearer sekret')
    expect(JSON.parse(calls[0].init.body).reasoning_effort).toBeUndefined()
    expect(calls[0].url.startsWith('https://llm.example.org/v1/')).toBe(true)
  })
  it('an HTTP error throws with the endpoint\'s message; a reply that is not JSON throws', async () => {
    await expect(makeAsk(pc24, spy({ error: { message: 'model not found' } }, false, 404).f)('s', 'u')).rejects.toThrow('model not found')
    await expect(makeAsk(pc24, spy({ choices: [{ message: { content: 'sorry, no' } }] }).f)('s', 'u')).rejects.toThrow('not JSON')
  })
})

const custom = (baseUrl, over = {}) => ({ preset: 'custom', baseUrl, apiKey: '', model: 'm', ...over })

describe('B4 hosted AI services are never a target, not even under Custom', () => {
  const hosted = [
    'https://api.openai.com/v1', 'https://openai.azure.com/openai', 'https://myres.openai.azure.com/openai/v1', 'https://api.anthropic.com/v1',
    'https://openrouter.ai/api/v1', 'https://generativelanguage.googleapis.com/v1beta/openai', 'https://api.mistral.ai/v1', 'https://api.groq.com/openai/v1',
    'https://api.together.xyz/v1', 'https://api.cohere.ai/v1', 'https://api.cohere.com/v1', 'https://api.x.ai/v1', 'https://api.deepseek.com/v1',
    'https://eu.api.openai.com/v1', 'https://API.OPENAI.COM./v1',
  ]
  it.each(hosted)('%s is refused', (url) => {
    expect(ingestTarget(custom(url))).toEqual({ ok: false, why: 'cloud' })
    expect(makeAsk(custom(url), spy().f)).toBeNull()
  })
  it('a look-alike host that only ends in the same letters is not a subdomain', () => {
    expect(ingestTarget(custom('https://notopenai.com/v1')).ok).toBe(true)
    expect(ingestTarget(custom('https://evilapi.openai.com.example.org/v1')).ok).toBe(true)
  })
  it('the TrustWeb subscription host is refused under Custom too', async () => {
    const { SUBSCRIPTION_HOSTS } = await import('../../src/ext/obsidian/obsidian_endpoint.ts')
    expect(SUBSCRIPTION_HOSTS.length).toBeGreaterThan(0)
    for (const h of SUBSCRIPTION_HOSTS) expect(ingestTarget(custom(`https://${h}/api/ai`))).toEqual({ ok: false, why: 'cloud' })
  })
})

describe('B4 where plain http and the Ollama preset may point', () => {
  it('the ollama preset needs a loopback host', () => {
    const ollama = (baseUrl) => ({ preset: 'ollama', baseUrl, apiKey: '', model: 'm' })
    expect(ingestTarget(ollama('http://localhost:11434/v1')).ok).toBe(true)
    expect(ingestTarget(ollama('http://127.0.0.1:11434/v1')).ok).toBe(true)
    expect(ingestTarget(ollama('http://[::1]:11434/v1')).ok).toBe(true)
    expect(ingestTarget(ollama('https://llm.example.org/v1'))).toEqual({ ok: false, why: 'notlocal' })
    expect(ingestTarget(ollama('http://192.168.1.5:11434/v1'))).toEqual({ ok: false, why: 'notlocal' })
  })
  it('http:// is for loopback only; https:// anywhere else', () => {
    expect(ingestTarget(custom('http://localhost:11435/v1')).ok).toBe(true)
    expect(ingestTarget(custom('http://127.0.0.1:8080/v1')).ok).toBe(true)
    expect(ingestTarget(custom('http://llm.example.org/v1'))).toEqual({ ok: false, why: 'insecure' })
    expect(ingestTarget(custom('http://192.168.1.5:8080/v1'))).toEqual({ ok: false, why: 'insecure' })
    expect(ingestTarget(custom('https://llm.example.org/v1')).ok).toBe(true)
  })
  it('other schemes are no endpoint', () => {
    expect(ingestTarget(custom('ftp://llm.example.org/v1'))).toEqual({ ok: false, why: 'none' })
    expect(ingestTarget(custom('javascript:alert(1)'))).toEqual({ ok: false, why: 'none' })
  })
})

describe('B3 the request never follows a redirect and carries nothing else', () => {
  it('redirect error, no credentials, no referrer', async () => {
    const { f, calls } = spy()
    await makeAsk(pc24, f)('s', 'u')
    expect(calls[0].init.redirect).toBe('error')
    expect(calls[0].init.credentials).toBe('omit')
    expect(calls[0].init.referrerPolicy).toBe('no-referrer')
  })
})

describe('B5 the caller\'s signal aborts the request in flight', () => {
  const hanging = () => {
    const calls = []
    const f = (url, init) => { calls.push(init); return new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))) }) }
    return { f, calls }
  }
  it('abort() reaches fetch and the ask rejects at once', async () => {
    const { f, calls } = hanging()
    const ctl = new AbortController()
    const p = makeAsk(pc24, f)('s', 'u', ctl.signal)
    ctl.abort()
    await expect(p).rejects.toThrow()
    expect(calls[0].signal.aborted).toBe(true)
  })
  it('an already aborted signal never calls fetch', async () => {
    const { f, calls } = hanging()
    const ctl = new AbortController()
    ctl.abort()
    await expect(makeAsk(pc24, f)('s', 'u', ctl.signal)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})

// Wave 42 (Q01), tightened 2026-11-12: allow-list = the pc24 preset only; any other typed host needs a per-host confirm naming host and model; plain http only to loopback.
describe('endpointRule: the one pure rule (table)', () => {
  const table = [
    // [base URL, name, expected]
    ['http://localhost:11435/v1', 'pc24', { trust: 'allowed', loopback: true }],
    // Jakob 2026-11-12: allow-list = pc24 preset ONLY; loopback is a program on this device, so it is confirmed per host like any other
    ['http://localhost:11434/v1', undefined, { trust: 'confirm', loopback: true }],
    ['http://127.0.0.1:8080/v1', undefined, { trust: 'confirm', loopback: true }],
    ['https://localhost/v1', undefined, { trust: 'confirm', loopback: true }],
    ['http://[::1]:11434/v1', undefined, { trust: 'confirm', loopback: true }],
    ['http://foo.localhost:1/v1', undefined, { trust: 'confirm', loopback: true }],
    ['http://localhost:11435/v1', undefined, { trust: 'confirm', loopback: true }],
    ['http://localhost:11435/v1', 'my box', { trust: 'confirm', loopback: true }],
    ['http://127.0.0.1:11435/v1', 'pc24', { trust: 'confirm', loopback: true }],
    ['http://localhost:9999/v1', 'pc24', { trust: 'confirm', loopback: true }],
    // typed Custom address is not automatically own (wave 41 report line 49): it must be confirmed per host
    ['https://llm.example.org/v1', undefined, { trust: 'confirm', loopback: false }],
    ['https://100.64.1.2:8443/v1', undefined, { trust: 'confirm' }],
    // the name "pc24" at another address does not make it pc24
    ['https://llm.example.org/v1', 'pc24', { trust: 'confirm' }],
    // plain http only to loopback
    ['http://llm.example.org/v1', undefined, { trust: 'refused', why: 'insecure' }],
    ['http://192.168.1.5:11434/v1', undefined, { trust: 'refused', why: 'insecure' }],
    // second guard: hosted AI services, subdomains included, even when the owner would confirm
    ['https://api.openai.com/v1', undefined, { trust: 'refused', why: 'cloud' }],
    ['https://eu.api.anthropic.com/v1', undefined, { trust: 'refused', why: 'cloud' }],
    ['https://openrouter.ai/api/v1', 'pc24', { trust: 'refused', why: 'cloud' }],
    ['https://api.mistral.ai/v1', undefined, { trust: 'refused', why: 'cloud' }],
    // a look-alike is not a loopback
    ['https://localhost.evil.example/v1', undefined, { trust: 'confirm' }],
    ['https://127.0.0.1.evil.example/v1', undefined, { trust: 'confirm' }],
    // not usable
    ['', undefined, { trust: 'refused', why: 'none' }],
    ['not a url', undefined, { trust: 'refused', why: 'none' }],
    ['ftp://localhost/v1', undefined, { trust: 'refused', why: 'none' }],
  ]
  for (const [url, name, want] of table) it(`${url || '(empty)'} ${name ?? ''} -> ${want.trust}${want.why ? ' ' + want.why : ''}`, () => { expect(endpointRule(url, name)).toMatchObject(want) })
})

describe('mayRun: a confirmation is needed only where the rule says confirm', () => {
  const ep = (baseUrl) => ({ preset: 'custom', baseUrl, apiKey: '', model: 'm' })
  it('pc24 preset: no confirm needed; loopback or other host: only after its own confirm', () => {
    expect(mayRun(ingestTarget({ ...ep('http://localhost:11435/v1'), name: 'pc24' }), () => false)).toBe(true)
    const loop = ingestTarget(ep('http://localhost:11434/v1'))
    expect(mayRun(loop, () => false)).toBe(false)
    expect(mayRun(loop, (h) => h === 'localhost:11434')).toBe(true)
    const other = ingestTarget(ep('https://llm.example.org/v1'))
    expect(mayRun(other, () => false)).toBe(false)
    expect(mayRun(other, (h) => h === 'llm.example.org')).toBe(true)
    expect(mayRun(other, (h) => h === 'another.example.org')).toBe(false)
  })
  it('a refused target never runs, confirmed or not', () => {
    expect(mayRun(ingestTarget(ep('https://api.openai.com/v1')), () => true)).toBe(false)
    expect(mayRun(ingestTarget(ep('http://llm.example.org/v1')), () => true)).toBe(false)
  })
})

describe('the confirm copy names host and model and explains loopback in one plain sentence', () => {
  it('loopback host: the explanation is there; other host: it is not', async () => {
    const { S } = await import('../../src/strings.ts')
    const t = ingestTarget({ preset: 'custom', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'gemma' })
    const copy = S.obsidian.confirmHost(t.host, t.model, t.loopback)
    expect(copy).toContain('localhost:11434')
    expect(copy).toContain('gemma')
    expect(copy).toContain('Loopback (localhost, 127.0.0.1) means a program on this very device.')
    expect(S.obsidian.confirmHost('llm.example.org', 'm', false)).not.toContain('Loopback')
  })
})
