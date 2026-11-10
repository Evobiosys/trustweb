// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { createIngest } from '../../src/ext/obsidian/obsidian_run.ts'
import { planBatches } from '../../src/ext/obsidian/obsidian_ingest.ts'

const paths = Array.from({ length: 6 }, (_, i) => `N/n${i}.md`)
const TEXT = Object.fromEntries(paths.map((p, i) => [p, `Note ${i}: ${'about Person' + i + ' '.repeat(1)}`.padEnd(100, '.')]))
const batches = () => planBatches(paths.map((path) => ({ path, chars: 100 })), { maxNotes: 2 })   // 3 batches
const replyFor = (user) => ({ people: [...user.matchAll(/### FILE: (\S+)\nNote (\d)/g)].map((m) => ({ name: `Person Number${m[2]}`, facts: [`seen in ${m[1]}`], source: m[1] })) })
const base = (over = {}) => ({ batches: batches(), load: async (p) => TEXT[p], ask: async (_s, user) => replyFor(user), ...over })

describe('createIngest', () => {
  it('runs every batch, validates and merges the replies', async () => {
    const calls = []
    const r = await createIngest(base({ ask: async (s, u) => { calls.push(u); return replyFor(u) } })).run()
    expect(r.status).toBe('done')
    expect(calls).toHaveLength(3)
    expect(r.people.map((p) => p.name)).toEqual(paths.map((_, i) => `Person Number${i}`))
    expect(r.donePaths).toEqual(paths)
    expect(r.failed).toEqual([])
  })
  it('without an endpoint nothing is read and nothing is sent', async () => {
    let loads = 0
    const r = await createIngest(base({ ask: null, load: async () => { loads++; return 'x' } })).run()
    expect(r.status).toBe('no-endpoint')
    expect(loads).toBe(0)
  })
  it('a failing or invalid reply is tried once more; then the batch is marked failed and the run goes on', async () => {
    let n = 0
    const r = await createIngest(base({ ask: async (_s, u) => { n++; if (u.includes('n0.md')) throw new Error('boom'); if (u.includes('n2.md')) return { nope: 1 }; return replyFor(u) } })).run()
    expect(r.status).toBe('done')
    expect(n).toBe(5)   // batch 1: 2 tries, batch 2: 2 tries, batch 3: 1
    expect(r.failed).toEqual(['N/n0.md', 'N/n1.md', 'N/n2.md', 'N/n3.md'])
    expect(r.donePaths).toEqual(['N/n4.md', 'N/n5.md'])
    expect(r.people.map((p) => p.name)).toEqual(['Person Number4', 'Person Number5'])
  })
  it('a note that cannot be read is left out of the call', async () => {
    const seen = []
    await createIngest(base({ load: async (p) => (p === 'N/n1.md' ? null : TEXT[p]), ask: async (_s, u) => { seen.push(u); return { people: [] } } })).run()
    expect(seen.join('')).not.toContain('N/n1.md')
  })
  it('progress after every batch: percent rises to 100, time left shown from the second batch on', async () => {
    const seen = []
    let t = 0
    await createIngest(base({ now: () => (t += 1000), onProgress: (p) => seen.push(p) })).run()
    expect(seen.map((p) => p.pct)).toEqual([33, 67, 100])
    expect(seen[0].etaMs).toBeGreaterThan(0)
    expect(seen.at(-1).etaMs).toBe(0)
  })
  it('pause waits (no call while paused), resume goes on', async () => {
    let ctl
    const asked = []
    ctl = createIngest(base({ ask: async (_s, u) => { asked.push(u); if (asked.length === 1) ctl.pause(); return replyFor(u) } }))
    const run = ctl.run()
    await new Promise((r) => setTimeout(r, 30))
    expect(asked).toHaveLength(1)
    expect(ctl.state()).toBe('paused')
    ctl.resume()
    const r = await run
    expect(asked).toHaveLength(3)
    expect(r.status).toBe('done')
  })
  it('stop ends the run at once with what is there so far', async () => {
    let ctl
    ctl = createIngest(base({ ask: async (_s, u) => { ctl.stop(); return replyFor(u) } }))
    const r = await ctl.run()
    expect(r.status).toBe('stopped')
    expect(r.donePaths).toEqual(['N/n0.md', 'N/n1.md'])
    expect(r.people).toHaveLength(2)
  })
  it('a stop while paused also ends it', async () => {
    let ctl
    ctl = createIngest(base({ ask: async (_s, u) => { ctl.pause(); return replyFor(u) } }))
    const run = ctl.run()
    await new Promise((r) => setTimeout(r, 20))
    ctl.stop()
    expect((await run).status).toBe('stopped')
  })
  it('after every batch the people and done notes so far are handed out (to be kept for a later resume)', async () => {
    const snaps = []
    await createIngest(base({ onBatch: (x) => snaps.push([x.people.length, x.donePaths.length]) })).run()
    expect(snaps).toEqual([[2, 2], [4, 4], [6, 6]])
  })
  it('an earlier run carries on: its people and done notes are kept', async () => {
    const earlier = { people: [{ name: 'Person Number0', aliases: [], facts: ['old'], relations: [], sources: ['N/n0.md'] }], donePaths: ['N/n0.md', 'N/n1.md'] }
    const asked = []
    const r = await createIngest(base({ batches: planBatches(paths.map((path) => ({ path, chars: 100 })), { maxNotes: 2, skip: new Set(earlier.donePaths) }), resume: earlier, ask: async (_s, u) => { asked.push(u); return replyFor(u) } })).run()
    expect(asked).toHaveLength(2)
    expect(r.donePaths).toEqual(paths)
    expect(r.people[0].facts).toEqual(['old'])
  })
})
