// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-placement-2: "Which AI answers?" keeps both endpoints, switches in one step, and the call sites follow advanced.ai. */
import { aiChoiceOf, chooseAi } from '../../src/ai_choice.ts'
import { chainOf } from '../../src/ext/assistant/providers.ts'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'

const pc24 = { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: 'k', model: 'qwen3.6:35b' }
const sub = { ref: 'r', claim: 'c', plan: 'ai', state: 'active', token: 'tok' }

describe('ai_choice', () => {
  it('reads the active choice from the preset', () => {
    expect(aiChoiceOf(undefined)).toBe('own')
    expect(aiChoiceOf(pc24)).toBe('own')
    expect(aiChoiceOf({ ...pc24, preset: 'tw-subscription' })).toBe('claude')
  })
  it('switches to Claude and back in one step and keeps both configured', () => {
    const adv = { ai: { ...pc24, sub } }
    expect(chooseAi(adv, 'claude')).toBe(true)
    expect(adv.ai.preset).toBe('tw-subscription')
    expect(adv.ai.apiKey).toBe('tok')
    expect(adv.aiAlt.baseUrl).toBe(pc24.baseUrl)
    expect(chooseAi(adv, 'own')).toBe(true)
    expect(adv.ai.baseUrl).toBe(pc24.baseUrl)
    expect(adv.ai.apiKey).toBe('k')
    expect(adv.ai.sub.token).toBe('tok')
  })
  it('refuses Claude without a subscription token and changes nothing', () => {
    const adv = { ai: { ...pc24 } }
    expect(chooseAi(adv, 'claude')).toBe(false)
    expect(adv.ai.baseUrl).toBe(pc24.baseUrl)
    expect(adv.aiAlt).toBeUndefined()
  })
  it('is used by the ask/assistant call site: chainOf follows the choice', () => {
    const adv = { ai: { ...pc24, sub } }
    expect(chainOf(adv)[0].baseUrl).toBe(pc24.baseUrl)
    chooseAi(adv, 'claude')
    expect(chainOf(adv)[0].baseUrl).toBe('/api/ai')
  })
  it('is an MCP tool pair: ai_provider_get / ai_provider_set (P02 parity)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-aichoice-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'm', displayName: 'T' }, people: [], advanced: { ai: { ...pc24, sub } } }))
    const by = Object.fromEntries(allTools({ file, write: true }).map((t) => [t.name, t]))
    expect(by.ai_provider_get.run({})).toMatchObject({ answers: 'own', claudeReady: true, ownReady: true })
    expect(by.ai_provider_set.run({ provider: 'claude' })).toMatchObject({ answers: 'claude', ownReady: true })
    expect(JSON.parse(readFileSync(file, 'utf8')).advanced.ai.preset).toBe('tw-subscription')
    expect(() => by.ai_provider_set.run({ provider: 'x' })).toThrow()
    expect(Object.keys(Object.fromEntries(allTools({ file, write: false }).map((t) => [t.name, 1])))).not.toContain('ai_provider_set')
  })
})
