import { UPDATE_GAP_MS, UpdateResult, createUpdateCheck, isNewer, readRelease, reloadFresh } from '../../src/app_update.ts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

describe('readRelease', () => {
  it('reads {release, built_at}', () => {
    expect(readRelease({ release: SHA_A, built_at: '2026-10-28T08:00:00.000Z' })).toEqual({ release: SHA_A, builtAt: '2026-10-28T08:00:00.000Z' })
  })
  it('built_at is optional', () => {
    expect(readRelease({ release: SHA_A })).toEqual({ release: SHA_A, builtAt: '' })
  })
  it('refuses anything else', () => {
    for (const bad of [null, 'x', 42, {}, { release: '' }, { release: 7 }, [SHA_A]]) expect(readRelease(bad)).toBeNull()
  })
})

describe('isNewer', () => {
  it('a different published release is newer', () => expect(isNewer(SHA_A, SHA_B)).toBe(true))
  it('the same release is not', () => expect(isNewer(SHA_A, SHA_A)).toBe(false))
  it('a dev or dirty running build never compares', () => {
    expect(isNewer('dev', SHA_B)).toBe(false)
    expect(isNewer(SHA_A + '-dirty', SHA_B)).toBe(false)
    expect(isNewer('', SHA_B)).toBe(false)
  })
  it('a dev or dirty published release is not offered', () => {
    expect(isNewer(SHA_A, 'dev')).toBe(false)
    expect(isNewer(SHA_A, SHA_B + '-dirty')).toBe(false)
  })
})

function harness(answers, running = SHA_A) {
  let t = 1_000_000
  const calls = { fetch: 0, newer: [] }
  const check = createUpdateCheck({
    running,
    now: () => t,
    fetchLatest: async () => { calls.fetch++; const a = answers.shift(); if (a instanceof Error) throw a; return a },
    onNewer: (info) => calls.newer.push(info.release),
  })
  return { check, calls, tick: (ms) => { t += ms } }
}

describe('createUpdateCheck', () => {
  it('manual check: current / newer / failed', async () => {
    const h = harness([{ release: SHA_A }, { release: SHA_B }, new Error('offline')])
    expect(await h.check.check()).toBe(UpdateResult.Current)
    expect(await h.check.check()).toBe(UpdateResult.Newer)
    expect(h.calls.newer).toEqual([SHA_B])
    expect(await h.check.check()).toBe(UpdateResult.Failed)
  })
  it('an unreadable answer is a failure, not "up to date"', async () => {
    const h = harness([{ nope: 1 }])
    expect(await h.check.check()).toBe(UpdateResult.Failed)
  })
  it('auto checks at most once per 10 minutes', async () => {
    const h = harness([{ release: SHA_A }, { release: SHA_A }, { release: SHA_A }])
    await h.check.auto()
    await h.check.auto()
    expect(h.calls.fetch).toBe(1)
    h.tick(UPDATE_GAP_MS - 1)
    await h.check.auto()
    expect(h.calls.fetch).toBe(1)
    h.tick(1)
    await h.check.auto()
    expect(h.calls.fetch).toBe(2)
  })
  it('a manual check ignores the gap', async () => {
    const h = harness([{ release: SHA_A }, { release: SHA_A }])
    await h.check.auto()
    await h.check.check()
    expect(h.calls.fetch).toBe(2)
  })
  it('the banner hook fires once per newer release, not on every check', async () => {
    const h = harness([{ release: SHA_B }, { release: SHA_B }])
    await h.check.check()
    await h.check.check()
    expect(h.calls.newer).toEqual([SHA_B])
  })
  it('a failed auto check is retried at the next opening, not after 10 minutes', async () => {
    const h = harness([new Error('offline'), { release: SHA_B }])
    await h.check.auto()
    await h.check.auto()
    expect(h.calls.newer).toEqual([SHA_B])
  })
  it('never throws', async () => {
    const h = harness([new Error('x')])
    await expect(h.check.auto()).resolves.toBeUndefined()
  })
})

describe('reloadFresh', () => {
  it('drops every cache, then reloads', async () => {
    const dropped = []
    let reloaded = false
    await reloadFresh({ caches: { keys: async () => ['a', 'b'], delete: async (k) => { dropped.push(k); return true } }, reload: () => { reloaded = true } })
    expect(dropped).toEqual(['a', 'b'])
    expect(reloaded).toBe(true)
  })
  it('reloads without a cache store, and when clearing fails', async () => {
    let n = 0
    await reloadFresh({ reload: () => { n++ } })
    await reloadFresh({ caches: { keys: async () => { throw new Error('x') }, delete: async () => true }, reload: () => { n++ } })
    expect(n).toBe(2)
  })
})
