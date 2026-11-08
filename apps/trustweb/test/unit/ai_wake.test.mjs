// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { askEndpoint, askEndpointText, onWake } from '../../src/llm_endpoint.ts'
import { waitForAi } from '../../src/ai_subscription.ts'

const sub = { preset: 'tw-subscription', baseUrl: 'https://app.trustweb.one/api/ai', apiKey: 'tok', model: 'trustweb' }
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
const answer = (text) => json(200, { choices: [{ message: { content: text } }] })
const waking = () => json(503, { error: { message: 'starting up', code: 'waking' }, waking: true, eta_s: 150 })
const noSleep = async () => {}
/** fetch fake: chat answers come from `chats` in order, status answers from `states`. */
const fake = (chats, states) => {
  const calls = []
  const f = async (url, init) => { calls.push(`${init.method} ${url}`); return url.endsWith('/status') ? json(200, { state: states.shift() ?? 'up' }) : chats.shift() }
  f.calls = calls
  return f
}

describe('waitForAi', () => {
  it('polls /status until up and reports each wait', async () => {
    const f = fake([], [{ state: 'off' }.state, 'waking', 'up'])
    const ticks = []
    const ok = await waitForAi(f, 'https://app.trustweb.one/api/ai/status', { sleep: noSleep, onTick: (s) => ticks.push(s) })
    expect(ok).toBe(true)
    expect(f.calls.filter((c) => c.endsWith('/status')).length).toBe(3)
    expect(ticks).toEqual([4, 8])
  })
  it('gives up after maxWaitMs and returns false', async () => {
    const f = fake([], Array(100).fill('waking'))
    expect(await waitForAi(f, 'https://x/api/ai/status', { sleep: noSleep, maxWaitMs: 20_000 })).toBe(false)
  })
  it('a failed poll counts as not up yet', async () => {
    let n = 0
    const f = async () => { if (n++ < 2) throw new Error('offline'); return json(200, { state: 'up' }) }
    expect(await waitForAi(f, 'https://x/api/ai/status', { sleep: noSleep })).toBe(true)
  })
})

describe('askEndpoint with a sleeping pc24', () => {
  it('on a waking 503 shows the wait, polls, then retries once and returns the answer', async () => {
    const f = fake([waking(), answer('{"activity":"padel"}')], ['waking', 'up'])
    const events = []
    onWake((e) => events.push(e.phase))
    const r = await askEndpoint(sub, 'padel', f, undefined, [], { sleep: noSleep })
    onWake(undefined)
    expect(r).toEqual({ activity: 'padel' })
    expect(events).toEqual(['waiting', 'waiting', 'ready'])
    expect(f.calls.filter((c) => c.startsWith('POST')).length).toBe(2)
  })
  it('text variant retries the same way', async () => {
    const f = fake([waking(), answer('hello')], ['up'])
    expect(await askEndpointText(sub, 'sys', 'x', f, undefined, [], { sleep: noSleep })).toBe('hello')
  })
  it('never loops: a second waking answer is an error with the server message', async () => {
    const f = fake([waking(), waking()], ['up'])
    await expect(askEndpoint(sub, 'x', f, undefined, [], { sleep: noSleep })).rejects.toThrow('starting up')
    expect(f.calls.filter((c) => c.startsWith('POST')).length).toBe(2)
  })
  it('gives up with the server message when the computer never comes up', async () => {
    const f = fake([waking()], Array(100).fill('waking'))
    const events = []
    onWake((e) => events.push(e.phase))
    await expect(askEndpoint(sub, 'x', f, undefined, [], { sleep: noSleep, maxWaitMs: 8_000 })).rejects.toThrow('starting up')
    onWake(undefined)
    expect(events.at(-1)).toBe('failed')
  })
  it('only the subscription endpoint waits; a custom endpoint surfaces the 503 at once', async () => {
    const f = fake([waking()], [])
    await expect(askEndpoint({ ...sub, preset: 'custom' }, 'x', f, undefined, [], { sleep: noSleep })).rejects.toThrow('starting up')
    expect(f.calls.length).toBe(1)
  })
})
