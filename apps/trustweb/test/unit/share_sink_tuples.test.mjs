// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 23: the relation store as JSONL (share_sink/tuples.ts, export.ts toJsonl). */
import { isLive, parseJsonl } from '../../src/share_sink/tuples.ts'
import { toJsonl } from '../../src/share_sink/export.ts'
import { JSONL, NOW } from '../helpers/share_sink_store.mjs'

describe('share sink: tuples', () => {
  it('parses JSONL and writes it back byte for byte', () => {
    const store = parseJsonl(JSONL)
    expect(store).toHaveLength(13)
    expect(store[0]).toEqual({ subject: 'person:ada', relation: 'in_zone', object: 'zone:community', since: '2026-01-01T00:00:00.000Z', by: 'device:laptop' })
    expect(toJsonl(store)).toBe(JSONL)
  })
  it('keeps the optional zone, tag and until fields through a round trip', () => {
    const t = { subject: 'person:a', relation: 'grants', object: 'item:x', zone: 'friend', tag: 'tag:t', since: '2026-01-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z', by: 'device:d' }
    expect(parseJsonl(toJsonl([t]))).toEqual([t])
  })
  it('skips blank lines and refuses a bad line with its number', () => {
    expect(parseJsonl('\n' + JSONL + '\n\n')).toHaveLength(13)
    expect(() => parseJsonl('{"subject":"person:a","relation":"owns","object":"item:x","since":"2026-01-01T00:00:00.000Z","by":"d"}')).toThrow(/line 1/)
    expect(() => parseJsonl('{"subject":"person:a"}')).toThrow(/line 1/)
    expect(() => parseJsonl('not json')).toThrow(/line 1/)
    expect(() => parseJsonl('{"subject":"person:a","relation":"in_zone","object":"zone:x","since":"2026-01-01T00:00:00.000Z","by":"d"}')).toThrow(/line 1/)
  })
  it('refuses a zone id that is not on the ladder, a person put in self, and an until that is no date (review)', () => {
    const t = (o) => JSON.stringify({ subject: 'person:a', relation: 'in_zone', object: 'zone:friend', since: '2026-01-01T00:00:00.000Z', by: 'd', ...o })
    expect(parseJsonl(t({}))).toHaveLength(1)
    expect(() => parseJsonl(t({ object: 'friend' }))).toThrow(/line 1/)
    expect(() => parseJsonl(t({ object: 'zone:self' }))).toThrow(/line 1/)
    expect(() => parseJsonl(t({ subject: 'zone:frend', relation: 'may_read', object: 'item:x' }))).toThrow(/line 1/)
    expect(() => parseJsonl(t({ until: 'soon' }))).toThrow(/line 1/)
  })
  it('a tuple is live from since until until', () => {
    const t = { subject: 'person:a', relation: 'may_read', object: 'item:x', since: '2026-01-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z', by: 'd' }
    expect(isLive(t, NOW)).toBe(true)
    expect(isLive(t, new Date('2025-12-31T00:00:00.000Z'))).toBe(false)
    expect(isLive(t, new Date('2027-01-01T00:00:00.000Z'))).toBe(false)
  })
})
