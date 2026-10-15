import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { connect, pull } from '../../scripts/tana_pull_persons.mjs'

const index = [{ id: 'a1', created: '2025-01-01' }, { id: 'b2', created: '2025-02-01', edited: '2026-01-01' }, { id: 'c3', created: '2025-03-01' }]

function fakeFetch(calls: { method: string; params: { name?: string; arguments?: { nodeId?: string } } }[], bad: string[] = []): typeof fetch {
  return (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    const id = body.params?.arguments?.nodeId
    const result = body.method === 'tools/call' ? { content: [{ text: `- node ${id} fresh` }], ...(bad.includes(id) ? { isError: true } : {}) } : {}
    return { ok: true, headers: { get: () => 'sess' }, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) }
  }) as unknown as typeof fetch
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'twpull-'))
  const indexPath = path.join(dir, 'persons-index.json')
  const nodesPath = path.join(dir, 'persons-nodes.json')
  writeFileSync(indexPath, JSON.stringify(index))
  writeFileSync(nodesPath, JSON.stringify({ a1: 'old a1', c3: 'old c3', z9: 'kept' }))
  return { dir, indexPath, nodesPath }
}

describe('tana pull', () => {
  it('speaks initialize, initialized, then tools/call read_node per node', async () => {
    const calls: Parameters<typeof fakeFetch>[0] = []
    const { call } = await connect('t', fakeFetch(calls))
    await call('read_node', { nodeId: 'a1' })
    expect(calls.map((c) => c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
  })

  it('rewrites atomically with a backup, keeps unreadable and unknown entries', async () => {
    const { dir, indexPath, nodesPath } = setup()
    const calls: Parameters<typeof fakeFetch>[0] = []
    const { call } = await connect('t', fakeFetch(calls, ['c3']))
    const r = await pull({ indexPath, nodesPath, call, pause: 0 })
    expect(r.failed).toEqual(['c3'])
    expect(JSON.parse(readFileSync(nodesPath, 'utf8'))).toEqual({ a1: '- node a1 fresh', b2: '- node b2 fresh', c3: 'old c3', z9: 'kept' })
    const files = readdirSync(dir)
    expect(files.some((f) => f.startsWith('persons-nodes.json.bak.'))).toBe(true)
    expect(files.some((f) => f.endsWith('.tmp') || f.endsWith('.pull-progress.json'))).toBe(false)
  })

  it('--only reads just those nodes; --since filters on edited else created', async () => {
    const { indexPath, nodesPath } = setup()
    const calls: Parameters<typeof fakeFetch>[0] = []
    const { call } = await connect('t', fakeFetch(calls))
    await pull({ indexPath, nodesPath, call, only: ['a1'], pause: 0 })
    await pull({ indexPath, nodesPath, call, since: '2025-12-01', pause: 0 })
    const read = calls.filter((c) => c.method === 'tools/call').map((c) => c.params.arguments?.nodeId)
    expect(read).toEqual(['a1', 'b2'])
  })

  it('resumes from the progress file', async () => {
    const { indexPath, nodesPath } = setup()
    writeFileSync(`${nodesPath}.pull-progress.json`, JSON.stringify({ at: Date.now(), nodes: { a1: 'done before' } }))
    const calls: Parameters<typeof fakeFetch>[0] = []
    const { call } = await connect('t', fakeFetch(calls))
    const r = await pull({ indexPath, nodesPath, call, pause: 0 })
    expect(r.resumed).toBe(1)
    expect(calls.filter((c) => c.method === 'tools/call')).toHaveLength(2)
    expect(JSON.parse(readFileSync(nodesPath, 'utf8')).a1).toBe('done before')
    expect(existsSync(`${nodesPath}.pull-progress.json`)).toBe(false)
  })
})
