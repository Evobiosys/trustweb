// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 assistant: the stream state machine (timeout path, reply read whole, identity in the system prompt) and the chain over it (src/ext/assistant/chat_stream.ts). */
import { streamChain, streamChat } from '../../src/ext/assistant/chat_stream.ts'

const ai = { preset: 'custom', baseUrl: 'http://x.example/v1', apiKey: '', model: 'm' }
const sse = (text) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
const hangs = (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
const msgs = [{ role: 'user', content: 'hi' }]

describe('streamChat', () => {
  it('a provider that says nothing within firstMs ends with a timeout error, never silence', async () => {
    const err = await streamChat(ai, msgs, () => undefined, new AbortController().signal, [], 100, { fetchFn: hangs, firstMs: 30 }).catch((e) => e)
    expect(err.message).toMatch(/no answer within/)
  })
  it('the person stopping it still ends as an abort', async () => {
    const ctl = new AbortController()
    const p = streamChat(ai, msgs, () => undefined, ctl.signal, [], 100, { fetchFn: hangs, firstMs: 5000 }).catch((e) => e)
    ctl.abort()
    expect((await p).name).toBe('AbortError')
  })
  it('streams text, reports it piece by piece', async () => {
    const seen = []
    const full = await streamChat(ai, msgs, (t) => seen.push(t), new AbortController().signal, [], 100, { fetchFn: async () => sse('hello') })
    expect(full).toBe('hello')
    expect(seen.at(-1)).toBe('hello')
  })
  it('sends the thinking level as reasoning_effort', async () => {
    let body
    await streamChat(ai, msgs, () => undefined, new AbortController().signal, [], 100, { fetchFn: async (_u, init) => { body = JSON.parse(init.body); return sse('x') }, thinking: 'high' })
    expect(body.reasoning_effort).toBe('high')
  })
  it('an error status carries the status in the message', async () => {
    const err = await streamChat(ai, msgs, () => undefined, new AbortController().signal, [], 100, { fetchFn: async () => new Response('{}', { status: 402 }) }).catch((e) => e)
    expect(err.message).toBe('HTTP 402')
  })
})

describe('streamChain', () => {
  const prov = (id, name, model, baseUrl) => ({ id, name, baseUrl, apiKey: 'k', model })
  const chain = [prov('berget', 'Berget', 'b-model', 'http://b.example/v1'), prov('pc24', 'pc24', 'qwen3.6:35b', 'http://p.example/v1')]
  const build = (p) => [{ role: 'system', content: `You run on ${p.name}, model ${p.model}.` }, ...msgs]

  it('402 at Berget: pc24 answers; the system prompt it got names pc24 and its own model; the answer is the canned model line', async () => {
    const sent = []
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body)
      sent.push({ url, system: body.messages[0].content })
      if (url.startsWith('http://b.example')) return new Response('{"error":{"message":"no credits"}}', { status: 402 })
      return sse(`I am running ${body.model}.`)
    }
    const r = await streamChain(chain, build, () => undefined, new AbortController().signal, [], { fetchFn })
    expect(r.provider.id).toBe('pc24')
    expect(r.text).toBe('I am running qwen3.6:35b.')
    expect(sent[1].system).toContain('qwen3.6:35b')
    expect(sent[0].system).toContain('b-model')
  })
  it('every provider silent: ends with a ChainError within the budget, listing all three reasons', async () => {
    const three = [...chain, prov('infomaniak', 'Infomaniak', 'i', 'http://i.example/v1')]
    const err = await streamChain(three, build, () => undefined, new AbortController().signal, [], { fetchFn: hangs, budgetMs: 90 }).catch((e) => e)
    expect(err.tried).toEqual(['Berget', 'pc24', 'Infomaniak'])
    expect(err.reason).toMatch(/Berget: .*no answer/)
  })
})
