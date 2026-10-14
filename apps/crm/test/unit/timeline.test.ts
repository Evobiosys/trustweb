import { describe, expect, it } from 'vitest'
import { Ring } from '../../../trustweb/src/model'
import { sampleApp, sampleCrm } from '../../src/sample'
import { EventKind, dueFollowUps, lastActivity, personTimeline, timeline, upcomingFollowUps } from '../../src/timeline'
import type { CrmView } from '../../src/model'

const NOW = Date.UTC(2026, 9, 6, 12)
const DAY = 86_400_000
const view = (): CrmView => ({ app: sampleApp(NOW), crm: sampleCrm(NOW) })

describe('timeline', () => {
  it('is newest first and covers every source', () => {
    const t = timeline(view())
    for (let i = 1; i < t.length; i++) expect(t[i - 1].at).toBeGreaterThanOrEqual(t[i].at)
    const kinds = new Set(t.map((e) => e.kind))
    for (const k of Object.values(EventKind)) expect(kinds.has(k), k).toBe(true)
  })

  it('reads met, notes and reviews from TrustWeb lines, never gone ones', () => {
    const v = view()
    const lena = v.app.people.find((p) => p.id === 'p-lena')!
    lena.lines[1] = { ...lena.lines[1], status: 'gone' as never }
    const ev = personTimeline(v, 'p-lena')
    expect(ev.some((e) => e.kind === EventKind.Met && e.at === lena.metAt)).toBe(true)
    expect(ev.filter((e) => e.kind === EventKind.Note).map((e) => e.line!.id)).toEqual(['l-lena-1'])
    const rev = ev.find((e) => e.kind === EventKind.Reviewed)!
    expect(rev.at).toBe(lena.lines[0].checkedAt)
  })

  it('maps peers and asks to the person holding that peerId', () => {
    const ev = personTimeline(view(), 'p-tomas')
    expect(ev.find((e) => e.kind === EventKind.Connected)!.at).toBe(NOW - 120 * DAY)
    expect(ev.find((e) => e.kind === EventKind.Ask)!.log!.id).toBe('g-1')
  })

  it('marks an intending-to-connect person as planned, not met', () => {
    const ev = personTimeline(view(), 'p-noor')
    expect(ev.map((e) => e.kind)).toEqual([EventKind.Planned])
    expect(view().app.people.find((p) => p.id === 'p-noor')!.ring).toBe(Ring.Intending)
  })

  it('ignores log entries without a known peer', () => {
    const v = view()
    v.app.log.push({ id: 'g-x', at: NOW, from: 'Stranger', text: 'anything', outcome: 'no-match' as never })
    expect(timeline(v).some((e) => e.id === 'ask:g-x')).toBe(false)
  })

  it('lastActivity is the newest event, 0 for nobody', () => {
    expect(lastActivity(view(), 'p-lena')).toBe(NOW - 2 * DAY)
    expect(lastActivity(view(), 'nobody')).toBe(0)
  })

  it('splits follow-ups into due and upcoming, done ones in neither', () => {
    const crm = sampleCrm(NOW)
    expect(dueFollowUps(crm, NOW).map((f) => f.id)).toEqual(['f-1'])
    expect(upcomingFollowUps(crm, NOW).map((f) => f.id)).toEqual(['f-2'])
  })
})
