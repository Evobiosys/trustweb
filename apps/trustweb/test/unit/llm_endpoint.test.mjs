// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { askEndpoint, buildRequest, configured, parseReply, PRESETS } from '../../src/llm_endpoint.ts'

const NOW = Date.UTC(2026, 9, 30)
const cfg = { preset: 'custom', baseUrl: 'https://api.example.org/v1/', apiKey: 'sk-secret', model: 'm1' }
const reply = (content, ok = true, status = 200) => ({ ok, status, json: async () => (typeof content === 'string' ? { choices: [{ message: { content } }] } : content) })

describe('buildRequest', () => {
  it('posts OpenAI-compatible chat completions with a Bearer key', () => {
    const r = buildRequest(cfg, 'hello')
    expect(r.url).toBe('https://api.example.org/v1/chat/completions')
    expect(r.init.method).toBe('POST')
    expect(r.init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-secret' })
    const b = JSON.parse(r.init.body)
    expect(b).toMatchObject({ model: 'm1', temperature: 0, stream: false, max_tokens: 300 })
    expect(b.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(b.messages[1].content).toBe('hello')
  })
  it('sends no Authorization header when the key is empty', () => {
    expect(buildRequest({ ...cfg, apiKey: '' }, 'x').init.headers).toEqual({ 'Content-Type': 'application/json' })
  })
})

describe('parseReply', () => {
  it('strips code fences and parses JSON', () => {
    expect(parseReply({ choices: [{ message: { content: '```json\n{"activity":"padel"}\n```' } }] })).toEqual({ activity: 'padel' })
  })
  it('null on bad JSON or a missing message', () => {
    expect(parseReply({ choices: [{ message: { content: 'nope' } }] })).toBeNull()
    expect(parseReply({})).toBeNull()
  })
})

describe('askEndpoint', () => {
  it('returns the parsed draft', async () => {
    expect(await askEndpoint(cfg, 'x', async () => reply('{"activity":"padel"}'))).toEqual({ activity: 'padel' })
  })
  it('throws the endpoint message on non-200', async () => {
    await expect(askEndpoint(cfg, 'x', async () => reply({ error: { message: 'bad key' } }, false, 401))).rejects.toThrow('bad key')
    await expect(askEndpoint(cfg, 'x', async () => reply({}, false, 500))).rejects.toThrow('500')
  })
  it('throws on bad JSON content', async () => {
    await expect(askEndpoint(cfg, 'x', async () => reply('not json'))).rejects.toThrow()
  })
  it('aborts after the timeout', async () => {
    const hang = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    await expect(askEndpoint(cfg, 'x', hang, 10)).rejects.toThrow('aborted')
  })
})

describe('configured / presets', () => {
  it('needs a base URL and a model', () => {
    expect(configured(undefined)).toBe(false)
    expect(configured({ ...cfg, model: '' })).toBe(false)
    expect(configured(cfg)).toBe(true)
  })
  it('presets: Ollama local, pc24 dev', () => {
    expect(PRESETS.ollama.baseUrl).toBe('http://localhost:11434/v1')
    expect(PRESETS.pc24).toMatchObject({ baseUrl: 'http://localhost:11435/v1', model: 'qwen3.6:35b' })
  })
})

describe('wired to the together draft', () => {
  it('draftOrPlain uses the configured endpoint draft', async () => {
    const { draftOrPlain } = await import('../../src/together_request.ts')
    const r = await draftOrPlain('who is up for something sporty', NOW, (t) => askEndpoint(cfg, t, async () => reply('{"activity":"padel"}')), true)
    expect(r?.activity).toBe('padel')
  })
})
