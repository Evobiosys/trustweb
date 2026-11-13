// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 assistant: MCP parity (assistant_providers, assistant_ask, assistant_set_model, remove_person, restore_person). */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assistantTools } from '../../../mcp/src/assistant_tools.ts'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const rec = () => ({
  v: 1, people: [{ id: 'a', name: 'Ada', ring: 'close', metAt: 0, lines: [] }, { id: 'b', name: 'Bo Tester', ring: 'friend', metAt: 0, lines: [] }],
  advanced: {
    ai: { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: 'SECRET-PC24', model: 'qwen3.6:35b' },
    assistant: { providers: { berget: { baseUrl: '', apiKey: 'SECRET-BERGET', model: '' } } },
  },
})
function fixture(write = true, fetchFn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcp-as-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(rec()))
  const by = Object.fromEntries([...recordTools({ file, write, now: () => new Date('2026-11-12T10:00:00Z') }), ...assistantTools({ file, write, fetchFn })].map((t) => [t.name, t]))
  return { by, file, read: () => JSON.parse(readFileSync(file, 'utf8')) }
}
const ok = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } })

describe('assistant MCP tools', () => {
  it('assistant_providers lists the chain in order and never a key', () => {
    const out = fixture().by.assistant_providers.run({})
    expect(out.providers.map((p) => p.id)).toEqual(['berget', 'pc24'])
    expect(out.providers[1].model).toBe('qwen3.6:35b')
    expect(JSON.stringify(out)).not.toMatch(/SECRET/)
  })
  it('assistant_ask walks the chain: Berget 402 -> pc24 answers; the system prompt names the model; no people are sent', async () => {
    const sent = []
    const { by } = fixture(true, async (url, init) => {
      const body = JSON.parse(init.body)
      sent.push({ url, body })
      return url.includes('berget') ? new Response('{}', { status: 402 }) : ok(`I run ${body.model}`)
    })
    const r = await by.assistant_ask.run({ text: 'which model are you running?' })
    expect(r).toEqual({ provider: 'pc24', model: 'qwen3.6:35b', text: 'I run qwen3.6:35b' })
    expect(sent[1].body.messages[0].content).toContain('qwen3.6:35b')
    expect(JSON.stringify(sent)).not.toMatch(/Ada|Bo Tester/)
    expect(sent[1].body.messages[1].content).toBe('which model are you running?')
  })
  it('assistant_ask with all providers failing throws the heads-up text', async () => {
    const { by } = fixture(true, async () => new Response('{}', { status: 401 }))
    await expect(by.assistant_ask.run({ text: 'hi' })).rejects.toThrow(/No AI provider answered \(Berget, pc24 all failed\): Berget: HTTP 401; pc24: HTTP 401/)
  })
  it('assistant_set_model: a provider id prefers it, a model id sets the override, thinking is validated; the record keeps the rest', () => {
    const f = fixture()
    f.by.assistant_set_model.run({ id: 'pc24' })
    expect(f.by.assistant_providers.run({}).providers.map((p) => p.id)).toEqual(['pc24', 'berget'])
    f.by.assistant_set_model.run({ id: 'llama-9', thinking: 'high' })
    expect(f.read().advanced.assistant).toMatchObject({ prefer: 'pc24', model: 'llama-9', thinking: 'high', providers: { berget: { apiKey: 'SECRET-BERGET' } } })
    expect(f.read().advanced.ai.apiKey).toBe('SECRET-PC24')
    expect(() => f.by.assistant_set_model.run({ id: 'x', thinking: 'loud' })).toThrow(/thinking/)
  })
  it('the write tool is absent while writes are off', () => { expect(fixture(false).by.assistant_set_model).toBeUndefined() })
})

describe('remove_person / restore_person', () => {
  it('a tombstone, listed no more; restore puts the person back on the ring they had; the edit stream says delete then restore', () => {
    const f = fixture()
    f.by.remove_person.run({ person: 'Bo Tester' })
    const gone = f.read().people.find((p) => p.id === 'b')
    expect(gone).toMatchObject({ ring: 'none', prevRing: 'friend', deleted_at: '2026-11-12T10:00:00.000Z' })
    expect(f.by.list_people.run({}).map((p) => p.id)).toEqual(['a'])
    f.by.restore_person.run({ person: 'b' })
    expect(f.read().people.find((p) => p.id === 'b')).toMatchObject({ ring: 'friend' })
    expect(f.read().people.find((p) => p.id === 'b').deleted_at).toBeUndefined()
    const lines = readFileSync(path.join(path.dirname(f.file), 'dev-edits.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).kind)
    expect(lines).toEqual(['delete', 'restore'])
  })
  it('restore of someone who is not removed fails', () => { expect(() => fixture().by.restore_person.run({ person: 'a' })).toThrow(/no removed person/) })
})

describe('MCP settings list', () => {
  it('names every new tool, writes flagged', () => {
    const w = Object.fromEntries(MCP_TOOLS.map((t) => [t.name, t.write]))
    expect(w).toMatchObject({ remove_person: true, restore_person: true, assistant_providers: false, assistant_ask: false, assistant_set_model: true })
  })
})
