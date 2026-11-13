// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 assistant: the provider chain (Berget > Infomaniak > pc24), model commands, slash commands, identity line (src/ext/assistant/providers.ts). */
import { ChainError, applyModel, chainOf, identityLine, parseCommand, runChain, TURN_BUDGET_MS } from '../../src/ext/assistant/providers.ts'

const cfg = (over = {}) => ({ baseUrl: 'https://b.example/v1', apiKey: 'k', model: 'm', ...over })
const adv = (over = {}) => ({
  ai: { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' },
  assistant: { providers: { berget: cfg({ model: 'berget-model' }), infomaniak: cfg({ baseUrl: 'https://i.example/v1', model: 'info-model' }) } },
  ...over,
})

describe('chainOf', () => {
  it('orders Berget, Infomaniak, then the own endpoint as pc24', () => {
    expect(chainOf(adv()).map((p) => p.id)).toEqual(['berget', 'infomaniak', 'pc24'])
  })
  it('skips a provider without key or model; Berget has a preset address', () => {
    const a = adv({ assistant: { providers: { berget: { apiKey: 'k', baseUrl: '', model: '' }, infomaniak: cfg({ apiKey: '' }) } } })
    const chain = chainOf(a)
    expect(chain.map((p) => p.id)).toEqual(['berget', 'pc24'])
    expect(chain[0].baseUrl).toMatch(/^https:\/\/api\.berget\.ai\//)
    expect(chain[0].model).not.toBe('')
  })
  it('an empty record has an empty chain', () => { expect(chainOf(undefined)).toEqual([]); expect(chainOf({})).toEqual([]) })
  it('the preferred provider goes first; the model override lands on the first one', () => {
    const chain = chainOf(adv({ assistant: { ...adv().assistant, prefer: 'pc24', model: 'x-1' } }))
    expect(chain.map((p) => p.id)).toEqual(['pc24', 'berget', 'infomaniak'])
    expect(chain[0].model).toBe('x-1')
    expect(chain[1].model).toBe('berget-model')
  })
})

describe('applyModel', () => {
  it('a provider id makes it the preferred one and clears the model override', () => {
    expect(applyModel({ model: 'x' }, 'infomaniak')).toEqual({ prefer: 'infomaniak' })
  })
  it('any other text is a model id', () => { expect(applyModel({ prefer: 'berget' }, 'llama-9')).toEqual({ prefer: 'berget', model: 'llama-9' }) })
  it('an empty id is refused', () => { expect(() => applyModel({}, '  ')).toThrow(/model/) })
})

describe('parseCommand', () => {
  it('plain text is no command', () => { expect(parseCommand('hello /clear')).toBeNull() })
  it('/clear, tiers, /model', () => {
    expect(parseCommand('/clear')).toEqual({ cmd: 'clear' })
    expect(parseCommand(' /o ')).toEqual({ cmd: 'tier', tier: 'o' })
    expect(parseCommand('/s')).toEqual({ cmd: 'tier', tier: 's' })
    expect(parseCommand('/h')).toEqual({ cmd: 'tier', tier: 'h' })
    expect(parseCommand('/model qwen3.6:35b')).toEqual({ cmd: 'model', id: 'qwen3.6:35b' })
    expect(parseCommand('/model')).toEqual({ cmd: 'model', id: '' })
  })
  it('an unknown command is named, never sent to the AI', () => { expect(parseCommand('/dance now')).toEqual({ cmd: 'unknown', name: 'dance' }) })
  it('a path-like first word is no command', () => { expect(parseCommand('/usr/bin is a folder')).toBeNull() })
})

describe('identityLine', () => {
  it('names the real provider and model', () => {
    const line = identityLine({ id: 'berget', name: 'Berget', baseUrl: '', apiKey: '', model: 'llama-3.3-70b' })
    expect(line).toContain('Berget')
    expect(line).toContain('llama-3.3-70b')
  })
})

const P = (id, name) => ({ id, name, baseUrl: '', apiKey: '', model: `${id}-model` })
const chain3 = [P('berget', 'Berget'), P('infomaniak', 'Infomaniak'), P('pc24', 'pc24')]

describe('runChain', () => {
  it('the first provider that answers wins; the log says who', async () => {
    const log = []
    const r = await runChain(chain3, async (p) => (p.id === 'berget' ? Promise.reject(new Error('HTTP 402')) : `hi from ${p.id}`), { log: (l) => log.push(l) })
    expect(r.provider.id).toBe('infomaniak')
    expect(r.text).toBe('hi from infomaniak')
    expect(log.join('\n')).toMatch(/Berget failed: HTTP 402/)
    expect(log.join('\n')).toMatch(/Infomaniak answered/)
  })
  it('falls through on 401 and 402 to pc24', async () => {
    const r = await runChain(chain3, async (p) => { if (p.id === 'pc24') return 'ok'; throw new Error(p.id === 'berget' ? 'HTTP 402' : 'HTTP 401') })
    expect(r.provider.id).toBe('pc24')
  })
  it('all fail: a ChainError names every provider tried and every reason', async () => {
    const err = await runChain(chain3, async (p) => { throw new Error(`HTTP ${p.id === 'berget' ? 402 : 401}`) }).catch((e) => e)
    expect(err).toBeInstanceOf(ChainError)
    expect(err.tried).toEqual(['Berget', 'Infomaniak', 'pc24'])
    expect(err.reason).toMatch(/Berget: HTTP 402; Infomaniak: HTTP 401; pc24: HTTP 401/)
  })
  it('an empty chain is a ChainError, not a silent success', async () => {
    const err = await runChain([], async () => 'x').catch((e) => e)
    expect(err).toBeInstanceOf(ChainError)
    expect(err.tried).toEqual([])
  })
  it('an empty answer counts as a failure', async () => {
    const r = await runChain(chain3, async (p) => (p.id === 'berget' ? '   ' : 'real'))
    expect(r.provider.id).toBe('infomaniak')
  })
  it('the person stopping it is no failure to fall through: it rethrows at once', async () => {
    const ctl = new AbortController()
    let calls = 0
    const err = await runChain(chain3, async () => { calls++; ctl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }, { signal: ctl.signal }).catch((e) => e)
    expect(err.name).toBe('AbortError')
    expect(calls).toBe(1)
  })
  it('each provider gets its share of the 20 s budget for the first answer', async () => {
    const asked = []
    let t = 0
    await runChain(chain3, async (p, o) => { asked.push(o.firstMs); t += 5000; throw new Error('x') }, { now: () => t }).catch(() => undefined)
    expect(TURN_BUDGET_MS).toBe(20_000)
    expect(asked[0]).toBe(Math.floor(20_000 / 3))
    expect(asked[1]).toBe(Math.floor(15_000 / 2))
    expect(asked[2]).toBe(10_000)
  })
})
