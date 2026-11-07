// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { jobQueue } from '../../dev_preview_rules.mjs'

const gate = () => { let open; const p = new Promise((r) => { open = r }); return { p, open } }

describe('preview job queue (wave 33 review P1)', () => {
  it('runs jobs one at a time, in order', async () => {
    const g = gate(), log = []
    const q = jobQueue(async (args) => { log.push('start ' + args[0]); if (args[0] === 'a') await g.p; log.push('end ' + args[0]); return null })
    const a = q.run(['a']), b = q.run(['b'])
    await Promise.resolve(); await Promise.resolve()
    expect(log).toEqual(['start a'])
    g.open(); await Promise.all([a, b])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b'])
  })
  it('an identical request still queued or running shares one run instead of piling up', async () => {
    const g = gate(); let runs = 0
    const q = jobQueue(async () => { runs++; await g.p; return null })
    const a = q.run(['verdict', 'x', 'merge']), b = q.run(['verdict', 'x', 'merge']), c = q.run(['verdict', 'y', 'merge'])
    expect(q.size()).toBe(2)
    g.open(); await Promise.all([a, b, c])
    expect(runs).toBe(2)
    expect(q.size()).toBe(0)
  })
  it('an identical request after the first finished runs again; a failure does not poison the queue', async () => {
    let runs = 0
    const q = jobQueue(async () => { runs++; return runs === 1 ? 'boom' : null })
    expect(await q.run(['mode', 'stock'])).toBe('boom')
    expect(await q.run(['mode', 'stock'])).toBe(null)
    expect(runs).toBe(2)
  })
})
