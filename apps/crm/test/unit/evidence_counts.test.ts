// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { parseWhatsApp } from '../../src/import/whatsapp'
import { summarise, summariseAll, type Evidence } from '../../src/import/evidence'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 31)
const ev = (over: Partial<Evidence>): Evidence => ({
  id: 'x', personKey: 'p', source: 'whatsapp' as Evidence['source'], ts: NOW - DAY, dir: 'in', kind: 'msg', ref: 'line:1', ...over,
})

describe('evidence counts', () => {
  it('counts in and out inside the last 365 days, and the last contact', () => {
    const list = [
      ev({ id: 'a', dir: 'in', ts: NOW - 2 * DAY }),
      ev({ id: 'b', dir: 'out', ts: NOW - 3 * DAY }),
      ev({ id: 'c', dir: 'out', ts: NOW - 400 * DAY }),
    ]
    const s = summarise(list, 'p', NOW)
    expect(s.n365).toBe(2)
    expect(s.in).toBe(1)
    expect(s.out).toBe(1)
    expect(s.lastTs).toBe(NOW - 2 * DAY)
    expect(s.ids.sort()).toEqual(['a', 'b'])
  })

  it('ignores other people and future rows', () => {
    const list = [ev({ id: 'a', personKey: 'q' }), ev({ id: 'b', ts: NOW + DAY })]
    expect(summarise(list, 'p', NOW).n365).toBe(0)
  })

  it('no evidence gives an empty summary with no last contact', () => {
    const s = summarise([], 'p', NOW)
    expect(s.n365).toBe(0)
    expect(s.lastTs).toBeUndefined()
  })

  it('summariseAll groups by person', () => {
    const map = summariseAll([ev({ id: 'a', personKey: 'p' }), ev({ id: 'b', personKey: 'q' })], NOW)
    expect(map.get('p')!.n365).toBe(1)
    expect(map.get('q')!.n365).toBe(1)
  })

  it('a WhatsApp chat feeds the counts', () => {
    const chat = '[10.10.24, 09:00:01] Anna: Hi\n[10.10.24, 09:02:00] Ben: Hey'
    const r = parseWhatsApp(chat, '_chat.txt', { me: 'Ben' })
    const s = summarise(r.evidence, r.evidence[0].personKey, Date.UTC(2024, 9, 11))
    expect(s.in).toBe(1)
    expect(s.out).toBe(1)
  })
})

describe('import and scoring make no network call (T10, I1)', () => {
  it('parsing a chat and summarising its evidence never fetches', () => {
    const before = globalThis.fetch
    let calls = 0
    globalThis.fetch = () => { calls++; return Promise.reject(new Error('no network')) }
    try {
      const r = parseWhatsApp('[10.10.24, 09:00:01] Anna: Hi\n[10.10.24, 09:02:00] Ben: Hey', '_chat.txt', { me: 'Ben' })
      summarise(r.evidence, r.evidence[0].personKey, Date.UTC(2024, 9, 11))
    } finally {
      globalThis.fetch = before
    }
    expect(calls).toBe(0)
  })
})
