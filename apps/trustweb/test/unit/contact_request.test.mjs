/** Wave 9: asking a connected person for their links (src/contact_share.ts contactreq). Fake values only. */
import {
  CONTACT_REQ_PARAM, CONTACT_TEXT_MAX, REQ_AGAIN_MS, answerPlan, isRequestText, mayAskAgain, parseRequestText, requestText,
} from '../../src/contact_share.ts'
import { mayAnswerRequest } from '../../src/contact_share.ts'
import { Ring } from '../../src/model.ts'
import { routeText, TextKind } from '../../src/chat.ts'
import { Channel } from '../../src/model.ts'

const APP = 'https://app.example.test/'
const USER = 'https://signal.me/#eu/abcDEF123_-xyz'
const WA_QR = 'https://wa.me/qr/ABCDEFGH12345'
const MATRIX = '@lena:matrix.org'
const ALL = { [Channel.Signal]: USER, [Channel.WhatsApp]: WA_QR, [Channel.Matrix]: MATRIX }
const ASK = [Channel.Signal, Channel.WhatsApp, Channel.Matrix]

describe('the request wire', () => {
  it('builds <app>?contactreq=1#want=a,b and reads it back', () => {
    const t = requestText(APP, ASK)
    expect(t).toBe(`${APP}?${CONTACT_REQ_PARAM}=1#want=signal,whatsapp,matrix`)
    expect(isRequestText(APP, t)).toBe(true)
    expect(parseRequestText(APP, t)).toEqual(ASK)
  })
  it('drops unknown keys and channels, duplicates, and keeps the channel order', () => {
    expect(parseRequestText(APP, `${APP}?contactreq=1#want=matrix,evil,signal,signal,telegram&x=1`)).toEqual([Channel.Signal, Channel.Matrix])
  })
  it('null for an empty ask, another prefix, no want, or a text over the bound', () => {
    expect(parseRequestText(APP, `${APP}?contactreq=1#want=`)).toBeNull()
    expect(parseRequestText(APP, `${APP}?contactreq=1#nothing=1`)).toBeNull()
    expect(parseRequestText(APP, `${APP}?contact=1#want=signal`)).toBeNull()
    expect(parseRequestText(APP, 'hello')).toBeNull()
    expect(parseRequestText(APP, `${APP}?contactreq=1#want=signal&pad=${'a'.repeat(CONTACT_TEXT_MAX)}`)).toBeNull()
    expect(parseRequestText(APP, 42)).toBeNull()
  })
  it('routes as a request, never as a chat message; a broken one is ignored', () => {
    expect(routeText(APP, requestText(APP, ASK))).toBe(TextKind.ContactRequest)
    expect(routeText(APP, `${APP}?contactreq=1#want=zzz`)).toBe(TextKind.Ignore)
  })
})

describe('asking again', () => {
  it('free when never asked, waits 24 h after an ask', () => {
    expect(mayAskAgain(undefined, 5)).toBe(true)
    expect(mayAskAgain(1000, 1000 + REQ_AGAIN_MS - 1)).toBe(false)
    expect(mayAskAgain(1000, 1000 + REQ_AGAIN_MS)).toBe(true)
  })
})

describe('the answer plan', () => {
  const tick = (...chs) => ({ shareOnConnect: Object.fromEntries(chs.map((c) => [c, true])) })
  it('ticked -> auto, saved but unticked -> ask, not saved -> nothing', () => {
    expect(answerPlan({ [Channel.Signal]: USER, [Channel.Matrix]: MATRIX }, tick(Channel.Signal), ASK)).toEqual({ auto: [Channel.Signal], ask: [Channel.Matrix] })
  })
  it('only the wanted channels are considered', () => {
    expect(answerPlan(ALL, tick(Channel.Signal, Channel.WhatsApp), [Channel.WhatsApp])).toEqual({ auto: [Channel.WhatsApp], ask: [] })
  })
  it('nothing saved, or no settings: nothing auto', () => {
    expect(answerPlan(undefined, undefined, ASK)).toEqual({ auto: [], ask: [] })
    expect(answerPlan(ALL, undefined, ASK)).toEqual({ auto: [], ask: ASK })
  })
  it('a saved value that is not sendable is not asked about', () => {
    expect(answerPlan({ [Channel.Signal]: 'not a link' }, undefined, [Channel.Signal])).toEqual({ auto: [], ask: [] })
  })
})

describe('mayAnswerRequest: a reach-out or an Intending-ring person is never answered', () => {
  it('refuses reach-out peers, reached-out persons and the Intending ring; allows a confirmed friend', () => {
    expect(mayAnswerRequest({ reachOut: true }, { ring: Ring.Friend })).toBe(false)
    expect(mayAnswerRequest({}, { ring: Ring.Intending })).toBe(false)
    expect(mayAnswerRequest({}, { ring: Ring.Friend, reachedOut: 'received' })).toBe(false)
    expect(mayAnswerRequest({}, { ring: Ring.Acquaintance })).toBe(true)
  })
})
