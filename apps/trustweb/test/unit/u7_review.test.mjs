/**
 * Wave 6 review (U7): covers each confirmed finding that was fixed in the review pass
 * (the front-door fixes are covered in services/trustweb-peer/test/peer.test.mjs).
 */
import { readVia, sanitizeHopItems } from '../../src/hops.ts'
import { channelLink, normalizeHandle } from '../../src/channel.ts'
import { settleDefaultTick, withTick } from '../../src/contact_share.ts'
import { CHAT_KEEP_PER_PERSON, MessageState, queueOutgoing, receiveText } from '../../src/chat.ts'
import { Channel } from '../../src/model.ts'
import { S } from '../../src/strings.ts'
import { readFileSync } from 'node:fs'

const RLO = '‮'
const ZWJ_CTRL = '\u0007'

describe('U7: names and lines from the next step carry no bidi overrides or control characters', () => {
  it('readVia strips them before the name reaches a consent prompt', () => {
    expect(readVia([`${RLO}neB`, `Ann${ZWJ_CTRL}`])).toEqual(['neB', 'Ann'])
  })
  it('sanitizeHopItems strips them from text, date and context', () => {
    const [it0] = sanitizeHopItems([{ text: `Ladder${RLO}`, when: `early${ZWJ_CTRL} May`, context: `What${RLO} I have`, via: [`B${RLO}en`] }])
    expect(it0).toEqual({ text: 'Ladder', when: 'early May', context: 'What I have', via: ['Ben'] })
  })
})

describe('U7: contact values from another phone never throw and never carry mailto parameters', () => {
  it('a malformed escape in a matrix.to link is no handle, not an exception', () => {
    expect(() => normalizeHandle(Channel.Matrix, 'https://matrix.to/#/%E0%A4%A')).not.toThrow()
    expect(normalizeHandle(Channel.Matrix, 'https://matrix.to/#/%E0%A4%A')).toBeNull()
    expect(normalizeHandle(Channel.Matrix, 'https://matrix.to/#/%40ann%3Aexample.org')).toBe('@ann:example.org')
  })
  it('an address with a query part is refused (no prefilled mailto body)', () => {
    expect(normalizeHandle(Channel.Delta, 'a@b.co?body=open-this')).toBeNull()
    expect(normalizeHandle(Channel.Delta, 'a?x=1@b.co')).toBeNull()
    expect(channelLink(Channel.Delta, normalizeHandle(Channel.Delta, 'Ann@Example.org'))).toBe('mailto:ann@example.org')
  })
})

describe('U7: a corrupted tick record never throws and never spreads into ticks', () => {
  for (const bad of ['x', 7, null, ['signal']]) {
    it(`shareOnConnect = ${JSON.stringify(bad)}`, () => {
      const settings = { shareOnConnect: bad }
      expect(() => settleDefaultTick(settings, Channel.Signal, 'https://signal.me/#eu/abc')).not.toThrow()
      expect(withTick(settings, Channel.Signal, true).shareOnConnect).toEqual({ [Channel.Signal]: true })
    })
  }
})

describe('U7: chat bounds never drop an unsent message nor announce one that was not kept', () => {
  it('stops queueing one short of the bound; an arriving message is still kept', () => {
    let book = {}
    let refused = 0
    for (let i = 0; i < CHAT_KEEP_PER_PERSON + 5; i++) {
      const q = queueOutgoing(book, 'p1', `m${i}`, 1000 + i)
      if (q.message) book = q.book; else refused++
    }
    const pending = book.p1.messages.filter((m) => m.state === MessageState.Pending)
    expect(pending.length).toBe(CHAT_KEEP_PER_PERSON - 1)
    expect(pending[0].text).toBe('m0')
    expect(refused).toBe(6)
    const r = receiveText(book, 'p1', 'hello back', 5000, 9000)
    expect(r.message).not.toBeNull()
    expect(r.book.p1.messages.some((m) => m.text === 'hello back')).toBe(true)
    expect(r.book.p1.messages.filter((m) => m.state === MessageState.Pending).length).toBe(CHAT_KEEP_PER_PERSON - 1)
  })
})

describe('U7: the copy says what the app does', () => {
  it('the "How far?" hint tells the asker that people further out see their name and question', () => {
    expect(S.reachHint(2, false)).toMatch(/People you do not know see your name and your question/)
    expect(S.reachHint(6, true)).toMatch(/People you do not know see your name and your question/)
    expect(S.reachHint(1, false)).not.toMatch(/do not know/)
  })
  it('the walkthrough no longer claims an explicit yes in Settings or that the middle cannot read the answer', () => {
    const src = readFileSync(new URL('../../src/walkthrough.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/said yes once|said once, in Settings|set his phone once|cannot read/)
    // wave 6f S1: passing on is off by default; the walkthrough says he switched it on
    expect(src).toMatch(/it is off by default/)
    expect(src).not.toMatch(/unless he switches that off/)
  })
})
