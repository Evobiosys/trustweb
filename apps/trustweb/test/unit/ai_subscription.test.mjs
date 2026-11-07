// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 ai-subscription: plans, claim, sign-up and poll calls, the active endpoint, legacy pc24 migration, labels. */
import { describe, expect, it } from 'vitest'
import { activeEndpoint, checkSubscription, apiBase, pollsOnOpen, devPc24Seed, makeClaim, migrateAi, PLANS, poll, presetLabel, signUp, validEmail } from '../../src/ai_subscription.ts'

const reply = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

describe('PLANS', () => {
  it('match the contract table', () => {
    expect(PLANS.ai).toMatchObject({ euro: 18, quota: 1500 })
    expect(PLANS.light).toMatchObject({ euro: 5, quota: 300 })
  })
})

describe('apiBase', () => {
  it('is empty (same origin) without a build variable', () => { expect(apiBase()).toBe('') })
})

describe('makeClaim', () => {
  it('is 43 chars of base64url for 32 bytes', () => {
    const c = makeClaim(new Uint8Array(32).fill(251))
    expect(c).toHaveLength(43)
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(c).toBe('-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_v7-_s')
  })
  it('differs between random draws', () => { expect(makeClaim()).not.toBe(makeClaim()) })
})

describe('validEmail', () => {
  it('accepts a plain address', () => { expect(validEmail(' anna@example.org ')).toBe(true) })
  it.each(['', 'a', 'a@', '@b.org', 'a@@b.org', 'a b@c.org', 'a@b\n.org', 'a<b>@c.org', 'a"@c.org', 'a,b@c.org', 'a@b.org, c@d.org'])('rejects %j', (e) => {
    expect(validEmail(e)).toBe(false)
  })
  it('rejects over 254 chars', () => { expect(validEmail('a'.repeat(250) + '@b.org')).toBe(false) })
})

describe('signUp', () => {
  const ok = { ref: 'TW-AB23CD', plan: 'ai', amount_eur: 18, state: 'pending', mail: 'sent' }
  it('posts the plan, trimmed email and claim as JSON', async () => {
    let seen
    const r = await signUp(async (url, init) => { seen = { url, init }; return reply(ok) }, 'http://x', { plan: 'ai', email: ' a@b.org ', claim: 'C' })
    expect(r).toEqual(ok)
    expect(seen.url).toBe('http://x/api/subscribe')
    expect(seen.init.method).toBe('POST')
    expect(seen.init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(seen.init.body)).toEqual({ plan: 'ai', email: 'a@b.org', claim: 'C' })
  })
  it('throws the server message', async () => {
    await expect(signUp(async () => reply({ error: 'too many sign-ups, try later' }, false, 429), '', { plan: 'ai', email: 'a@b.org', claim: 'C' })).rejects.toThrow('too many sign-ups, try later')
  })
  it('throws on a network failure with a plain message', async () => {
    await expect(signUp(async () => { throw new TypeError('Failed to fetch') }, '', { plan: 'ai', email: 'a@b.org', claim: 'C' })).rejects.toThrow('Failed to fetch')
  })
})

describe('poll', () => {
  it('sends the claim header and returns the state', async () => {
    let seen
    const r = await poll(async (url, init) => { seen = { url, init }; return reply({ state: 'active', plan: 'ai', quota: 1500, used: 3, month: '2026-11', token: 'T' }) }, 'http://x', 'TW-AB23CD', 'CLAIM')
    expect(seen.url).toBe('http://x/api/subscribe/TW-AB23CD')
    expect(seen.init.headers['X-TW-Claim']).toBe('CLAIM')
    expect(r).toMatchObject({ state: 'active', used: 3, token: 'T' })
  })
  it('throws the server message on unknown', async () => {
    await expect(poll(async () => reply({ error: 'unknown' }, false, 404), '', 'TW-X', 'C')).rejects.toThrow('unknown')
  })
})

describe('activeEndpoint', () => {
  it('points the chat route at the subscription API', () => {
    expect(activeEndpoint('http://x', 'T')).toEqual({ preset: 'tw-subscription', baseUrl: 'http://x/api/ai', apiKey: 'T', model: 'trustweb' })
  })
})

describe('migrateAi', () => {
  it('turns legacy pc24 into a named custom endpoint', () => {
    expect(migrateAi({ preset: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: 'k', model: 'm' })).toEqual({ preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: 'k', model: 'm' })
  })
  it('leaves other presets and undefined alone', () => {
    const a = { preset: 'openai', baseUrl: 'u', apiKey: '', model: 'm' }
    expect(migrateAi(a)).toBe(a)
    expect(migrateAi(undefined)).toBeUndefined()
  })
})

describe('devPc24Seed', () => {
  it('is pc24 as a custom endpoint', () => {
    expect(devPc24Seed()).toEqual({ preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' })
  })
})

describe('presetLabel', () => {
  it('names a custom endpoint', () => { expect(presetLabel({ preset: 'custom', name: 'pc24', baseUrl: '', apiKey: '', model: '' })).toBe('Custom: pc24') })
  it('plain Custom without a name', () => { expect(presetLabel({ preset: 'custom', baseUrl: '', apiKey: '', model: '' })).toBe('Custom') })
})

describe('checkSubscription', () => {
  const sub = { plan: 'ai', ref: 'TW-AB23CD', email: 'a@b.org', claim: 'C', state: 'pending' }
  const ai = { preset: 'custom', baseUrl: 'u', apiKey: 'k', model: 'm', sub }
  it('stays pending and leaves the endpoint alone', async () => {
    const r = await checkSubscription(async () => reply({ state: 'pending' }), 'http://x', ai)
    expect(r.ai).toEqual({ ...ai, sub: { ...sub, state: 'pending' } })
  })
  it('switches to the subscription endpoint when the token arrives', async () => {
    const r = await checkSubscription(async () => reply({ state: 'active', plan: 'ai', quota: 1500, used: 3, month: '2026-11', token: 'T' }), 'http://x', ai)
    expect(r.ai).toEqual({ preset: 'tw-subscription', baseUrl: 'http://x/api/ai', apiKey: 'T', model: 'trustweb', sub: { ...sub, state: 'active', token: 'T' } })
    expect(r).toMatchObject({ used: 3, quota: 1500 })
  })
  it('active without a token (already delivered) keeps the endpoint, updates the state', async () => {
    const r = await checkSubscription(async () => reply({ state: 'active', quota: 1500, used: 4 }), '', { ...ai, sub: { ...sub, state: 'active', token: 'T' } })
    expect(r.ai.sub).toMatchObject({ state: 'active', token: 'T' })
    expect(r.used).toBe(4)
  })
  it('revoked is recorded', async () => {
    expect((await checkSubscription(async () => reply({ state: 'revoked' }), '', ai)).ai.sub.state).toBe('revoked')
  })
  it('does nothing without a sign-up', async () => {
    const plain = { preset: 'custom', baseUrl: '', apiKey: '', model: '' }
    expect((await checkSubscription(async () => { throw new Error('no call') }, '', plain)).ai).toBe(plain)
  })
})

describe('pollsOnOpen', () => {
  it('re-checks pending and active sign-ups, so usage and a revoke show up', () => {
    expect(pollsOnOpen({ state: 'pending' })).toBe(true)
    expect(pollsOnOpen({ state: 'active' })).toBe(true)
    expect(pollsOnOpen({ state: 'revoked' })).toBe(false)
    expect(pollsOnOpen(undefined)).toBe(false)
  })
})
