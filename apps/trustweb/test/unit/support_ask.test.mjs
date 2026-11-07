// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32: "Ask for support" (src/support_ask.ts): audience rule, chips, window, close, the two texts, the emergency line. */
import {
  SUPPORT_CHIPS, SupportWindow, audienceRings, audiencePeople, buildSupport, closeAt, emergencyNumber, isOpen, isSupportText,
  hereText, parseHereText, AskMode, ASK_MODES, nextAskMode, parseSupportText, supportText, recordHere, openAsks,
} from '../../src/support_ask.ts'
import { Ring } from '../../src/model.ts'
import { routeText, TextKind } from '../../src/chat.ts'

const APP = 'https://app.example.test/'
const NOW = new Date(2026, 10, 5, 11, 30).getTime()
const p = (id, ring, extra = {}) => ({ id, name: id, ring, peerId: 'peer-' + id, fields: {}, ...extra })

describe('audience: never wider than Friends', () => {
  it('Closest few is the default and the narrowest; Close adds close friends; Friends is the widest', () => {
    expect(audienceRings(undefined)).toEqual([Ring.Closest])
    expect(audienceRings(Ring.Closest)).toEqual([Ring.Closest])
    expect(audienceRings(Ring.Close)).toEqual([Ring.Closest, Ring.Close])
    expect(audienceRings(Ring.Friend)).toEqual([Ring.Closest, Ring.Close, Ring.Friend])
  })

  it('a wider ring falls back to the default instead of widening', () => {
    expect(audienceRings(Ring.Acquaintance)).toEqual([Ring.Closest])
    expect(audienceRings('everyone')).toEqual([Ring.Closest])
  })

  it('picks only connected people on those rings; family counts by its closeness', () => {
    const people = [
      p('a', Ring.Closest), p('b', Ring.Close), p('c', Ring.Friend), p('d', Ring.Acquaintance),
      { id: 'e', name: 'e', ring: Ring.Closest, fields: {} },
      p('f', Ring.Family, { fields: { 'tw-closeness': Ring.Closest } }),
    ]
    expect(audiencePeople(people, Ring.Closest).map((x) => x.id)).toEqual(['a', 'f'])
    expect(audiencePeople(people, Ring.Friend).map((x) => x.id)).toEqual(['a', 'b', 'c', 'f'])
  })
})

describe('window and close', () => {
  it('today ends at the next local midnight, this week seven days after now', () => {
    const end = new Date(closeAt(NOW, SupportWindow.Today))
    expect([end.getHours(), end.getMinutes(), end.getDate()]).toEqual([0, 0, 6])
    expect(closeAt(NOW, SupportWindow.Week)).toBe(NOW + 7 * 86_400_000)
  })

  it('an ask is open until its end and closes itself after', () => {
    const a = { id: 'x', until: NOW + 1000 }
    expect(isOpen(a, NOW)).toBe(true)
    expect(isOpen(a, NOW + 1000)).toBe(false)
  })
})

describe('building an ask', () => {
  it('keeps only known chips once each, trims the line, and closes by the window', () => {
    const a = buildSupport({ chips: ['listen', 'listen', 'bogus', 'call'], note: '  hard day  ', window: SupportWindow.Today, ids: ['p1', 'p2'] }, NOW, 'id1')
    expect(a.chips).toEqual(['listen', 'call'])
    expect(a.note).toBe('hard day')
    expect(a.to).toEqual(['p1', 'p2'])
    expect(a.here).toEqual([])
    expect(a.until).toBe(closeAt(NOW, SupportWindow.Today))
  })

  it('lists the six chips in the briefed order', () => {
    expect(SUPPORT_CHIPS).toEqual(['listen', 'call', 'meet', 'sit', 'practical', 'know'])
  })
})

describe('the texts', () => {
  const sent = { id: 'id1', chips: ['listen'], note: 'hi', until: NOW + 5000 }

  it('an ask round-trips and routes as support, never as chat', () => {
    const t = supportText(APP, sent)
    expect(isSupportText(APP, t)).toBe(true)
    expect(parseSupportText(APP, t)).toEqual(sent)
    expect(routeText(APP, t)).toBe(TextKind.Support)
  })

  it('malformed or lookalike support text is ignored, shown nowhere', () => {
    for (const t of [`${APP}?support=%7Bnope`, `${APP}?support=${encodeURIComponent('{"id":1}')}`, `${APP}?support-here=`]) {
      expect(parseSupportText(APP, t)).toBeNull()
      expect(routeText(APP, t)).toBe(TextKind.Ignore)
    }
  })

  it('unknown chips are dropped on receipt', () => {
    const t = `${APP}?support=${encodeURIComponent(JSON.stringify({ ...sent, chips: ['listen', 'x'] }))}`
    expect(parseSupportText(APP, t).chips).toEqual(['listen'])
  })

  it('an "I\'m here" round-trips', () => {
    const t = hereText(APP, 'id1')
    expect(parseHereText(APP, t)).toBe('id1')
    expect(routeText(APP, t)).toBe(TextKind.Support)
  })
})

describe('who answered', () => {
  it('records a name once, only from someone the ask went to, only while open', () => {
    const a = { id: 'id1', to: ['p1', 'p2'], here: [], until: NOW + 1000, chips: [], note: '' }
    expect(recordHere([a], 'id1', 'p1', NOW)).toBe(true)
    expect(recordHere([a], 'id1', 'p1', NOW)).toBe(false)
    expect(recordHere([a], 'id1', 'stranger', NOW)).toBe(false)
    expect(recordHere([a], 'id1', 'p2', NOW + 1000)).toBe(false)
    expect(a.here).toEqual(['p1'])
  })

  it('openAsks drops the closed ones', () => {
    expect(openAsks([{ id: 'a', until: NOW + 1 }, { id: 'b', until: NOW - 1 }], NOW).map((x) => x.id)).toEqual(['a'])
    expect(openAsks(undefined, NOW)).toEqual([])
  })
})

describe('the safety line', () => {
  it('names 112 for the EU and when the region is unknown', () => {
    expect(emergencyNumber('de-AT')).toBe('112')
    expect(emergencyNumber('en')).toBe('112')
    expect(emergencyNumber(undefined)).toBe('112')
  })
  it('names the local number where it is known', () => {
    expect(emergencyNumber('en-US')).toBe('911')
    expect(emergencyNumber('en-GB')).toBe('999')
  })
})

describe('ask dock mode: Ask your web | Ask for support', () => {
  it('offers the three modes: support, hints, intros', () => {
    expect(ASK_MODES).toEqual([AskMode.Support, AskMode.Hints, AskMode.Intros])
  })
  it('an unknown or missing mode falls back to hints', () => {
    expect(nextAskMode(undefined)).toBe(AskMode.Hints)
    expect(nextAskMode('web')).toBe(AskMode.Hints)
    expect(nextAskMode('support')).toBe(AskMode.Support)
    expect(nextAskMode('intros')).toBe(AskMode.Intros)
  })
})
