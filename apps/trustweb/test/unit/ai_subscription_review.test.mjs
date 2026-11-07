// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b ai-subscription review: a key never follows the person to another provider, the email rule equals the server's, honest labels. */
import { describe, expect, it } from 'vitest'
import { switchPreset } from '../../src/llm_endpoint.ts'
import { activeEndpoint, validEmail } from '../../src/ai_subscription.ts'
import { S } from '../../src/strings.ts'

const sub = { plan: 'ai', ref: 'TW-ABCDEF', email: 'a@b.cc', claim: 'c'.repeat(43), state: 'active', token: 'tok-secret' }

describe('switchPreset', () => {
  it('drops the subscription token when the person picks OpenAI, keeps the sign-up', () => {
    const next = switchPreset({ ...activeEndpoint('', 'tok-secret'), sub }, 'openai')
    expect(next).toMatchObject({ preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' })
    expect(next.sub).toEqual(sub)
  })
  it('drops one provider key on the way to another, and the custom name', () => {
    const next = switchPreset({ preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: 'sk-openai', model: 'm' }, 'claude')
    expect(next.apiKey).toBe('')
    expect(next.name).toBeUndefined()
    expect(next.baseUrl).toBe('https://api.anthropic.com/v1')
  })
  it('picking the preset already chosen changes nothing', () => {
    const cur = { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' }
    expect(switchPreset(cur, 'custom')).toBe(cur)
  })
})

describe('validEmail (same rule as the server)', () => {
  it('needs a dot in the domain and refuses control characters', () => {
    for (const e of ['a@b', 'a\u0000@b.cc', 'a@b.c\u0001c']) expect(validEmail(e)).toBe(false)
    expect(validEmail('anna@example.org')).toBe(true)
  })
})

describe('subscription privacy line', () => {
  it('says that a summary also sends the matches from the web', () => {
    expect(S.aiSubPrivacy).toMatch(/matches/)
  })
})
