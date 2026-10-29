/**
 * Wave 6i, THE ONE THING: an ask and its answer stay one conversation.
 *   a) a reply carries the question it answers (chat envelope `re`, chat_re.ts, chat.ts, chat_view.ts), bound to the right qid,
 *      dropped by an older receiver (the 19739d7 wire.ts, read from git) which then shows the message alone;
 *   b) the card stack above the rings (card_stack.ts): one tap opens, nothing floats, only the quiet card hides itself;
 *   c) tightening a ring brings back the earlier asks (reask.ts, net.ts): the rule table (loosening sends nothing), which asks come
 *      back and how many, end to end with real Net instances over an in-memory RelayServer and a short window;
 *   d) Record lines default to Close friends (model.ts RECORD_LINE_AUDIENCE, main.ts).
 * No guest names: Ada, Bo, Cy, Eve are the suite's own.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { Net } from '../../src/net.ts'
import { ChatDirection, MessageState, emptyBook, migrateChats, queueOutgoing, receiveText, sanitizeChatBook } from '../../src/chat.ts'
import { bindRe, cleanReText, makeRe, sanitizeRe } from '../../src/chat_re.ts'
import { chatViewModel, flushPending, renderChat, submitText } from '../../src/chat_view.ts'
import { QUIET_CARD_MS, STACK_MESSAGES_MAX, StackCardKind, cardAsk, hidesItself, messageCards, stackCards } from '../../src/card_stack.ts'
import {
  LATE_KEEP_MS, SENT_ASK_KEEP_MS, addLateAnswer, addSentAsk, addShownAnswer, askOfQid, dismissLateAnswer, forgetSentAsk, liveLateAnswers,
  liveSentAsks, sentAskFor, shownLateAnswers,
} from '../../src/late_answers.ts'
import {
  ASK_AGAIN_COOLDOWN_MS, REASKS_PER_ASK, REASK_MAX, REASK_WINDOW_MS, askAgainAllowed, earlierAsk, liveReaskSeen, noteEarlierAsk, noteReasked,
  reaskCandidates, reaskFields, reaskText, ringRaised, showsEarlierAsk,
} from '../../src/reask.ts'
import { liveHeldAsks } from '../../src/held_asks.ts'
import { Audience, AUDIENCES, LogOutcome, RECORD_LINE_AUDIENCE, Ring, RINGS, UnmatchedReason } from '../../src/model.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../..')
const W = 600
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 9, 12)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}
const ME = { id: 'me1', displayName: 'Ada' }
const chat = (extra = {}) => ({ v: 1, t: 'chat', from: ME, text: 'I do', ts: NOW, ...extra })
const RE = { qid: 'Qa1b2C3d4e5f', text: 'does anyone have a spare room?', at: NOW - 60_000 }

// ---------------------------------------------------------------------------
// a) the reply carries the question
// ---------------------------------------------------------------------------

describe('the wire: chat `re` (apps/demo wire.ts parseChat), strict like every optional field', () => {
  it('a well-formed re travels; a chat without one parses exactly as before', () => {
    expect(decodeFromQr(encodeForQr(chat({ re: RE })))).toEqual(chat({ re: RE }))
    expect(decodeFromQr(encodeForQr(chat()))).toEqual(chat())
  })
  it('present and malformed rejects the envelope (a sign of tampering or skew, never silently half-read)', () => {
    for (const bad of [null, 'x', [], {}, { ...RE, qid: '' }, { ...RE, qid: 'has space' }, { ...RE, qid: 'x'.repeat(65) }, { ...RE, text: '' },
      { ...RE, text: 'x'.repeat(201) }, { ...RE, at: -1 }, { ...RE, at: 'now' }, { ...RE, at: Infinity }]) {
      expect(decodeFromQr(JSON.stringify(chat({ re: bad })))).toBeNull()
    }
  })
  it('only the three fields are kept (anything else a sender put in is not read)', () => {
    expect(decodeFromQr(encodeForQr(chat({ re: { ...RE, extra: 'y' } })))?.re).toEqual(RE)
  })
  it('ask-again carries nothing: whatever else a sender put in is dropped', () => {
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'ask-again' }))).toEqual({ v: 1, t: 'ask-again' })
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'ask-again', ring: 'close', text: 'x' }))).toEqual({ v: 1, t: 'ask-again' })
  })
  it('query `reask`: {originalQid, originalAt} kept; malformed rejects; absent parses as before', () => {
    const q = { v: 1, t: 'query', from: ME, templateId: 't', templateVersion: 1, qid: 'q1234567', issuedAt: 1 }
    expect(decodeFromQr(encodeForQr({ ...q, reask: { originalQid: 'Qold123', originalAt: 5 } }))?.reask).toEqual({ originalQid: 'Qold123', originalAt: 5 })
    expect(decodeFromQr(encodeForQr(q))).toEqual(q)
    for (const bad of [true, {}, { originalQid: 'a b', originalAt: 1 }, { originalQid: 'ok', originalAt: -5 }, { originalQid: 'ok' }]) {
      expect(decodeFromQr(JSON.stringify({ ...q, reask: bad }))).toBeNull()
    }
  })
})

describe('an older receiver (the live 19739d7 wire.ts, read from git)', () => {
  let dir
  let old
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'tw6i-oldwire-'))
    for (const f of ['wire.ts', 'types.ts']) {
      writeFileSync(path.join(dir, f), execFileSync('git', ['show', `19739d7:apps/demo/src/${f}`], { cwd: REPO }))
    }
    old = await import(pathToFileURL(path.join(dir, 'wire.ts')).href)
  })
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })
  it('drops `re` and keeps the message (the text shows alone)', () => {
    expect(old.decodeFromQr(encodeForQr(chat({ re: RE })))).toEqual(chat())
  })
  it('drops `reask` (the re-ask reads as a new ask)', () => {
    const q = { v: 1, t: 'query', from: ME, templateId: 't', templateVersion: 1, qid: 'q1234567', issuedAt: 1, freeText: 'room', answerWindowMs: 120_000 }
    expect(old.decodeFromQr(encodeForQr({ ...q, reask: { originalQid: 'Qold123', originalAt: 5 } }))).toEqual(q)
  })
  it('does not know ask-again: null, so its relay channel never acks it and it waits until that phone loads this build', () => {
    expect(old.decodeFromQr(JSON.stringify({ v: 1, t: 'ask-again' }))).toBeNull()
  })
})

describe('chat_re.ts', () => {
  it('makeRe: a usable qid, words and time, cleaned and bounded; anything else null', () => {
    expect(makeRe('Qa1', '  spare‮room \n please ', 5)).toEqual({ qid: 'Qa1', text: 'spareroom please', at: 5 })
    expect(makeRe('Qa1', 'x'.repeat(300), 5).text).toHaveLength(200)
    expect(makeRe('', 'x', 1)).toBeNull()
    expect(makeRe('Qa1', '   ', 1)).toBeNull()
    expect(makeRe('Qa1', 'x', -1)).toBeNull()
    expect(makeRe('Qa1', 'x', Number.NaN)).toBeNull()
    expect(sanitizeRe(null)).toBeNull()
    expect(cleanReText(7)).toBe('')
  })
  it('bindRe: a qid this phone sent to THAT connection shows its own words and time; anyone else\'s claim shows as carried', () => {
    const sent = addSentAsk([], { id: 'root1', text: 'does anyone have a spare room?', at: NOW - 600_000, to: [{ peerId: 'pA', qid: 'Qa' }, { peerId: 'pB', qid: 'Qb' }] }, NOW)
    expect(bindRe({ qid: 'Qa', text: 'something else entirely', at: 1 }, sent, 'pA', NOW)).toEqual({ qid: 'Qa', text: 'does anyone have a spare room?', at: NOW - 600_000 })
    // the qid of the ask to B, claimed by A: not bound, shown as carried
    expect(bindRe({ qid: 'Qb', text: 'claimed', at: 3 }, sent, 'pA', NOW)).toEqual({ qid: 'Qb', text: 'claimed', at: 3 })
    expect(bindRe({ qid: 'Qx', text: 'theirs', at: 3 }, sent, 'pA', NOW)).toEqual({ qid: 'Qx', text: 'theirs', at: 3 })
    expect(bindRe(undefined, sent, 'pA', NOW)).toBeNull()
    expect(bindRe({ qid: 'Qa' }, sent, 'pA', NOW)).toBeNull()
  })
})

describe('chat.ts: the quote is kept with the message, on both sides, and never costs the message', () => {
  it('queueOutgoing and receiveText keep a good re and drop a bad one', () => {
    const out = queueOutgoing(emptyBook(), 'p1', 'I do', NOW, RE)
    expect(out.message.re).toEqual(RE)
    expect(queueOutgoing(emptyBook(), 'p1', 'I do', NOW, { qid: '' }).message).toMatchObject({ text: 'I do' })
    expect(queueOutgoing(emptyBook(), 'p1', 'I do', NOW, { qid: '' }).message.re).toBeUndefined()
    const got = receiveText(emptyBook(), 'p1', 'I do', NOW, NOW, RE)
    expect(got.message).toMatchObject({ dir: ChatDirection.In, re: RE })
    // the dedupe key does not change with the quote (a redelivery is still a duplicate)
    expect(receiveText(got.book, 'p1', 'I do', NOW, NOW + 5).duplicate).toBe(true)
  })
  it('a stored book keeps its quotes; a malformed quote goes, the message stays; the migration never throws', () => {
    const book = receiveText(queueOutgoing(emptyBook(), 'p1', 'one', NOW, RE).book, 'p1', 'two', NOW + 1, NOW + 1, RE).book
    expect(sanitizeChatBook(JSON.parse(JSON.stringify(book)))).toEqual(book)
    const bad = JSON.parse(JSON.stringify(book))
    bad.p1.messages[0].re = { qid: 'ok', text: 42, at: 1 }
    const clean = sanitizeChatBook(bad)
    expect(clean.p1.messages).toHaveLength(2)
    expect(clean.p1.messages[0].re).toBeUndefined()
    const s = { chats: bad }
    expect(migrateChats(s)).toBe(true)
    expect(migrateChats({ chats: { p1: { messages: [{ re: { get qid() { throw new Error('x') } } }] } } })).toBe(false)
  })
  it('a message queued while offline keeps its quote and carries it on the retry', async () => {
    const sent = []
    let book = emptyBook()
    let fail = true
    const io = { getBook: () => book, setBook: (b) => { book = b }, now: () => NOW, send: async (_p, text, sentAt, re) => { if (fail) throw new Error('down'); sent.push({ text, sentAt, re }) } }
    expect(await submitText(io, 'p1', 'I do', RE)).toBe(true)
    expect(book.p1.messages[0].state).toBe(MessageState.Pending)
    fail = false
    expect(await flushPending(io, 'p1')).toBe(1)
    expect(sent).toEqual([{ text: 'I do', sentAt: book.p1.messages[0].sentAt, re: RE }])
  })
  it('the view model hands the quote to the row', () => {
    const book = receiveText(emptyBook(), 'p1', 'I do', NOW, NOW, RE).book
    expect(chatViewModel({ name: 'Bo', peerId: 'p1', reach: null }, book, true).rows[0].re).toEqual(RE)
  })
})

// A small fake document for renderChat (no DOM library in the workspace): what the view uses, plus dataset/classList/offsetTop.
class FakeNode {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.value = ''; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 500; this.offsetTop = 0; this.cls = new Set() }
  setAttribute(k, v) { this.attrs[k] = v }
  get dataset() { return Object.fromEntries(Object.entries(this.attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v])) }
  get classList() { return { add: (c) => this.cls.add(c) } }
  append(...kids) { this.children.push(...kids) }
  replaceChildren(...kids) { this.children = kids }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn) }
  fire(t, ev = {}) { return Promise.all((this.listeners[t] ?? []).map((fn) => fn(ev))) }
  set textContent(v) { this.children = v === '' ? [] : [{ text: String(v) }] }
  get textContent() { return this.children.map((c) => (c.text !== undefined ? c.text : c.textContent)).join('') }
  find(pred, out = []) { for (const c of this.children) if (c.tagName) { if (pred(c)) out.push(c); c.find(pred, out) } return out }
  byClass(cls) { return this.find((n) => (n.attrs.class ?? '').split(' ').includes(cls)) }
  byTag(tag) { return this.find((n) => n.tagName === tag) }
}
const fakeDoc = () => {
  const head = new FakeNode('head')
  return { head, createElement: (t) => new FakeNode(t), createTextNode: (text) => ({ text }), getElementById: (id) => head.find((n) => n.attrs.id === id)[0] ?? null }
}
const CS = {
  title: (n) => `Chat with ${n}`, messageOn: () => 'Message on Signal', notConnected: (n) => n, empty: (n) => n, offline: 'off', placeholder: 'Message',
  send: 'Send', longHint: 'Signal', sendAgain: 'Again', pending: 'Waiting', sent: 'Sent', charsLeft: (n) => `${n}`, you: 'You',
  re: (t, w) => `Re: “${t}” · ${w}`, replyingTo: (t, w) => `Replying to “${t}” · ${w}`, replyingToDrop: 'Write without this ask',
}

describe('renderChat: both sides show the question above the reply; a chat opened from an ask carries it once', () => {
  it('a message with a quote shows "Re: <ask>" above its text', () => {
    const book = receiveText(emptyBook(), 'p1', 'I do', NOW, NOW, RE).book
    const io = { getBook: () => book, setBook: () => {}, send: async () => {}, now: () => NOW }
    const root = renderChat({ ...io, doc: fakeDoc(), person: { name: 'Bo', peerId: 'p1', reach: null }, S: CS, isOnline: () => true }).el
    const msg = root.byClass('chat-msg')[0]
    expect(msg.children[0].attrs.class).toBe('chat-re')
    expect(msg.children[0].textContent).toMatch(/^Re: “does anyone have a spare room\?” · /)
    expect(msg.children[1].textContent).toBe('I do')
  })
  it('opened from an ask: the context line shows; the next message carries it; the one after does not; its x drops it', async () => {
    let book = emptyBook()
    const calls = []
    const io = { getBook: () => book, setBook: (b) => { book = b }, send: async (_p, text, _t, re) => { calls.push({ text, re }) }, now: () => NOW }
    const root = renderChat({ ...io, doc: fakeDoc(), person: { name: 'Bo', peerId: 'p1', reach: null }, S: CS, isOnline: () => true, context: RE }).el
    expect(root.byClass('chat-context')[0].textContent).toMatch(/^Replying to “does anyone have a spare room\?”/)
    const send = async (text) => { const area = root.byTag('textarea')[0]; area.value = text; await area.fire('input'); await root.byTag('button').find((b) => b.textContent === 'Send').fire('click'); await sleep(0) }
    await send('I do')
    await send('when do you need it?')
    expect(calls).toEqual([{ text: 'I do', re: RE }, { text: 'when do you need it?', re: undefined }])
    expect(root.byClass('chat-context')).toHaveLength(0)
    const root2 = renderChat({ ...io, doc: fakeDoc(), person: { name: 'Bo', peerId: 'p1', reach: null }, S: CS, isOnline: () => true, context: RE }).el
    await root2.find((n) => n.attrs['data-chat-context-drop'] === '1')[0].fire('click')
    expect(root2.byClass('chat-context')).toHaveLength(0)
  })
  it('opened from a "new message" card: the thread is scrolled to that message and marks it', () => {
    let book = receiveText(emptyBook(), 'p1', 'first', NOW, NOW).book
    const target = receiveText(book, 'p1', 'second', NOW + 1, NOW + 1)
    book = receiveText(target.book, 'p1', 'third', NOW + 2, NOW + 2).book
    const io = { getBook: () => book, setBook: (b) => { book = b }, send: async () => {}, now: () => NOW }
    const root = renderChat({ ...io, doc: fakeDoc(), person: { name: 'Bo', peerId: 'p1', reach: null }, S: CS, isOnline: () => true, scrollTo: target.message.key }).el
    const marked = root.byClass('chat-msg').filter((n) => n.cls.has('chat-focus'))
    expect(marked.map((n) => n.byClass('chat-text')[0].textContent)).toEqual(['second'])
  })
})

// ---------------------------------------------------------------------------
// b) the card stack
// ---------------------------------------------------------------------------

describe('card_stack.ts: in the flow above the rings, one tap opens', () => {
  const late = (id, extra = {}) => ({ id, at: NOW, peerId: 'pA', from: 'Ada', ask: 'spare room', items: [{ text: 'Guest room', when: '', context: '' }], releasedAt: NOW, askedAt: NOW - 1000, ...extra })
  const unmatched = [{ id: 'u1', at: NOW, peerId: 'pB', from: 'Bo', text: 'sailing boat', reason: UnmatchedReason.Nothing }, { id: 'u0', at: NOW - 5, peerId: 'pB', from: 'Bo', text: 'kayak', reason: UnmatchedReason.Nothing }]
  const away = [{ id: 'a1', at: NOW, peerId: 'pC', from: 'Cy', text: 'drill' }]
  it('new messages first (the last writer first, at most three, only people with a card), then each late answer, then the newest unmatched and away', () => {
    let book = emptyBook()
    for (const [i, id] of ['p1', 'p2', 'p3', 'p4', 'p5'].entries()) book = receiveText(book, id, 'hi', NOW + i, NOW + i).book
    const cards = stackCards({ chats: book, lateAnswers: [late('L1'), late('L2')], unmatchedAsks: unmatched, awayAsks: away }, NOW, false, new Set(), (id) => id !== 'p5')
    expect(cards.map((c) => c.kind)).toEqual([StackCardKind.Message, StackCardKind.Message, StackCardKind.Message, StackCardKind.Late, StackCardKind.Late, StackCardKind.Unmatched, StackCardKind.Away])
    expect(cards.slice(0, 3).map((c) => c.peerId)).toEqual(['p4', 'p3', 'p2'])
    expect(STACK_MESSAGES_MAX).toBe(3)
    expect(cards.find((c) => c.kind === StackCardKind.Unmatched)).toMatchObject({ more: 1, ask: { id: 'u1' } })
  })
  it('a message card points at the newest message FROM them; a read thread has none', () => {
    let book = receiveText(emptyBook(), 'p1', 'hi', NOW, NOW).book
    book = queueOutgoing(book, 'p1', 'mine', NOW + 1).book
    const [card] = messageCards(book, () => true)
    expect(card.messageKey).toBe(book.p1.messages[0].key)
    expect(messageCards({ p1: { ...book.p1, unread: 0 } }, () => true)).toEqual([])
  })
  it('only the quiet nothing-matched card hides itself, after 20 s; a hidden one stays out for this visit', () => {
    expect(QUIET_CARD_MS).toBe(20_000)
    const cards = stackCards({ lateAnswers: [late('L1')], unmatchedAsks: unmatched, awayAsks: away }, NOW, false, new Set(), () => true)
    expect(cards.filter(hidesItself).map((c) => c.kind)).toEqual([StackCardKind.Unmatched])
    expect(stackCards({ unmatchedAsks: unmatched }, NOW, false, new Set(['unmatched:u1']), () => true)).toEqual([])
  })
  it('cardAsk: each card names the ask a reply carries, by the qid between the two phones', () => {
    const cards = stackCards({ lateAnswers: [late('L1')], unmatchedAsks: unmatched, awayAsks: away }, NOW, false, new Set(), () => true)
    expect(cards.map(cardAsk)).toEqual([
      { peerId: 'pA', qid: 'L1', text: 'spare room', at: NOW - 1000 },
      { peerId: 'pB', qid: 'u1', text: 'sailing boat', at: NOW },
      { peerId: 'pC', qid: 'a1', text: 'drill', at: NOW },
    ])
  })
  it('the stack is drawn into the Web screen\'s flow, never as a floating card (main.ts, styles.css)', () => {
    const main = readFileSync(path.join(HERE, '../../src/main.ts'), 'utf8')
    const css = readFileSync(path.join(HERE, '../../src/styles.css'), 'utf8')
    expect(main).toMatch(/queryOpen \? null : cardStackEl,\s*\n\s*s\.people\.length === 0/)
    expect(css).toMatch(/\.card-stack\{display:flex/)
    expect(css.match(/\.card-stack\{[^}]*\}/)[0]).not.toMatch(/position:absolute|position:fixed/)
    expect(css.match(/\.stack-card\{[^}]*\}/)[0]).not.toMatch(/position:absolute|position:fixed/)
    // the message notice off the Web screen takes taps only while it is on screen
    expect(css.match(/\.msg-notice\{[^}]*\}/)[0]).toMatch(/pointer-events:none/)
    expect(css.match(/\.msg-notice\.on\{[^}]*\}/)[0]).toMatch(/pointer-events:auto/)
  })
})

describe('late_answers.ts for 6i', () => {
  it('asks are kept 37 days (for re-asks), but a late yes still counts 7 days after the ask (or its re-ask) went out', () => {
    expect(SENT_ASK_KEEP_MS).toBe(REASK_WINDOW_MS + LATE_KEEP_MS)
    const sent = addSentAsk([], { id: 'r1', text: 'room', at: NOW - 10 * DAY, to: [{ peerId: 'pA', qid: 'Q1' }] }, NOW - 10 * DAY)
    expect(liveSentAsks(sent, NOW)).toHaveLength(1)
    expect(sentAskFor(sent, 'Q1', 'pA', NOW)).toBeUndefined()
    expect(askOfQid(sent, 'Q1', 'pA', NOW)).toEqual({ text: 'room', at: NOW - 10 * DAY })
    const re = noteReasked(sent, 'r1', 'pA', 'Q2', NOW)
    expect(sentAskFor(re, 'Q2', 'pA', NOW)).toMatchObject({ qid: 'Q2', text: 'room', at: NOW - 10 * DAY, earlier: true })
    expect(liveSentAsks(sent, NOW - 10 * DAY + SENT_ASK_KEEP_MS + 1)).toEqual([])
  })
  it('a late answer remembers when it was asked; addShownAnswer shows only that one (the held ones wait for the next open)', () => {
    const held = addLateAnswer([], { qid: 'Qh', peerId: 'pA', text: 'tent', at: NOW - 5 }, 'Ada', [{ text: 'Tent', when: '', context: '' }], NOW)
    const both = addShownAnswer(held, { qid: 'Qs', peerId: 'pA', text: 'room', at: NOW - 9, earlier: true }, 'Ada', [{ text: 'Guest room', when: '', context: '' }], NOW)
    expect(shownLateAnswers(both, NOW).map((a) => [a.id, a.askedAt, a.earlier])).toEqual([['Qs', NOW - 9, true]])
    expect(liveLateAnswers(both, NOW).find((a) => a.id === 'Qh').releasedAt).toBeUndefined()
    expect(dismissLateAnswer(both, 'Qs', NOW).map((a) => a.id)).toEqual(['Qh'])
  })
})

// ---------------------------------------------------------------------------
// c) tightening brings back the earlier asks; loosening sends nothing
// ---------------------------------------------------------------------------

describe('reask.ts: the rule', () => {
  it('ringRaised: tighter is a raise; the same ring and every loosening are not (the full table)', () => {
    for (const from of RINGS) {
      for (const to of RINGS) expect(ringRaised(from, to)).toBe(RINGS.indexOf(to) < RINGS.indexOf(from))
    }
    expect(ringRaised(Ring.Acquaintance, Ring.Friend)).toBe(true)
    expect(ringRaised(Ring.Friend, Ring.Close)).toBe(true)
    expect(ringRaised(Ring.Intending, Ring.Acquaintance)).toBe(true)
    expect(ringRaised(Ring.Friend, Ring.Acquaintance)).toBe(false)
    expect(ringRaised(Ring.Close, Ring.Intending)).toBe(false)
    expect(ringRaised(Ring.Friend, Ring.Friend)).toBe(false)
    expect(ringRaised('stranger', Ring.Close)).toBe(false)
    expect(ringRaised(Ring.Acquaintance, 'family')).toBe(false)
  })
  it('main.ts sends an ask-again ONLY from changeRing on a raise, and the first pick after a scan is no raise', () => {
    const main = readFileSync(path.join(HERE, '../../src/main.ts'), 'utf8')
    const calls = main.match(/net\.askAgain\(/g) ?? []
    expect(calls).toHaveLength(2) // changeRing (a raise) and the Advanced button
    expect(main).toMatch(/if \(peer && before !== undefined && ringRaised\(before, ring\) && mayAskAgainWith\(peer\)\) \{ void net\.askAgain\(peer\); return \}/)
    // every later ring change goes through changeRing (the ring sheet and a note about the person); no other writer of peer.ring sends
    expect(main.match(/changeRing\(/g).length).toBeGreaterThanOrEqual(3)
    expect(main).not.toMatch(/passOn[^\n]*askAgain/)
  })
  const sentTo = (asks) => asks.reduce((list, a) => addSentAsk(list, a, NOW), [])
  it('candidates: only asks to THAT connection, never answered there with a share, within 30 days, newest first, at most 20', () => {
    const asks = []
    for (let i = 0; i < 25; i++) asks.push({ id: `r${i}`, text: `ask ${i}`, at: NOW - (25 - i) * 60_000, to: [{ peerId: 'pA', qid: `Qa${i}` }, { peerId: 'pB', qid: `Qb${i}` }] })
    asks.push({ id: 'old', text: 'too old', at: NOW - 31 * DAY, to: [{ peerId: 'pA', qid: 'Qold' }] })
    asks.push({ id: 'other', text: 'only to B', at: NOW - 1000, to: [{ peerId: 'pB', qid: 'Qonly' }] })
    let list = sentTo(asks)
    list = forgetSentAsk(list, 'Qa24', NOW) // A shared on the newest: never asked again
    const plans = reaskCandidates(list, 'pA', NOW)
    expect(REASK_MAX).toBe(20)
    expect(plans).toHaveLength(20)
    expect(plans[0]).toEqual({ askId: 'r23', text: 'ask 23', firstAt: NOW - 2 * 60_000, originalQid: 'Qa23', prev: { peerId: 'pA', qid: 'Qa23' } })
    expect(plans.map((p) => p.askId)).not.toContain('r24')
    expect(plans.map((p) => p.askId)).not.toContain('old')
    expect(plans.map((p) => p.askId)).not.toContain('other')
    // an ask whose answer is still awaited is not asked again
    expect(reaskCandidates(list, 'pA', NOW, (q) => q === 'Qa23').map((p) => p.askId)[0]).toBe('r22')
  })
  it('a re-asked ask keeps its first qid and time; it is re-sent at most once per possible tightening', () => {
    let list = sentTo([{ id: 'r1', text: 'room', at: NOW - DAY, to: [{ peerId: 'pA', qid: 'Q1' }] }])
    for (let i = 0; i < REASKS_PER_ASK; i++) {
      const [plan] = reaskCandidates(list, 'pA', NOW)
      expect(plan).toMatchObject({ originalQid: 'Q1', firstAt: NOW - DAY })
      list = noteReasked(list, 'r1', 'pA', `Qre${i}`, NOW)
    }
    expect(REASKS_PER_ASK).toBe(3)
    expect(reaskCandidates(list, 'pA', NOW)).toEqual([])
  })
  it('a re-ask is direct, marked with the first ask, carries the first ask\'s words and no ring', () => {
    expect(reaskFields({ askId: 'r1', text: 'room', firstAt: 7, originalQid: 'Q1' })).toEqual({ direct: true, reask: { originalQid: 'Q1', originalAt: 7 } })
    expect(reaskText({ askId: 'r1', text: '  room  ', firstAt: 7, originalQid: 'Q1' })).toBe('room')
    expect(reaskText({ askId: 'r1', text: 'x'.repeat(250), firstAt: 7, originalQid: 'Q1' })).toHaveLength(200)
  })
  it('one round per connection at a time and per minute', () => {
    expect(askAgainAllowed(undefined, false, NOW)).toBe(true)
    expect(askAgainAllowed(undefined, true, NOW)).toBe(false)
    expect(askAgainAllowed(NOW - ASK_AGAIN_COOLDOWN_MS + 1, false, NOW)).toBe(false)
    expect(askAgainAllowed(NOW - ASK_AGAIN_COOLDOWN_MS, false, NOW)).toBe(true)
  })
  it('the receiver: a believable date shows, an unbelievable one is dropped (shown without a date); a bad qid is no earlier ask', () => {
    expect(earlierAsk({ originalQid: 'Q1', originalAt: NOW - DAY }, NOW)).toEqual({ originalQid: 'Q1', at: NOW - DAY })
    expect(earlierAsk({ originalQid: 'Q1', originalAt: NOW + DAY }, NOW)).toEqual({ originalQid: 'Q1', at: null })
    expect(earlierAsk({ originalQid: 'Q1', originalAt: NOW - 60 * DAY }, NOW)).toEqual({ originalQid: 'Q1', at: null })
    expect(earlierAsk({ originalQid: 'a b', originalAt: NOW }, NOW)).toBeNull()
    expect(earlierAsk(undefined, NOW)).toBeNull()
  })
  it('the receiver shows the same earlier ask again only at a tighter ring (a double tap or a lower-then-raise repeats nothing)', () => {
    let seen = noteEarlierAsk([], 'Q1', 'pB', Ring.Friend, NOW)
    expect(showsEarlierAsk(seen, 'Q1', 'pB', Ring.Friend, NOW)).toBe(false)
    expect(showsEarlierAsk(seen, 'Q1', 'pB', Ring.Acquaintance, NOW)).toBe(false)
    expect(showsEarlierAsk(seen, 'Q1', 'pB', Ring.Close, NOW)).toBe(true)
    expect(showsEarlierAsk(seen, 'Q1', 'pOther', Ring.Friend, NOW)).toBe(true)
    seen = noteEarlierAsk(seen, 'Q1', 'pB', Ring.Close, NOW)
    expect(liveReaskSeen(seen, NOW)).toHaveLength(1)
    expect(liveReaskSeen([{ id: 1 }, null, 'x', { id: 'Q', at: NOW, peerId: 'p', ring: 'family' }], NOW)).toEqual([])
  })
  it('held prompts keep the earlier fields; a malformed one is dropped, never thrown on', () => {
    const base = { qid: 'q', peerId: 'p', text: 't', fromName: 'Bo', through: [], doorName: null, relayed: false, matches: [], receivedAt: NOW, deadline: NOW, lateMode: true }
    expect(liveHeldAsks([{ ...base, earlierAt: NOW - DAY, reaskOf: 'Q1' }], NOW)).toHaveLength(1)
    expect(liveHeldAsks([{ ...base, earlierAt: 'yesterday' }], NOW)).toEqual([])
  })
})

// --- end to end over a real relay, with real Net instances ---

let relay
let relayOrigin
const nets = []

beforeAll(async () => {
  relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port } = await relay.listen(0, '127.0.0.1')
  relayOrigin = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  for (const n of nets) n.stop()
  await relay.close()
})

/** One phone. `decide`: what the person does with a prompt: 'yes', 'no' or 'wait'. `sends` counts every envelope type it sends. */
async function phone(name, items = [], opts = {}) {
  const state = {
    v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false,
    inventory: items.map((it) => ({ id: randomId(8), included: true, createdAt: Date.now(), audience: Audience.FriendsOfFriends, ...it })),
  }
  const p = { name, state, prompts: [], texts: [], unmatched: 0, released: 0, decide: opts.decide ?? 'wait', sends: [] }
  p.hooks = {
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: (ask) => { p.prompts.push(ask); if (p.decide !== 'wait') void ask.decide(p.decide === 'yes') },
    onPeerConnected: () => {},
    holdPeer: () => false,
    onPeerConfirmed: () => {},
    ringForNewPeer: () => Ring.Friend,
    onLogChanged: () => {},
    askScope: () => undefined,
    onText: (peer, text, ts, re) => { p.texts.push({ from: peer.displayName, text, re }) },
    mayPassOnFrom: () => true,
    samePerson: () => false,
    keepsUnmatched: () => true,
    onUnmatchedAsk: () => { p.unmatched++ },
    onLateAnswersReleased: () => { p.released++ },
    mayReask: () => opts.mayReask ?? true,
  }
  p.net = new Net(p.hooks, { answerWindowMs: W, relayOrigin })
  await p.net.start()
  // count what leaves this phone, by envelope type (the relay channel is private: wrap its send)
  const channel = p.net.channel
  const send = channel.send.bind(channel)
  channel.send = (to, env, key) => { p.sends.push(env.t); return send(to, env, key) }
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

/** `asker` connects to `asked`; on the asked phone the asker is `ringAtAsked`. */
async function connect(asker, asked, ringAtAsked) {
  await asker.net.completeConnect({ did: asked.did, from: asked.state.me }, Ring.Friend)
  await until(() => asked.state.peers.some((x) => x.did === asker.did))
  asked.state.peers.find((x) => x.did === asker.did).ring = ringAtAsked
}
const peerOn = (holder, other) => holder.state.peers.find((x) => x.did === other.did)

describe('end to end: the reply carries the question (two real Nets)', () => {
  it('Ada replies from the prompt with a message: Bo\'s phone binds the quote to his own ask, Ada\'s thread keeps it too', async () => {
    const ada = await phone('Ada', [{ text: 'Spare room in Vienna' }], { decide: 'yes' })
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Friend)
    const results = await bo.net.ask('does anyone have a spare room?')
    const prompt = ada.prompts[0]
    expect(prompt.askerPeerId).toBe(peerOn(ada, bo).id)
    expect(results[0].qid).toBe(prompt.qid)
    const re = makeRe(prompt.qid, prompt.text, prompt.receivedAt)
    await ada.net.sendText(peerOn(ada, bo), 'I do', Date.now(), re)
    await until(() => bo.texts.length === 1)
    const bound = bindRe(bo.texts[0].re, bo.state.sentAsks, peerOn(bo, ada).id, Date.now())
    expect(bound.text).toBe('does anyone have a spare room?')
    expect(bound.qid).toBe(prompt.qid)
  })
})

describe('end to end: tightening brings back the earlier asks; loosening sends nothing', () => {
  it('Bo asks while an acquaintance (no match: the line is for friends); Ada raises him; his earlier ask comes back marked; her yes reaches him at the moment', async () => {
    const ada = await phone('Ada', [{ text: 'Spare room in Vienna', audience: Audience.Friends }])
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    await bo.net.ask('spare room')
    expect(ada.prompts).toHaveLength(0)
    expect(ada.unmatched).toBe(1)
    const firstQid = bo.state.sentAsks[0].to[0].qid
    // Ada makes Bo a friend (main.ts changeRing: the ring, then one ask-again)
    peerOn(ada, bo).ring = Ring.Friend
    const before = ada.sends.length
    expect(await ada.net.askAgain(peerOn(ada, bo))).toBe(true)
    expect(ada.sends.slice(before)).toEqual(['ask-again'])
    await until(() => ada.prompts.length === 1, 10_000)
    const p = ada.prompts[0]
    expect(p.earlier).not.toBeNull()
    expect(p.earlier.at).toBe(bo.state.sentAsks[0].at)
    expect(p.text).toBe('spare room')
    // the earlier "nothing matched" card went with it
    expect((ada.state.unmatchedAsks ?? []).some((a) => a.id === firstQid)).toBe(false)
    expect(bo.sends.filter((t) => t === 'query')).toHaveLength(2)
    await p.decide(true)
    await until(() => shownLateAnswers(bo.state.lateAnswers, Date.now()).length === 1, 10_000)
    const shown = shownLateAnswers(bo.state.lateAnswers, Date.now())[0]
    expect(shown).toMatchObject({ from: 'Ada', ask: 'spare room', earlier: true })
    expect(shown.items.map((i) => i.text)).toEqual(['Spare room in Vienna'])
    expect(bo.released).toBe(1)
    // answered with a share: never asked again
    expect(reaskCandidates(bo.state.sentAsks, peerOn(bo, ada).id, Date.now())).toEqual([])
  })

  it('loosening sends nothing at all: no envelope leaves Ada, Bo\'s phone sends nothing either', async () => {
    const ada = await phone('Ada', [{ text: 'Ladder', audience: Audience.Close }])
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Friend)
    await bo.net.ask('ladder')
    await sleep(W)
    const adaBefore = ada.sends.length
    const boBefore = bo.sends.length
    // Ada lowers Bo (main.ts changeRing: no raise, so askAgain is never called) and switches pass-on off: the Net is not touched
    peerOn(ada, bo).ring = Ring.Acquaintance
    await sleep(3 * W)
    expect(ada.sends.length).toBe(adaBefore)
    expect(bo.sends.length).toBe(boBefore)
    expect(ada.prompts).toHaveLength(0)
  })

  it('the same earlier ask at the same ring is not shown twice (a double tap), and a re-ask that still matches nothing leaves no card and no log row', async () => {
    const ada = await phone('Ada', [{ text: 'Cargo bike', audience: Audience.Close }])
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    await bo.net.ask('cargo bike')
    await sleep(W)
    const cards = ada.unmatched
    const logRows = ada.state.log.length
    peerOn(ada, bo).ring = Ring.Friend // still not close: the line stays out
    await ada.net.askAgain(peerOn(ada, bo))
    await until(() => bo.sends.filter((t) => t === 'query').length === 2, 10_000)
    await sleep(2 * W)
    expect(ada.prompts).toHaveLength(0)
    expect(ada.unmatched).toBe(cards)
    expect(ada.state.log.length).toBe(logRows)
    // review 6i: a re-ask that was not shown is not remembered as shown (a later tightening or the button may bring it again)
    expect(liveReaskSeen(ada.state.reaskSeen, Date.now())).toEqual([])
    // now close: it comes back once more, and shows
    peerOn(ada, bo).ring = Ring.Close
    bo.net.askAgainAt?.clear?.() // the per-minute guard is Bo's own; a test does not wait a minute
    await ada.net.askAgain(peerOn(ada, bo))
    await until(() => ada.prompts.length === 1, 10_000)
    expect(ada.prompts[0].earlier).not.toBeNull()
    expect(liveReaskSeen(ada.state.reaskSeen, Date.now())).toHaveLength(1)
  })

  it('a phone that may not re-ask (a demo account, the side-by-side demo) ignores an ask-again', async () => {
    const ada = await phone('Ada', [{ text: 'Drill', audience: Audience.Friends }])
    const bo = await phone('Bo', [], { mayReask: false })
    await connect(bo, ada, Ring.Acquaintance)
    await bo.net.ask('drill')
    await sleep(W)
    const before = bo.sends.length
    peerOn(ada, bo).ring = Ring.Friend
    await ada.net.askAgain(peerOn(ada, bo))
    await sleep(3 * W)
    expect(bo.sends.length).toBe(before)
    expect(ada.prompts).toHaveLength(0)
  })

  it('the marker is accepted from the moment the ask-again leaves, before the relay has answered that send (a re-ask can be faster)', async () => {
    const ada = await phone('Ada')
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    const peer = peerOn(ada, bo)
    const channel = ada.net.channel
    const send = channel.send
    let release
    channel.send = (to, env, key) => (env.t === 'ask-again' ? new Promise((r) => { release = () => r(send(to, env, key)) }) : send(to, env, key))
    const pending = ada.net.askAgain(peer)
    await until(() => typeof release === 'function')
    expect(peer.askAgainSentAt).toBeTypeOf('number') // already accepted while the send is still on its way
    release()
    expect(await pending).toBe(true)
    channel.send = send
  })

  it('an ask-again that cannot leave (no relay) waits on the record and goes on the next connect', async () => {
    const ada = await phone('Ada')
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    const peer = peerOn(ada, bo)
    const channel = ada.net.channel
    ada.net.channel = null
    expect(await ada.net.askAgain(peer)).toBe(false)
    expect(peer.askAgainDue).toBeTypeOf('number')
    ada.net.channel = channel
    await ada.net.flushAskAgain()
    expect(peer.askAgainDue).toBeUndefined()
    expect(ada.sends.filter((t) => t === 'ask-again')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// d) Record lines default to Close friends
// ---------------------------------------------------------------------------

describe('Record lines default to Close friends', () => {
  it('the default is Close friends, a value every build since wave 2 knows', () => {
    expect(RECORD_LINE_AUDIENCE).toBe(Audience.Close)
    expect(AUDIENCES).toContain(RECORD_LINE_AUDIENCE)
  })
  it('every line made on Record, Meeting or Review starts there; the typed General notes line and the memo line stay Only me', () => {
    const main = readFileSync(path.join(HERE, '../../src/main.ts'), 'utf8')
    expect(main.match(/audience: RECORD_LINE_AUDIENCE/g)).toHaveLength(5)
    expect(main).not.toMatch(/audience: Audience\.Friends\b/)
    expect(main).toMatch(/draft\.lines\.unshift\(\{ id: randomId\(8\), text: general, tag: Tag\.Note, audience: Audience\.OnlyMe, typed: true \}\)/)
    expect(main).toMatch(/text: S\.memoLine\(clock\(totalMs\(\)\)\), tag: Tag\.Note, audience: Audience\.OnlyMe/)
  })
  it('the (i) and the walkthrough say so', async () => {
    const { S } = await import('../../src/strings.ts')
    expect(S.cascadeInfo.join(' ')).toMatch(/Lines from a recording or a meeting start as Close friends/)
    expect(readFileSync(path.join(HERE, '../../src/walkthrough.ts'), 'utf8')).toMatch(/start as close friends only/)
  })
  it('a log outcome stays what it was (nothing else changed by the default)', () => {
    expect(Object.values(LogOutcome)).toEqual(['no-match', 'declined', 'shared'])
  })
})
