/** Wave 14: Consensual as a contact channel (channel.ts, contact_share.ts). A DID here is fake. */
import { CONSENSUAL_AGREEMENTS_LINK, channelLink, isConsensualDid, normalizeHandle } from '../../src/channel.ts'
import {
  REQUESTABLE, answerPlan, buildContactPayload, chatOnConsensual, consensualReachable, contactText, defaultShareTick, mayAnswerRequest,
  parseContactText, parseRequestText, requestText,
} from '../../src/contact_share.ts'
import { Channel, Ring } from '../../src/model.ts'

const APP = 'https://app.example.test/'
const DID = 'did:peer:2.Az6MkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.Vz6MkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.EzDnaeBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const LINK = `https://app.consensu.al/connect?to=${DID}`
const C = Channel.Consensual
const norm = (s) => normalizeHandle(C, s)

describe('Consensual address', () => {
  it('stores the share link form from a bare DID, the link, the other host or an encoded DID', () => {
    for (const raw of [DID, LINK, `https://consensual.myceli.al/connect?to=${DID}`, `  ${LINK}  `, `https://app.consensu.al/connect?to=${encodeURIComponent(DID)}`]) {
      expect(norm(raw)).toBe(LINK)
    }
  })
  it('refuses a malformed DID, extra parts, another host, scheme or path', () => {
    for (const bad of [
      'did:peer:2', 'did:peer:3.Az6Mk', 'did:peer:2.Xabc', `${DID} x`, `${LINK}&x=1`, `${LINK}#x`, `${LINK}&to=${DID}`,
      `http://app.consensu.al/connect?to=${DID}`, `https://evil.example/connect?to=${DID}`, `https://app.consensu.al/chat?to=${DID}`,
      `https://app.consensu.al.evil.example/connect?to=${DID}`, `https://app.consensu.al/connect?with=${DID}`, '',
    ]) expect(norm(bad)).toBeNull()
  })
  it('caps a DID at 400 characters', () => {
    const at = (n) => 'did:peer:2.A' + 'a'.repeat(n - 12)
    expect(isConsensualDid(at(400))).toBe(true)
    expect(isConsensualDid(at(401))).toBe(false)
  })
  it('opens their chat page', () => expect(channelLink(C, LINK)).toBe(`https://app.consensu.al/chat?with=${DID}`))
})

describe('Consensual travels only on ask', () => {
  const mine = { [C]: LINK }
  it('is a requestable channel; a request text names it', () => {
    expect(REQUESTABLE).toContain(C)
    expect(parseRequestText(APP, requestText(APP, [Channel.Signal, C]))).toEqual([Channel.Signal, C])
  })
  it('goes only when ticked: untouched settings build nothing; an answer plan auto-sends a ticked one and asks for an unticked one', () => {
    expect(buildContactPayload(APP, mine, undefined)).toBeNull()
    expect(answerPlan(mine, undefined, [C])).toEqual({ auto: [], ask: [C] })
    expect(answerPlan(mine, { shareOnConnect: { [C]: true } }, [C])).toEqual({ auto: [C], ask: [] })
  })
  it('defaults to ticked (no phone number in it) and survives the wire round trip', () => {
    expect(defaultShareTick(C, LINK)).toBe(true)
    const built = buildContactPayload(APP, mine, { shareOnConnect: { [C]: true } })
    expect(parseContactText(APP, contactText(APP, built.payload)).channels).toEqual(mine)
  })
  it('a received value that is no Consensual link is dropped', () => {
    expect(parseContactText(APP, `${APP}?contact=1#consensual=${encodeURIComponent('https://evil.example/')}`)).toBeNull()
  })
  it('a reach-out or Intending-ring person is not answered', () => {
    expect(mayAnswerRequest({ reachOut: true }, { ring: Ring.Acquaintance })).toBe(false)
    expect(mayAnswerRequest({}, { ring: Ring.Intending })).toBe(false)
    expect(mayAnswerRequest({}, { ring: Ring.Acquaintance })).toBe(true)
  })
})

describe('the card button choice', () => {
  const shared = { theirChannels: { [C]: LINK } }
  it('Consensual is primary when known and the setting is not off', () => {
    expect(chatOnConsensual(shared, undefined)?.link).toBe(`https://app.consensu.al/chat?with=${DID}`)
    expect(chatOnConsensual({ channels: { [C]: LINK } }, undefined)?.source).toBe('own')
  })
  it('no Consensual button when unknown or the setting is off; the Agreements link needs only the address', () => {
    expect(chatOnConsensual({}, undefined)).toBeNull()
    expect(chatOnConsensual(shared, false)).toBeNull()
    expect(consensualReachable(shared)).not.toBeNull()
    expect(consensualReachable({})).toBeNull()
  })
  it('names the Consensual proposal page', () => expect(CONSENSUAL_AGREEMENTS_LINK).toBe('https://app.consensu.al/agreements'))
})
