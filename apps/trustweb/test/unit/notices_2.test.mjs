// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b notices-2: the AI Test result lines, the Approve box rule, the 30-day delete wording. */
import { describe, expect, it } from 'vitest'
import { testEndpoint, testResultLines } from '../../src/llm_endpoint.ts'
import { approveBoxVisible } from '../../src/dev_preview_rules.ts'
import { S } from '../../src/strings.ts'

const ai = { preset: 'custom', baseUrl: 'http://x/v1', apiKey: '', model: 'm' }
const reply = (content) => ({ choices: [{ message: { content } }] })
const fake = (ok, status, body) => async () => ({ ok, status, json: async () => body })
const kinds = (lines) => lines.map((l) => l.kind)

describe('testResultLines', () => {
  it('success: status, the reply cut at 200 characters', () => {
    const lines = testResultLines({ ok: true, ms: 1234, reply: 'x'.repeat(300) })
    expect(kinds(lines)).toEqual(['status', 'raw'])
    expect(lines[0]).toMatchObject({ ok: true, text: 'Answered in 1.2 s' })
    expect(lines[1].text).toHaveLength(200)
  })
  it('not JSON: failed, the endpoint message, the raw text, the model-name hint', () => {
    const lines = testResultLines({ ok: false, message: 'not JSON', raw: 'Hello there' })
    expect(kinds(lines)).toEqual(['status', 'message', 'raw', 'hint'])
    expect(lines[0]).toMatchObject({ ok: false, text: 'Failed' })
    expect(lines[3].text).toBe('The endpoint answered, but not with JSON: check the model name')
  })
  it('401 gets the key hint, a timeout the 30 s hint, no raw line when there is none', () => {
    expect(testResultLines({ ok: false, message: 'Unauthorized', status: 401 }).at(-1).text).toBe('Key rejected')
    const t = testResultLines({ ok: false, message: 'aborted', timedOut: true })
    expect(kinds(t)).toEqual(['status', 'message', 'hint'])
    expect(t.at(-1).text).toBe('No answer in 30 s')
  })
  it('an unknown failure has no hint but is never one line', () => {
    expect(kinds(testResultLines({ ok: false, message: 'HTTP 500', status: 500, raw: '{"e":1}' }))).toEqual(['status', 'message', 'raw'])
  })
  it('raw is cut at 200 characters', () => {
    expect(testResultLines({ ok: false, message: 'm', raw: 'y'.repeat(500) })[2].text).toHaveLength(200)
  })
})

describe('testEndpoint', () => {
  it('JSON reply -> ok with the reply text', async () => {
    const o = await testEndpoint(ai, fake(true, 200, reply('{"a":1}')))
    expect(o).toMatchObject({ ok: true, reply: '{"a":1}' })
  })
  it('plain text reply -> not JSON with the raw text', async () => {
    expect(await testEndpoint(ai, fake(true, 200, reply('Hello')))).toMatchObject({ ok: false, message: 'not JSON', raw: 'Hello' })
  })
  it('401 keeps the status, the endpoint message and the body', async () => {
    expect(await testEndpoint(ai, fake(false, 401, { error: { message: 'bad key' } }))).toMatchObject({ ok: false, status: 401, message: 'bad key', raw: '{"error":{"message":"bad key"}}' })
  })
  it('a body that is not JSON at all keeps its raw text (review)', async () => {
    const html = async () => ({ ok: false, status: 502, json: async () => { throw new Error('x') }, text: async () => '<html>Bad gateway</html>' })
    expect(await testEndpoint(ai, html)).toMatchObject({ ok: false, status: 502, message: 'HTTP 502', raw: '<html>Bad gateway</html>' })
  })
  it('the result words come from strings.ts (review)', () => {
    expect(testResultLines({ ok: false, message: 'x', status: 401 }).at(-1).text).toBe(S.aiTestHintKey)
    expect(testResultLines({ ok: true, ms: 1500, reply: 'r' })[0].text).toBe(S.aiTestOk(1500))
  })
  it('a timeout is flagged', async () => {
    const hang = (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    expect(await testEndpoint(ai, hang, 20)).toMatchObject({ ok: false, timedOut: true })
  })
})

describe('approveBoxVisible', () => {
  it('shows only while the panel is expanded with all rows', () => {
    expect(approveBoxVisible({ collapsed: false, focused: false })).toBe(true)
    expect(approveBoxVisible({ collapsed: true, focused: false })).toBe(false)
    expect(approveBoxVisible({ collapsed: false, focused: true })).toBe(false)
  })
})

describe('30-day wording', () => {
  it('the delete toast says it can be restored within 30 days', () => {
    expect(S.deletedToast('Anna')).toBe('Anna deleted (you can restore it within 30 days)')
  })
  it('the countdown leads are split from the number', () => {
    expect(S.mergeCountdownLead('A', 'B')).toBe('Merging A into B …')
    expect(S.keepCountdownLead('B')).toBe('Keeping B in')
  })
})
