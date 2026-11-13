// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 signup-stripe, MCP parity (P02): billing_plans, billing_status, billing_checkout_link over a synthetic record and a fake server. */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { billingTools } from '../../../mcp/src/billing_tools.ts'

const fixture = (record = { v: 1, people: [] }, over = {}) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-mcp-bill-')), 'record.json')
  writeFileSync(file, JSON.stringify(record))
  const calls = []
  const fetchImpl = over.fetchImpl ?? (async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => (url.includes('/status') ? { state: 'active', plan: 'friends' } : { ref: 'TW-ABC234', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) } })
  const tools = billingTools({ file, write: over.write ?? true, apiBase: 'https://app.example', fetchImpl })
  return { file, calls, by: Object.fromEntries(tools.map((t) => [t.name, t])), tools }
}

describe('billing tools', () => {
  it('with writes off only the two read tools exist', () => {
    expect(fixture(undefined, { write: false }).tools.map((t) => t.name)).toEqual(['billing_plans', 'billing_status'])
    expect(fixture().tools.map((t) => t.name)).toEqual(['billing_plans', 'billing_status', 'billing_checkout_link'])
  })

  it('billing_plans: the three plans with prices and the Friends note', () => {
    const plans = fixture().by.billing_plans.run({})
    expect(plans.map((p) => [p.id, p.euroPerMonth])).toEqual([['regular', 20], ['friends', 15], ['own', 0]])
    expect(plans[1].note).toMatch(/3 months/)
  })

  it('billing_status: none before a sign-up', async () => {
    expect(await fixture().by.billing_status.run({})).toEqual({ state: 'none' })
  })

  it('billing_checkout_link: asks the server, keeps the sign-up in the record, returns the url and ref but not the claim', async () => {
    const f = fixture()
    const out = await f.by.billing_checkout_link.run({ plan: 'friends', email: 'anna@example.org' })
    expect(out).toEqual({ ref: 'TW-ABC234', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    expect(f.calls[0].url).toBe('https://app.example/api/billing/checkout')
    const bill = JSON.parse(readFileSync(f.file, 'utf8')).advanced.ai.bill
    expect(bill).toMatchObject({ plan: 'friends', ref: 'TW-ABC234', email: 'anna@example.org', state: 'pending' })
    expect(bill.claim).toHaveLength(43)
    expect(JSON.stringify(out)).not.toContain(bill.claim)
  })

  it('billing_status after a sign-up reads the server and keeps the new state', async () => {
    const f = fixture()
    await f.by.billing_checkout_link.run({ plan: 'regular', email: 'anna@example.org' })
    expect(await f.by.billing_status.run({})).toEqual({ state: 'active', plan: 'friends', ref: 'TW-ABC234' })
    expect(JSON.parse(readFileSync(f.file, 'utf8')).advanced.ai.bill.state).toBe('active')
  })

  it('rejects own keys (free), a bad plan and a bad email; nothing is written', async () => {
    const f = fixture()
    for (const a of [{ plan: 'own', email: 'a@b.de' }, { plan: 'gold', email: 'a@b.de' }, { plan: 'friends', email: 'nope' }, { plan: 'friends' }]) {
      await expect(f.by.billing_checkout_link.run(a)).rejects.toThrow()
    }
    expect(f.calls).toHaveLength(0)
    expect(JSON.parse(readFileSync(f.file, 'utf8')).advanced).toBeUndefined()
  })

  it('a server error reaches the caller and leaves the record alone', async () => {
    const f = fixture(undefined, { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ message: 'This feature is not switched on.' }) }) })
    await expect(f.by.billing_checkout_link.run({ plan: 'friends', email: 'a@b.de' })).rejects.toThrow('This feature is not switched on.')
    expect(JSON.parse(readFileSync(f.file, 'utf8')).advanced).toBeUndefined()
  })

  it('keeps an AI endpoint the person already set', async () => {
    const f = fixture({ v: 1, people: [], advanced: { ai: { preset: 'custom', baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' } } })
    await f.by.billing_checkout_link.run({ plan: 'friends', email: 'a@b.de' })
    const ai = JSON.parse(readFileSync(f.file, 'utf8')).advanced.ai
    expect(ai).toMatchObject({ preset: 'custom', baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' })
    expect(ai.bill.ref).toBe('TW-ABC234')
  })
})

describe('server wiring', () => {
  it('the stdio server lists the billing tools (writes on) and answers billing_plans', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-mcp-bill-')), 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, people: [] }))
    const child = spawn(process.execPath, [path.resolve('../mcp/src/server.ts')], { env: { ...process.env, TW_RECORD: file, TW_MCP_WRITE: '1' } })
    const lines = []
    child.stdout.on('data', (d) => lines.push(...String(d).split('\n').filter(Boolean)))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'billing_plans', arguments: {} } }) + '\n')
    for (let i = 0; i < 100 && lines.length < 2; i += 1) await new Promise((r) => setTimeout(r, 50))
    child.kill()
    const names = JSON.parse(lines[0]).result.tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['billing_plans', 'billing_status', 'billing_checkout_link', 'list_people']))
    expect(JSON.parse(JSON.parse(lines[1]).result.content[0].text)).toHaveLength(3)
  })
})
