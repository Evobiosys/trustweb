// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave47 invite-fits-chat (2026-11-25, a production event page: "Send invite" answered "No connection right now" while online).
 * Cause: the invite text (the event link with my 200-character did in it) was longer than one chat message (500), so nothing was queued, and every
 * refusal was reported as a missing connection. Proven here: the link is trimmed until the invite fits, and a refused send names its real reason.
 */
import { CHAT_KEEP_PER_PERSON, CHAT_TEXT_MAX, MessageState, emptyBook, pendingOutgoing, queueOutgoing, queueRefusal } from '../../src/chat.ts'
import { LINK_LEAN_MAX, decodeEventLink, encodeEventLink, leanForLink } from '../../src/event_link.ts'
import { fittingInviteText, inviteText } from '../../src/ext/calendar/invitees.ts'
import { refusalOfError, sendToChat } from '../../src/send_notice.ts'
import { S } from '../../src/strings.ts'

const ORIGIN = 'https://app.trustweb.one'
/** The shape of a real identity: production DIDs are 200 characters long. */
const DID = 'did:peer:2' + 'z'.repeat(190)
const BY = { name: 'Ana Example', did: DID }
const ev = (extra = {}) => ({ id: 'e1winter', name: '❄️ Winter Camp', from: '2027-01-08', to: '2027-01-12', where: 'Almhaus, Example', hosts: ['Ana Example'], hostDefault: 'discoverable', showAll: true, createdAt: 1, attended: true, ...extra })
const linkAt = (e, by = BY) => (lean) => { const l = leanForLink(e, by, lean); return encodeEventLink(l.ev, ORIGIN, 'peer', l.by) }
const decoded = (text) => decodeEventLink(text.slice(text.indexOf('#')))

describe('leanForLink: what a link leaves out, least costly first', () => {
  const full = ev({ themes: ['trust', 'commons'], conditions: 'Bring a dish', organizer: 'Anna Gruber' })
  it('step 0 leaves everything in', () => {
    expect(leanForLink(full, BY, 0)).toEqual({ ev: full, by: BY })
  })
  it('step 1 takes only my did out: the name stays', () => {
    expect(leanForLink(full, BY, 1)).toEqual({ ev: full, by: { name: 'Ana Example' } })
  })
  it('steps 2, 3 and 4 take the themes, then the conditions, then the organizer line', () => {
    expect(leanForLink(full, BY, 2).ev).toEqual({ ...full, themes: undefined })
    expect(leanForLink(full, BY, 3).ev).toEqual({ ...full, themes: undefined, conditions: undefined })
    expect(leanForLink(full, BY, LINK_LEAN_MAX).ev).toEqual({ ...full, themes: undefined, conditions: undefined, organizer: undefined })
    expect('themes' in leanForLink(full, BY, 2).ev).toBe(false)
  })
  it('never leaves out what makes the event work on the other phone, and never changes the event handed in', () => {
    const before = JSON.stringify(full)
    const lean = leanForLink(full, BY, LINK_LEAN_MAX)
    expect(lean.ev).toMatchObject({ id: 'e1winter', name: '❄️ Winter Camp', from: '2027-01-08', to: '2027-01-12', where: 'Almhaus, Example', hosts: ['Ana Example'], hostDefault: 'discoverable', showAll: true })
    expect(lean.by).toEqual({ name: 'Ana Example' })
    expect(JSON.stringify(full)).toBe(before)
  })
  it('a hidden sender stays hidden', () => {
    expect(leanForLink(full, undefined, 1)).toEqual({ ev: full })
  })
})

describe('fittingInviteText: the invite fits one chat message', () => {
  it('the production case: with a 200-character did the plain invite is too long for a chat message', () => {
    expect(inviteText(linkAt(ev())(0), ev().name).length).toBeGreaterThan(CHAT_TEXT_MAX)
    expect(queueOutgoing(emptyBook(), 'peer1', inviteText(linkAt(ev())(0), ev().name), 1).message).toBeNull()
  })
  it('...and the fitted invite goes into the chat: same event, my name, no did', () => {
    const text = fittingInviteText(ev().name, linkAt(ev()))
    expect(text).not.toBeNull()
    expect(text.length).toBeLessThanOrEqual(CHAT_TEXT_MAX)
    expect(text.startsWith('You are invited: ❄️ Winter Camp\n' + ORIGIN + '/#ev=')).toBe(true)
    expect(queueOutgoing(emptyBook(), 'peer1', text, 1).message).not.toBeNull()
    expect(decoded(text)).toMatchObject({ kind: 'peer', id: 'e1winter', name: '❄️ Winter Camp', from: '2027-01-08', to: '2027-01-12', where: 'Almhaus, Example', hosts: ['Ana Example'], hostDefault: 'discoverable', showAll: true, by: { name: 'Ana Example' } })
    expect(decoded(text).by.did).toBeUndefined()
  })
  it('an invite that fits is sent whole, did included', () => {
    const by = { name: 'Anna', did: 'did:peer:abc' }
    const text = fittingInviteText('Fair', linkAt(ev({ name: 'Fair' }), by))
    expect(text).toBe(inviteText(linkAt(ev({ name: 'Fair' }), by)(0), 'Fair'))
    expect(decoded(text).by).toEqual(by)
  })
  it('trims no more than needed: the step before the chosen one did not fit', () => {
    const e = ev({ themes: ['trust', 'commons', 'care'], conditions: 'c'.repeat(120), organizer: 'Anna Gruber' })
    const at = linkAt(e, { name: 'Ana' })
    const text = fittingInviteText(e.name, at)
    const step = [0, 1, 2, 3, 4].find((n) => inviteText(at(n), e.name) === text)
    expect(step).toBeGreaterThan(1)
    expect(inviteText(at(step - 1), e.name).length).toBeGreaterThan(CHAT_TEXT_MAX)
    expect(decoded(text).organizer).toBe('Anna Gruber')
  })
  it('the last step counts: a long organizer line goes out only when nothing else helps, and then the invite fits', () => {
    const e = ev({ organizer: 'o'.repeat(380) })
    const at = linkAt(e, { name: 'Ana' })
    expect(inviteText(at(LINK_LEAN_MAX - 1), e.name).length).toBeGreaterThan(CHAT_TEXT_MAX)
    const text = fittingInviteText(e.name, at)
    expect(text).toBe(inviteText(at(LINK_LEAN_MAX), e.name))
    expect(decoded(text).organizer).toBeUndefined()
    expect(decoded(text)).toMatchObject({ id: e.id, name: e.name, where: e.where, by: { name: 'Ana' } })
  })
  it('null when even the leanest link is too long (the view says so; nothing is cut blindly)', () => {
    expect(fittingInviteText('Fair', linkAt(ev({ where: 'w'.repeat(600) })))).toBeNull()
  })
  it('respects the bound it is given', () => {
    const at = linkAt(ev({ name: 'Fair' }), { name: 'Anna' })
    const whole = inviteText(at(0), 'Fair')
    expect(fittingInviteText('Fair', at, whole.length)).toBe(whole)
    expect(fittingInviteText('Fair', at, whole.length - 1)).toBeNull()
  })
  it('property: over many event shapes the result is null or fits, is queued by the chat, and still names the same event', () => {
    let seed = 7
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    let fitted = 0
    for (let i = 0; i < 300; i++) {
      const e = ev({ name: 'N' + 'ä'.repeat(rnd(30)), where: 'w'.repeat(rnd(80)), ...(rnd(2) ? { themes: Array.from({ length: rnd(5) + 1 }, (_, k) => 't'.repeat(rnd(20) + 1) + k) } : {}), ...(rnd(2) ? { conditions: 'c'.repeat(rnd(300) + 1) } : {}), ...(rnd(2) ? { organizer: 'o'.repeat(rnd(60) + 1) } : {}) })
      const by = rnd(4) ? { name: 'J'.repeat(rnd(30) + 1), ...(rnd(2) ? { did: 'did:peer:2' + 'z'.repeat(rnd(200)) } : {}) } : undefined
      const text = fittingInviteText(e.name, linkAt(e, by))
      if (text === null) { expect(inviteText(linkAt(e, by)(LINK_LEAN_MAX), e.name).length).toBeGreaterThan(CHAT_TEXT_MAX); continue }
      fitted++
      expect(text.length).toBeLessThanOrEqual(CHAT_TEXT_MAX)
      expect(queueOutgoing(emptyBook(), 'p', text, 1).message).not.toBeNull()
      expect(decoded(text)).toMatchObject({ id: e.id, name: e.name, from: e.from, to: e.to, where: e.where, hosts: e.hosts, showAll: true })
    }
    expect(fitted).toBeGreaterThan(100)
  })
})

describe('queueRefusal: why the chat takes nothing', () => {
  const full = () => { let b = emptyBook(); for (let i = 0; i < CHAT_KEEP_PER_PERSON - 1; i++) b = queueOutgoing(b, 'p1', `m${i}`, 1 + i).book; return b }
  const table = [
    ['a normal text', () => emptyBook(), 'p1', 'Hello', null],
    ['exactly the bound', () => emptyBook(), 'p1', 'x'.repeat(CHAT_TEXT_MAX), null],
    ['one over the bound', () => emptyBook(), 'p1', 'x'.repeat(CHAT_TEXT_MAX + 1), 'too-long'],
    ['only blanks', () => emptyBook(), 'p1', '  \n ', 'empty'],
    ['not a text', () => emptyBook(), 'p1', 42, 'empty'],
    ['nobody to send to', () => emptyBook(), undefined, 'Hello', 'not-connected'],
    ['an empty peer id', () => emptyBook(), '', 'Hello', 'not-connected'],
    ['a thread full of waiting messages', full, 'p1', 'Hello', 'thread-full'],
    ['a full thread of someone else', full, 'p2', 'Hello', null],
  ]
  for (const [name, book, peer, raw, want] of table) {
    it(`${name} -> ${want}`, () => {
      expect(queueRefusal(book(), peer, raw)).toBe(want)
      expect(queueOutgoing(book(), peer ?? '', raw, 5).message === null).toBe(want !== null)   // the two never disagree
    })
  }
})

describe('a refused send names its reason; "No connection" is for the transport alone', () => {
  const io = (send = async () => {}) => { let book = emptyBook(); return { getBook: () => book, setBook: (b) => { book = b }, send, now: () => 1000 } }
  it('every reason has its own sentence, none of them the offline one', () => {
    const all = Object.values(S.sendRefused)
    expect(Object.keys(S.sendRefused).sort()).toEqual(['blocked', 'empty', 'failed', 'not-connected', 'thread-full', 'too-long'])
    expect(new Set(all).size).toBe(all.length)
    for (const text of [...all, S.cal.inviteTooLong]) { expect(text).not.toBe(S.chatOffline); expect(text).not.toMatch(/No connection|back online|waits here/) }
  })
  it('refusalOfError reads what the senders throw', () => {
    expect(refusalOfError(new Error('blocked'))).toBe('blocked')
    expect(refusalOfError(new Error('no peer'))).toBe('not-connected')
    expect(refusalOfError(new Error('not connected'))).toBe('not-connected')
    expect(refusalOfError(new Error('relay not connected'))).toBe('failed')
    expect(refusalOfError(undefined)).toBe('failed')
    expect(refusalOfError('blocked')).toBe('failed')
  })
  it('sendToChat: sent -> null, delivered in the thread', async () => {
    const sent = []
    const o = io(async (peer, text) => { sent.push([peer, text]) })
    expect(await sendToChat(o, 'p1', 'You are invited')).toBeNull()
    expect(sent).toEqual([['p1', 'You are invited']])
    expect(o.getBook().p1.messages.map((m) => m.state)).toEqual([MessageState.Delivered])
  })
  it('sendToChat: the relay is down -> null as well: the message really waits in the thread (the one case the offline words are true for)', async () => {
    const o = io(async () => { throw new Error('relay not connected') })
    expect(await sendToChat(o, 'p1', 'You are invited')).toBeNull()
    expect(pendingOutgoing(o.getBook(), 'p1').map((m) => m.text)).toEqual(['You are invited'])
  })
  it('sendToChat: too long, nobody, nothing -> the reason, and nothing is queued or sent', async () => {
    for (const [peer, text, want] of [['p1', 'x'.repeat(CHAT_TEXT_MAX + 1), 'too-long'], [undefined, 'Hello', 'not-connected'], ['p1', ' ', 'empty']]) {
      let calls = 0
      const o = io(async () => { calls++ })
      expect(await sendToChat(o, peer, text)).toBe(want)
      expect(o.getBook()).toEqual(emptyBook())
      expect(calls).toBe(0)
    }
  })
})
