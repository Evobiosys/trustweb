// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { makeWorkerScanner } from '../../src/ext/obsidian/obsidian_client.ts'

const file = (text) => ({ name: 'x.md', size: text.length, text: async () => text })
const files = [{ path: 'a.md', file: file('hello a') }, { path: 'b.md', file: file('hello b') }]

let workers
class FakeWorker {
  constructor() { this.terminated = false; workers.push(this) }
  postMessage() { FakeWorker.onPost?.(this) }
  terminate() { this.terminated = true }
}

describe('obsidian_client: the page side of the worker', () => {
  beforeEach(() => { workers = []; FakeWorker.onPost = undefined; globalThis.Worker = FakeWorker })
  afterEach(() => { delete globalThis.Worker })

  it('B20 an unclonable result (messageerror) falls back to the page thread', async () => {
    FakeWorker.onPost = (w) => queueMicrotask(() => w.onmessageerror?.({}))
    const r = await makeWorkerScanner(1000)(files, {})
    expect(r.changed.map((c) => c.path)).toEqual(['a.md', 'b.md'])
    expect(workers[0].terminated).toBe(true)
  })
  it('B20 a worker that goes quiet is ended after the stall time and the scan runs here', async () => {
    const r = await makeWorkerScanner(30)(files, {})
    expect(r.changed).toHaveLength(2)
    expect(workers[0].terminated).toBe(true)
  })
  it('B20 progress keeps the worker alive', async () => {
    FakeWorker.onPost = (w) => { let n = 0; const t = setInterval(() => { w.onmessage?.({ data: { type: 'progress', done: ++n, total: 9 } }); if (n === 5) { clearInterval(t); w.onmessage?.({ data: { type: 'result', result: { changed: [], same: ['a.md'], failed: [] } } }) } }, 15) }
    const r = await makeWorkerScanner(40)(files, {})
    expect(r.same).toEqual(['a.md'])
  })
  it('B20 a message from the worker keeps its real text', async () => {
    FakeWorker.onPost = (w) => queueMicrotask(() => w.onmessage?.({ data: { type: 'error', message: 'Error: needs-https' } }))
    await expect(makeWorkerScanner(1000)(files, {})).rejects.toThrow('needs-https')
    expect(workers[0].terminated).toBe(true)
  })
  it('B6 abort ends the worker at once and rejects', async () => {
    const ctl = new AbortController()
    const p = makeWorkerScanner(1000)(files, {}, undefined, ctl.signal)
    ctl.abort()
    await expect(p).rejects.toThrow()
    expect(workers[0].terminated).toBe(true)
  })
  it('B6 an already aborted signal never starts a worker', async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(makeWorkerScanner(1000)(files, {}, undefined, ctl.signal)).rejects.toThrow()
    expect(workers).toHaveLength(0)
  })
})
