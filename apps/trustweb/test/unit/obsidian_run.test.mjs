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

import { claimRun, resumable } from '../../src/ext/obsidian/obsidian_run.ts'
import { createMerger, mergePeople } from '../../src/ext/obsidian/obsidian_ingest.ts'

describe('B5 Stop aborts the request in flight and nothing is sent after it', () => {
  it('stop() aborts the signal given to ask and does not try a second time', async () => {
    let ctl
    const signals = []
    let n = 0
    ctl = createIngest(base({ ask: async (_s, _u, signal) => {
      n++; signals.push(signal)
      ctl.stop()
      expect(signal.aborted).toBe(true)
      throw new Error('aborted')
    } }))
    const r = await ctl.run()
    expect(n).toBe(1)
    expect(r.status).toBe('stopped')
    expect(r.failed).toEqual([])
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })
  it('nothing is read or asked once stopped while a note is being loaded', async () => {
    let ctl
    let asks = 0
    ctl = createIngest(base({ load: async (p) => { ctl.stop(); return TEXT[p] }, ask: async () => { asks++; return { people: [] } } }))
    const r = await ctl.run()
    expect(asks).toBe(0)
    expect(r.status).toBe('stopped')
  })
})

describe('B10 one running merge, snapshots not after every batch', () => {
  const p = (name, extra = {}) => ({ name, aliases: [], facts: [], relations: [], sources: ['a.md'], ...extra })
  it('createMerger gives what mergePeople gives, adding list by list', () => {
    const lists = [[p('Ann Lee', { facts: ['a'] }), p('Bo')], [p('ann lee', { facts: ['b'], aliases: ['Annie'] })], [p('Annie', { facts: ['c'] }), p('Cy')]]
    const m = createMerger()
    for (const l of lists) m.add(l)
    expect(m.people()).toEqual(mergePeople(lists))
    expect(m.people().map((x) => x.name)).toEqual(['Ann Lee', 'Bo', 'Cy'])
    expect(m.people()[0].facts).toEqual(['a', 'b', 'c'])
  })
  it('1000 people over 600 batches merge in well under a second', () => {
    const m = createMerger()
    const t0 = performance.now()
    for (let b = 0; b < 600; b++) m.add(Array.from({ length: 5 }, (_, i) => p(`Person ${(b * 5 + i) % 1000} X`)))
    expect(m.people()).toHaveLength(1000)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
  it('onBatch every N batches and once at the end', async () => {
    const snaps = []
    await createIngest(base({ snapshotEvery: 2, onBatch: (x) => snaps.push(x.donePaths.length) })).run()
    expect(snaps).toEqual([4, 6])
  })
  it('onBatch is also called when the run is stopped', async () => {
    let ctl
    const snaps = []
    ctl = createIngest(base({ snapshotEvery: 10, ask: async (_s, u) => { ctl.stop(); return replyFor(u) }, onBatch: (x) => snaps.push(x.donePaths.length) }))
    await ctl.run()
    expect(snaps).toEqual([2])
  })
  it('onBatch is also called on pause', async () => {
    let ctl
    const snaps = []
    ctl = createIngest(base({ snapshotEvery: 10, ask: async (_s, u) => { ctl.pause(); return replyFor(u) }, onBatch: (x) => snaps.push(x.donePaths.length) }))
    const run = ctl.run()
    await new Promise((r) => setTimeout(r, 20))
    expect(snaps).toEqual([2])
    ctl.stop()
    await run
  })
})

describe('B9 an earlier run counts only for the same vault and the same note text', () => {
  const stored = { vault: 'Greenhouse', hashes: { 'a.md': 'h1', 'b.md': 'h2' }, people: [{ name: 'Ann Lee', aliases: [], facts: [], relations: [], sources: ['a.md'] }] }
  it('same vault: done notes are those whose hash is still the same', () => {
    const r = resumable(stored, 'Greenhouse', { 'a.md': 'h1', 'b.md': 'CHANGED', 'c.md': 'h3' })
    expect(r.donePaths).toEqual(['a.md'])
    expect(r.people).toEqual(stored.people)
  })
  it('another vault: dropped', () => {
    expect(resumable(stored, 'Other', { 'a.md': 'h1' })).toBeNull()
  })
  it('an old-format run (no vault, no hashes) or nothing: dropped', () => {
    expect(resumable({ people: stored.people, donePaths: ['a.md'] }, 'Greenhouse', { 'a.md': 'h1' })).toBeNull()
    expect(resumable(undefined, 'Greenhouse', {})).toBeNull()
  })
  it('nothing left to resume: dropped', () => {
    expect(resumable({ vault: 'V', hashes: { 'a.md': 'x' }, people: [] }, 'V', { 'a.md': 'y' })).toBeNull()
  })
})

describe('B7 one run at a time, here and in other tabs', () => {
  const locks = (held = false) => {
    const log = []
    return {
      log,
      request: (name, opts, cb) => { log.push([name, opts]); return held ? Promise.resolve(cb(null)) : Promise.resolve(cb({ name })) },
    }
  }
  it('a second claim is refused until the first is released', async () => {
    const l = locks()
    const release = await claimRun(l)
    expect(release).toBeTypeOf('function')
    expect(l.log[0]).toEqual(['trustweb-obsidian-ingest', { ifAvailable: true }])
    expect(await claimRun(l)).toBeNull()
    release()
    const again = await claimRun(l)
    expect(again).toBeTypeOf('function')
    again()
  })
  it('a lock held by another tab refuses the claim and leaves this tab free', async () => {
    expect(await claimRun(locks(true))).toBeNull()
    const ok = await claimRun(locks())
    expect(ok).toBeTypeOf('function')
    ok()
  })
  it('without navigator.locks the module guard alone holds', async () => {
    const a = await claimRun(undefined)
    expect(await claimRun(undefined)).toBeNull()
    a()
  })
})
