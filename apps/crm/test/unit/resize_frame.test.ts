import { describe, expect, it } from 'vitest'
import { onResizeFrame } from '../../src/desk'

describe('map resize scheduling', () => {
  const box = (width: number, height: number): { contentRect: { width: number; height: number } } => ({ contentRect: { width, height } })
  const fakeRaf = (): { raf: (f: () => void) => number; flush(): void; pending(): number } => {
    let q: (() => void)[] = []
    return { raf: (f) => q.push(f), flush: () => { const now = q; q = []; now.forEach((f) => f()) }, pending: () => q.length }
  }
  it('never calls synchronously, one pending frame at a time', () => {
    const f = fakeRaf()
    let calls = 0
    const on = onResizeFrame(() => calls++, f.raf)
    on([box(300, 200)]); on([box(310, 200)]); on([box(320, 200)])
    expect(calls).toBe(0)
    expect(f.pending()).toBe(1)
    f.flush()
    expect(calls).toBe(1)
    on([box(330, 200)])
    expect(f.pending()).toBe(1)
    f.flush()
    expect(calls).toBe(2)
  })
  it('ignores zero-size boxes', () => {
    const f = fakeRaf()
    let calls = 0
    const on = onResizeFrame(() => calls++, f.raf)
    on([box(0, 200)]); on([box(300, 0)]); on([])
    expect(f.pending()).toBe(0)
    f.flush()
    expect(calls).toBe(0)
  })
})
