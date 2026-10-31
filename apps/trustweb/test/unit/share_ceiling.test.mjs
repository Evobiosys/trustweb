// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: an agent may assign shares up to Close (D2); above it needs a tap; every agent decision is logged (I6). */
import { AGENT_SHARE_CEILING, clampAgentShare, assignByAgent } from '../../src/share_sink/ceiling.ts'
import { LADDER, Zone, rank } from '../../src/share_sink/zones.ts'
import { parseJsonl } from '../../src/share_sink/tuples.ts'
import { NOW } from '../helpers/share_sink_store.mjs'

const WHEN = new Date(NOW)
const input = (zone, over = {}) => ({ agentId: 'scout', personId: 'person:ada', itemId: 'item:bike', zone, reason: 'met at the bike swap', credence: 0.82, now: WHEN, by: 'device:laptop', ...over })

describe('agent ceiling (T6, T7)', () => {
  it('the ceiling is Close', () => {
    expect(AGENT_SHARE_CEILING).toBe(Zone.Close)
  })
  it('up to Close is assigned without a tap; Closest and Self need one', () => {
    expect(clampAgentShare(Zone.Friend)).toEqual({ allowed: true, needsTap: false })
    expect(clampAgentShare(Zone.Close)).toEqual({ allowed: true, needsTap: false })
    expect(clampAgentShare(Zone.Closest).needsTap).toBe(true)
    expect(clampAgentShare(Zone.Self).needsTap).toBe(true)
  })
  it('T6: no zone the agent may assign without a tap is at or below Close', () => {
    for (const z of LADDER) {
      if (!clampAgentShare(z).needsTap) expect(rank(z) <= rank(Zone.Close)).toBe(true)
    }
  })
  it('T7: a Closest assignment writes no tuple until the owner taps', () => {
    const store = parseJsonl('')
    const r = assignByAgent(store, input(Zone.Closest))
    expect(r.needsTap).toBe(true)
    expect(r.store.length).toBe(0)
    expect(r.log.outcome).toBe('proposed')
  })
  it('an assignment within the ceiling writes one zone tuple, until one year on (I9)', () => {
    const r = assignByAgent([], input(Zone.Friend))
    expect(r.needsTap).toBe(false)
    expect(r.store).toEqual([{ subject: 'zone:friend', relation: 'may_read', object: 'item:bike', since: NOW.toISOString(), until: new Date(+WHEN + 365 * 86_400_000).toISOString(), by: 'device:laptop' }])
  })
})

describe('every agent decision is logged (T13, I6)', () => {
  it('each assignment yields one readable log line with by, reason and credence', () => {
    const r = assignByAgent([], input(Zone.Friend))
    expect(r.log.by).toBe('agent:scout')
    expect(r.log.reason).toBe('met at the bike swap')
    expect(r.log.credence).toBe(0.82)
    expect(r.log.text).toContain('agent:scout')
    expect(r.log.text).toContain('zone:friend')
    expect(r.log.text).toContain('met at the bike swap')
    expect(r.log.text.includes('\n')).toBe(false)
  })
  it('a proposal is logged too', () => {
    const r = assignByAgent([], input(Zone.Self))
    expect(r.log.outcome).toBe('proposed')
    expect(r.log.text).toContain('proposed')
  })
})
