// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { failRun, finishRun, IDLE_RUN, RUN_LIMIT_MS, startRun, tickRun } from '../../src/import_run'

describe('import run state (a pass never spins forever)', () => {
  it('goes idle -> reading -> ready', () => {
    const r = startRun(1000)
    expect(r).toEqual({ phase: 'reading', since: 1000 })
    expect(finishRun(r)).toEqual({ phase: 'ready', since: 1000 })
  })
  it('a failure keeps its line and a new start clears it', () => {
    const f = failRun(startRun(0), 'bad file')
    expect(f).toMatchObject({ phase: 'failed', error: 'bad file' })
    expect(startRun(5)).toEqual({ phase: 'reading', since: 5 })
  })
  it('a pass that runs past the limit turns into a failure on the next tick', () => {
    const r = startRun(0)
    expect(tickRun(r, RUN_LIMIT_MS - 1)).toBe(r)
    expect(tickRun(r, RUN_LIMIT_MS)).toMatchObject({ phase: 'failed', error: 'timeout' })
  })
  it('tick leaves every other phase alone', () => {
    expect(tickRun(IDLE_RUN, 1e12)).toBe(IDLE_RUN)
    const ready = finishRun(startRun(0))
    expect(tickRun(ready, 1e12)).toBe(ready)
  })
  it('finish and fail ignore a run that is not reading', () => {
    expect(finishRun(IDLE_RUN)).toBe(IDLE_RUN)
    const f = failRun(startRun(0), 'x')
    expect(finishRun(f)).toBe(f)
    expect(failRun(f, 'y')).toBe(f)
  })
})
