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
