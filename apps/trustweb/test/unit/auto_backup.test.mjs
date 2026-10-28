/** Automatic encrypted backup (src/auto_backup.ts): when it runs, when it must not, and what it persists. */
import { AUTO_DEBOUNCE_MS, AUTO_MAX_BACKOFF_MS, AUTO_MIN_GAP_MS, createAutoBackup, loadInfo, saveInfo, autoOn } from '../../src/auto_backup.ts'

const MIN = 60_000

/** A fake clock with timers, a fake store and a fake backup function. */
function rig(over = {}) {
  let t = 1_000_000
  let seq = 0
  const timers = new Map()
  const info = { keyText: 'TW1R-x', fromPassphrase: false, lastAt: 0, lastBytes: 0, auto: true, ...over.info }
  const calls = []
  const r = {
    info, calls, fail: false, online: true, hash: 'h1', hold: null,
    tick(ms) {
      const end = t + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0]); t = Math.max(t, due[1].at); due[1].fn()
      }
      t = end
      return flush()
    },
  }
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  r.flush = flush
  r.ab = createAutoBackup({
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id },
    clearTimer: (id) => { timers.delete(id) },
    enabled: () => autoOn(r.info),
    online: () => r.online,
    fingerprint: async () => r.hash,
    lastHash: () => r.info.lastHash ?? null,
    lastAt: () => r.info.lastAt,
    backup: async (hash) => {
      calls.push({ at: t, hash })
      if (r.hold) await r.hold
      if (r.fail) throw new Error('down')
      r.info.lastAt = t; r.info.lastHash = hash; r.info.lastBytes = 10
    },
    onStatus: () => {},
    ...over.deps,
  })
  r.timers = timers
  return r
}

describe('auto backup triggers', () => {
  it('waits 2 minutes after the last change (debounce), then backs up once', async () => {
    const r = rig()
    r.ab.changed(); await r.tick(AUTO_DEBOUNCE_MS - 1000)
    r.ab.changed() // restarts the wait
    await r.tick(AUTO_DEBOUNCE_MS - 1000)
    expect(r.calls).toHaveLength(0)
    await r.tick(1500)
    expect(r.calls).toHaveLength(1)
  })
  it('keeps a minimum gap of 5 minutes after the last backup', async () => {
    const r = rig()
    r.ab.changed(); await r.tick(AUTO_DEBOUNCE_MS + 10)
    expect(r.calls).toHaveLength(1)
    r.hash = 'h2'; r.ab.changed(); await r.tick(AUTO_DEBOUNCE_MS + 10)
    expect(r.calls).toHaveLength(1) // 2 min after: still inside the gap
    await r.tick(AUTO_MIN_GAP_MS)
    expect(r.calls).toHaveLength(2)
  })
  it('backs up at once when the app is hidden and something changed', async () => {
    const r = rig()
    r.ab.changed(); r.ab.hidden(); await r.flush()
    expect(r.calls).toHaveLength(1)
  })
  it('hidden with nothing changed does nothing', async () => {
    const r = rig(); r.ab.hidden(); await r.flush()
    expect(r.calls).toHaveLength(0)
  })
  it('offline: waits, and backs up when it is back online', async () => {
    const r = rig(); r.online = false
    r.ab.changed(); await r.tick(AUTO_DEBOUNCE_MS + 10)
    expect(r.calls).toHaveLength(0)
    r.online = true; r.ab.backOnline(); await r.flush()
    expect(r.calls).toHaveLength(1)
  })
})

describe('auto backup guards', () => {
  it('no key (no BackupInfo): never runs', async () => {
    const r = rig(); r.info.keyText = ''
    r.ab.changed(); r.ab.hidden(); r.ab.backOnline(); await r.tick(AUTO_DEBOUNCE_MS * 5)
    expect(r.calls).toHaveLength(0)
    expect(autoOn(null)).toBe(false)
  })
  it('switch off: never runs; legacy info without the flag counts as off', async () => {
    const r = rig({ info: { auto: false } })
    r.ab.changed(); r.ab.hidden(); await r.tick(AUTO_DEBOUNCE_MS * 5)
    expect(r.calls).toHaveLength(0)
    expect(autoOn({ keyText: 'k' })).toBe(false)
    expect(autoOn({ keyText: 'k', auto: true })).toBe(true)
  })
  it('skips when the sealed input is unchanged since the last backup', async () => {
    const r = rig({ info: { lastHash: 'h1' } })
    r.ab.changed(); await r.tick(AUTO_DEBOUNCE_MS + 10)
    expect(r.calls).toHaveLength(0)
  })
  it('never two at once', async () => {
    let release
    const r = rig(); r.hold = new Promise((res) => { release = res })
    r.ab.changed(); r.ab.hidden(); await r.flush()
    r.ab.hidden(); r.ab.backOnline(); await r.flush()
    expect(r.calls).toHaveLength(1)
    release(); await r.flush()
    expect(r.calls).toHaveLength(1)
  })
  it('a change during a running backup is backed up afterwards', async () => {
    let release
    const r = rig(); r.hold = new Promise((res) => { release = res })
    r.ab.changed(); r.ab.hidden(); await r.flush()
    r.hash = 'h2'; r.ab.changed(); release(); r.hold = null; await r.flush()
    await r.tick(AUTO_MIN_GAP_MS + AUTO_DEBOUNCE_MS)
    expect(r.calls.map((c) => c.hash)).toEqual(['h1', 'h2'])
  })
})

describe('auto backup failure', () => {
  it('backs off exponentially up to 1 hour and reports the next try', async () => {
    const r = rig(); r.fail = true
    const seen = []
    r.ab.changed(); r.ab.hidden(); await r.flush()
    seen.push(r.calls.length)
    const first = r.ab.status().retryAt
    expect(first).toBeGreaterThan(0)
    // each retry waits longer than the one before, and none longer than the cap
    let prevWait = first - r.calls[0].at
    for (let i = 1; i < 8; i++) {
      await r.tick(Math.max(0, r.ab.status().retryAt - r.calls[r.calls.length - 1].at) + 1)
      expect(r.calls).toHaveLength(i + 1)
      const wait = r.ab.status().retryAt - r.calls[i].at
      expect(wait).toBeGreaterThanOrEqual(prevWait)
      expect(wait).toBeLessThanOrEqual(AUTO_MAX_BACKOFF_MS)
      prevWait = wait
    }
    expect(prevWait).toBe(AUTO_MAX_BACKOFF_MS)
  })
  it('a success clears the failure state', async () => {
    const r = rig(); r.fail = true
    r.ab.changed(); r.ab.hidden(); await r.flush()
    expect(r.ab.status().retryAt).not.toBeNull()
    r.fail = false; await r.tick(10 * MIN)
    expect(r.calls).toHaveLength(2)
    expect(r.ab.status().retryAt).toBeNull()
  })
  it('coming back online retries a failed backup at once', async () => {
    const r = rig(); r.fail = true
    r.ab.changed(); r.ab.hidden(); await r.flush()
    r.fail = false; r.ab.backOnline(); await r.flush()
    expect(r.calls).toHaveLength(2)
  })
})

describe('auto backup toggle persistence', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
  it('saves and loads the info with its switch and hash; null removes it', () => {
    const s = mem()
    expect(loadInfo(s, 'k')).toBeNull()
    saveInfo(s, 'k', { keyText: 'TW1R-x', fromPassphrase: true, lastAt: 5, lastBytes: 6, auto: false, lastHash: 'abc' })
    expect(loadInfo(s, 'k')).toMatchObject({ auto: false, lastHash: 'abc', fromPassphrase: true })
    saveInfo(s, 'k', { ...loadInfo(s, 'k'), auto: true })
    expect(autoOn(loadInfo(s, 'k'))).toBe(true)
    saveInfo(s, 'k', null)
    expect(loadInfo(s, 'k')).toBeNull()
  })
  it('survives corrupt storage', () => {
    const s = mem(); s.setItem('k', '{nope')
    expect(loadInfo(s, 'k')).toBeNull()
  })
})
