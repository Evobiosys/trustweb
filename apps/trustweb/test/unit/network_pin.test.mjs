// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b zones-network-2: the needle on a pinned dot and the eased unpin (src/network_pin.ts). Pure. */
import { buildGraph } from '../../src/network_graph.ts'
import { EASE_MS, easeOut, needleAt, needleHead, settleTarget, startUnpin, unpinAt } from '../../src/network_pin.ts'

describe('easeOut', () => {
  it('runs 0 -> 1, fast first, never overshoots', () => {
    expect(easeOut(0)).toBe(0); expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
    for (let t = 0; t <= 1; t += 0.05) expect(easeOut(t)).toBeLessThanOrEqual(1)
  })
})

describe('unpin tween', () => {
  const tw = startUnpin({ x: 0, y: 0 }, { x: 100, y: 50 }, 1000)
  it('starts where the dot is: no jump', () => expect(unpinAt(tw, 1000)).toEqual({ x: 0, y: 0, done: false }))
  it('is gradual in between', () => {
    const m = unpinAt(tw, 1000 + EASE_MS / 2)
    expect(m.x).toBeGreaterThan(0); expect(m.x).toBeLessThan(100); expect(m.done).toBe(false)
  })
  it('ends exactly on the target after about 1.5 s', () => {
    expect(EASE_MS).toBe(1500)
    expect(unpinAt(tw, 1000 + EASE_MS)).toEqual({ x: 100, y: 50, done: true })
    expect(unpinAt(tw, 9999).done).toBe(true)
  })
})

describe('needle', () => {
  it('its head sits up and right of the dot', () => {
    const h = needleHead(100, 100, 6)
    expect(h.x).toBeGreaterThan(100); expect(h.y).toBeLessThan(100)
  })
  it('a press on the head finds the node; far away finds none; the nearest head wins', () => {
    const h = needleHead(100, 100, 6)
    const pins = [{ id: 'a', x: 100, y: 100, r: 6 }, { id: 'b', x: 300, y: 100, r: 6 }]
    expect(needleAt(pins, h.x + 3, h.y - 2)).toBe('a')
    expect(needleAt(pins, 200, 200)).toBeNull()
  })
})

describe('settleTarget', () => {
  it('a dot dragged far away settles back near its ring distance from me', () => {
    const me = { id: 'me', displayName: 'Me' }
    const people = [{ id: 'a', name: 'a', context: '', ring: 'friend', lines: [] }, { id: 'b', name: 'b', context: '', ring: 'friend', lines: [] }]
    const g = buildGraph(me, people)
    const v = g.nodes[1]
    v.x = 900; v.y = 900
    const t = settleTarget(g, 1)
    expect(Math.hypot(t.x, t.y)).toBeLessThan(250)
    expect(v.x).toBe(900)
  })
})

describe('only-connected-with-me toggle label', async () => {
  const { S } = await import('../../src/strings.ts')
  it('reads Show / Hide only connected with me', () => {
    expect(S.netShowOthers).toBe('Show only connected with me')
    expect(S.netHideOthers).toBe('Hide only connected with me')
  })
})
