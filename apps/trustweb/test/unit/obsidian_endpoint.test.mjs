// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { ingestTarget, makeAsk } from '../../src/ext/obsidian/obsidian_endpoint.ts'

const pc24 = { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' }
const spy = (body = { choices: [{ message: { content: '{"people":[]}' } }] }, ok = true, status = 200) => {
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); return { ok, status, json: async () => body } }
  return { f, calls }
}

describe('ingestTarget: only the owner\'s own Custom endpoint (pc24 preset) or a local Ollama', () => {
  it('pc24 preset and Ollama are allowed, shown with their host', () => {
    expect(ingestTarget(pc24)).toEqual({ ok: true, host: 'localhost:11435', model: 'qwen3.6:35b', label: 'pc24' })
    expect(ingestTarget({ ...pc24, name: undefined, baseUrl: 'https://llm.example.org/v1' })).toMatchObject({ ok: true, host: 'llm.example.org', label: 'llm.example.org' })
    expect(ingestTarget({ preset: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'gemma4:e4b' })).toMatchObject({ ok: true, host: 'localhost:11434' })
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
