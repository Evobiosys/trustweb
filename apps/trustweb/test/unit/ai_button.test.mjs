// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 llm-button: the gate of the AI button, the pi link's 10-minute expiry and the /health check. */
import { AGENT_DEFAULT_URL, AGENT_TTL_MS, aiButtonVisible, checkAgent, isLoopbackUrl, piConnected } from '../../src/ai_button.ts'

const NOW = Date.parse('2026-11-07T12:00:00Z')

describe('aiButtonVisible', () => {
  it('needs both an endpoint and pi', () => {
    expect(aiButtonVisible({ configured: true, piConnected: true })).toBe(true)
    expect(aiButtonVisible({ configured: true, piConnected: false })).toBe(false)
    expect(aiButtonVisible({ configured: false, piConnected: true })).toBe(false)
    expect(aiButtonVisible({ configured: false, piConnected: false })).toBe(false)
  })
})

describe('piConnected', () => {
  it('is false without a check', () => {
    expect(piConnected(undefined, NOW)).toBe(false)
    expect(piConnected({ baseUrl: AGENT_DEFAULT_URL }, NOW)).toBe(false)
  })
  it('holds for 10 minutes after the last check, then lapses', () => {
    const at = (ms) => ({ baseUrl: AGENT_DEFAULT_URL, connectedAt: new Date(NOW - ms).toISOString() })
    expect(piConnected(at(0), NOW)).toBe(true)
    expect(piConnected(at(AGENT_TTL_MS - 1), NOW)).toBe(true)
    expect(piConnected(at(AGENT_TTL_MS), NOW)).toBe(false)
  })
  it('ignores a time in the future or garbage', () => {
    expect(piConnected({ baseUrl: 'x', connectedAt: new Date(NOW + 60_000).toISOString() }, NOW)).toBe(false)
    expect(piConnected({ baseUrl: 'x', connectedAt: 'nope' }, NOW)).toBe(false)
  })
})

describe('isLoopbackUrl', () => {
  it('accepts only http on this device', () => {
    expect(isLoopbackUrl('http://127.0.0.1:7391')).toBe(true)
    expect(isLoopbackUrl('http://localhost:7391/')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:7391')).toBe(true)
    expect(isLoopbackUrl('http://example.com')).toBe(false)
    expect(isLoopbackUrl('https://127.0.0.1.evil.com')).toBe(false)
    expect(isLoopbackUrl('ftp://127.0.0.1')).toBe(false)
    expect(isLoopbackUrl('nonsense')).toBe(false)
  })
})

describe('checkAgent', () => {
  const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body })
  it('is true on 200 with {agent:"pi"} from <base>/health', async () => {
    let seen = ''
    const f = async (url, init) => { seen = url; expect(init.signal).toBeDefined(); return { ok: true, status: 200, json: async () => ({ agent: 'pi' }) } }
    expect(await checkAgent('http://127.0.0.1:7391/', f)).toBe(true)
    expect(seen).toBe('http://127.0.0.1:7391/health')
  })
  it('is false on another agent, another status, bad JSON, a throw or a non-loopback URL', async () => {
    expect(await checkAgent('http://127.0.0.1:7391', reply(200, { agent: 'other' }))).toBe(false)
    expect(await checkAgent('http://127.0.0.1:7391', reply(500, { agent: 'pi' }))).toBe(false)
    expect(await checkAgent('http://127.0.0.1:7391', async () => ({ ok: true, status: 200, json: async () => { throw new Error('x') } }))).toBe(false)
    expect(await checkAgent('http://127.0.0.1:7391', async () => { throw new Error('refused') })).toBe(false)
    let called = false
    expect(await checkAgent('http://example.com', async () => { called = true; return { ok: true, status: 200, json: async () => ({ agent: 'pi' }) } })).toBe(false)
    expect(called).toBe(false)
  })
  it('aborts after the timeout', async () => {
    const f = (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    expect(await checkAgent('http://127.0.0.1:7391', f, 20)).toBe(false)
  })
})

describe('aiButtonTarget (wave 37)', () => {
  it('opens Ask with an endpoint, else the plan choice in Settings', async () => {
    const { aiButtonTarget, AI_PLAN_ANCHOR } = await import('../../src/ai_button.ts')
    expect(aiButtonTarget(true)).toEqual({ kind: 'ask' })
    expect(aiButtonTarget(false)).toEqual({ kind: 'settings', anchor: AI_PLAN_ANCHOR })
    expect(AI_PLAN_ANCHOR).toBe('[data-ai-group="sub"]')
  })
})
