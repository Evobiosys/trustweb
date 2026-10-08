/**
 * Connect AND message (src/contact_share.ts, wave 6 U3): nothing leaves
 * without a tick, incoming payloads are validated, the merge is idempotent and
 * never touches the owner's own typed channels.
 */
import {
  CONTACT_TEXT_MAX, CONTACT_VALUE_MAX, buildContactPayload, contactFingerprint, contactText, defaultShareTick, isContactText,
  contactToSend, holdContact, mergeContact, takeContact, parseContactText, receiveContactText, settleDefaultTick, primaryReachable, reachableChannels, shouldSendContact, sharesPhoneNumber, ticked,
  validateContactPayload, withTick, sharedReachables, isNarrower,
} from '../../src/contact_share.ts'
import { SignalProvider } from '../../src/channel.ts'
import { Channel } from '../../src/model.ts'

const APP = 'https://app.example.test/'
const USER = 'https://signal.me/#eu/abcDEF123_-xyz'
const PHONE = '+436601234567'
const WA_NUMBER = '+430000000000'
const WA_QR = 'https://wa.me/qr/ABCDEFGH12345'
const MINE = { [Channel.Signal]: USER, [Channel.Matrix]: '@lena:matrix.org', [Channel.WhatsApp]: '+436609999999' }

describe('nothing leaves without a tick', () => {
  it('no settings at all: nothing is built', () => {
    expect(buildContactPayload(APP, MINE, undefined)).toBeNull()
    expect(buildContactPayload(APP, MINE, {})).toBeNull()
    expect(buildContactPayload(APP, MINE, { shareOnConnect: {} })).toBeNull()
  })
  it('an unticked or false tick shares nothing', () => {
    expect(buildContactPayload(APP, MINE, { shareOnConnect: { [Channel.Signal]: false } })).toBeNull()
    expect(ticked(MINE, { shareOnConnect: { [Channel.Signal]: undefined } })).toEqual({})
  })
  it('only the ticked channel travels, the others stay home', () => {
    const built = buildContactPayload(APP, MINE, { shareOnConnect: { [Channel.Signal]: true } })
    expect(built.payload.channels).toEqual({ [Channel.Signal]: USER })
    expect(contactText(APP, built.payload)).not.toContain('matrix')
    expect(contactText(APP, built.payload)).not.toContain('9999999')
  })
  it('a tick on a channel he has no value for sends nothing', () => {
    expect(buildContactPayload(APP, {}, { shareOnConnect: { [Channel.Signal]: true } })).toBeNull()
  })
  it('a ticked value that is no longer a valid handle is not sent', () => {
    expect(buildContactPayload(APP, { [Channel.Signal]: 'https://signal.me/#junk' }, { shareOnConnect: { [Channel.Signal]: true } })).toBeNull()
  })
  it('a stored Signal/Molly hint is never written to the wire any more (wave 6e), even with Signal ticked', () => {
    const built = buildContactPayload(APP, MINE, { shareOnConnect: { [Channel.Signal]: true }, signalProvider: SignalProvider.Molly })
    expect(built.payload.signalProvider).toBeUndefined()
    expect(contactText(APP, built.payload)).not.toContain('molly')
    expect(contactText(APP, built.payload)).not.toContain('p=')
  })
  it('the tick helpers do not mutate their input', () => {
    const base = { shareOnConnect: { [Channel.Signal]: true } }
    withTick(base, Channel.Matrix, true)
    expect(base).toEqual({ shareOnConnect: { [Channel.Signal]: true } })
  })
})

describe('the default tick', () => {
  it('is on for a link or id that holds no phone number: a Signal username link, a wa.me/qr link, a Matrix id', () => {
    expect(defaultShareTick(Channel.Signal, USER)).toBe(true)
    expect(defaultShareTick(Channel.WhatsApp, WA_QR)).toBe(true)
    expect(defaultShareTick(Channel.Matrix, '@lena:matrix.org')).toBe(true)
  })
  it('is never on for a phone number or phone link', () => {
    expect(defaultShareTick(Channel.Signal, PHONE)).toBe(false)
    expect(defaultShareTick(Channel.Signal, 'https://signal.me/#p/+436601234567')).toBe(false)
    expect(defaultShareTick(Channel.WhatsApp, WA_NUMBER)).toBe(false)
    expect(sharesPhoneNumber(Channel.Signal, PHONE)).toBe(true)
    expect(sharesPhoneNumber(Channel.Signal, USER)).toBe(false)
  })
  it('is off for the channels a scan never shares, and for nonsense', () => {
    expect(defaultShareTick(Channel.Telegram, 'lenaaa')).toBe(false)
    expect(defaultShareTick(Channel.Signal, '')).toBe(false)
  })
  it('a phone number the owner ticked himself does travel', () => {
    const built = buildContactPayload(APP, { [Channel.Signal]: PHONE }, withTick(undefined, Channel.Signal, true))
    expect(built.payload.channels[Channel.Signal]).toBe(PHONE)
  })
})

describe('a WhatsApp phone number needs its own tick, like a Signal one', () => {
  it('sharesPhoneNumber: a number yes, the share-QR link no, Matrix no', () => {
    expect(sharesPhoneNumber(Channel.WhatsApp, WA_NUMBER)).toBe(true)
    expect(sharesPhoneNumber(Channel.WhatsApp, WA_QR)).toBe(false)
    expect(sharesPhoneNumber(Channel.Matrix, '@lena:matrix.org')).toBe(false)
  })
  it('a tick given for a wa.me/qr link is reset when it is replaced by a number', () => {
    const on = { shareOnConnect: { [Channel.WhatsApp]: true } }
    expect(settleDefaultTick(on, Channel.WhatsApp, WA_NUMBER, WA_QR)).toEqual({ shareOnConnect: { [Channel.WhatsApp]: false } })
  })
  it('a number replaced by a number keeps its tick', () => {
    const on = { shareOnConnect: { [Channel.WhatsApp]: true } }
    expect(settleDefaultTick(on, Channel.WhatsApp, '+436609999999', WA_NUMBER)).toBe(on)
  })
  it('saving a number records no tick, saving a share-QR link records the visible default', () => {
    expect(settleDefaultTick(undefined, Channel.WhatsApp, WA_NUMBER)).toBeUndefined()
    expect(settleDefaultTick(undefined, Channel.WhatsApp, WA_QR)).toEqual({ shareOnConnect: { [Channel.WhatsApp]: true } })
  })
})

describe('WhatsApp on the wire', () => {
  const ticks = { shareOnConnect: { [Channel.WhatsApp]: true } }
  it('a number travels under the key an older build reads', () => {
    const built = buildContactPayload(APP, { [Channel.WhatsApp]: WA_NUMBER }, ticks)
    const text = contactText(APP, built.payload)
    expect(text).toContain('whatsapp=')
    expect(text).not.toContain('wa=')
    expect(parseContactText(APP, text).channels).toEqual({ [Channel.WhatsApp]: WA_NUMBER })
  })
  it('a wa.me/qr link travels under its own key, so an older build drops it instead of reading a number out of it', () => {
    const built = buildContactPayload(APP, { [Channel.WhatsApp]: WA_QR }, ticks)
    const text = contactText(APP, built.payload)
    expect(text).toContain('#wa=')
    expect(text).not.toContain('whatsapp=')
    expect(parseContactText(APP, text).channels).toEqual({ [Channel.WhatsApp]: WA_QR })
  })
  it('a broken whatsapp= value does not hide a valid wa= link (review 6e); a valid number still wins', () => {
    const qr = `wa=${encodeURIComponent(WA_QR)}`
    expect(parseContactText(APP, `${APP}?contact=1#whatsapp=junk&${qr}`).channels).toEqual({ [Channel.WhatsApp]: WA_QR })
    expect(parseContactText(APP, `${APP}?contact=1#whatsapp=${encodeURIComponent(WA_NUMBER)}&${qr}`).channels).toEqual({ [Channel.WhatsApp]: WA_NUMBER })
    expect(parseContactText(APP, `${APP}?contact=1#whatsapp=junk&wa=junk`)).toBeNull()
  })
  it('a received wa value is validated with the same normalizer', () => {
    expect(parseContactText(APP, `${APP}?contact=1#wa=${encodeURIComponent('https://wa.me/qr/ABCDEFGH1234?text=hi')}`)).toBeNull()
    expect(parseContactText(APP, `${APP}?contact=1#wa=${encodeURIComponent('https://evil.test/qr/ABCDEFGH1234')}`)).toBeNull()
  })
  it('an unticked WhatsApp number is never sent, whatever else is', () => {
    const built = buildContactPayload(APP, { [Channel.WhatsApp]: WA_NUMBER, [Channel.Matrix]: '@lena:matrix.org' }, { shareOnConnect: { [Channel.Matrix]: true } })
    expect(contactText(APP, built.payload)).not.toContain('whatsapp')
    expect(contactText(APP, built.payload)).not.toContain('4300')
  })
})

describe('text round trip', () => {
  it('builds and reads back the same payload (the Molly hint of the settings is no longer written)', () => {
    const built = buildContactPayload(APP, MINE, { shareOnConnect: { [Channel.Signal]: true, [Channel.Matrix]: true }, signalProvider: SignalProvider.Molly })
    const text = contactText(APP, built.payload)
    expect(text.length).toBeLessThanOrEqual(CONTACT_TEXT_MAX)
    expect(isContactText(APP, text)).toBe(true)
    expect(parseContactText(APP, text)).toEqual(built.payload)
  })
  it('a contact text is not a share link and a share link is not a contact text', () => {
    expect(isContactText(APP, `${APP}?share=1#k=TW1ABCDEFGHIJKLMNOPQRSTUVWXYZ`)).toBe(false)
    expect(isContactText(APP, 'hello')).toBe(false)
  })
  it('an over-long ticked set drops whole channels into `omitted`, never half of one', () => {
    const invite = 'https://i.delta.chat/#' + 'A'.repeat(150) + '&a=lena%40example.org&n=Lena'
    const mine = { [Channel.Signal]: USER, [Channel.Delta]: invite, [Channel.Matrix]: '@lena:matrix.org', [Channel.Telegram]: 'lena_tw' }
    const all = Object.fromEntries(Object.keys(mine).map((k) => [k, true]))
    const longApp = 'https://app.example.test/' + 'x'.repeat(120) + '/'
    const built = buildContactPayload(longApp, mine, { shareOnConnect: all })
    expect(contactText(longApp, built.payload).length).toBeLessThanOrEqual(CONTACT_TEXT_MAX)
    expect(built.omitted.length).toBeGreaterThan(0)
    expect(built.payload.channels[Channel.Signal]).toBe(USER)
    for (const ch of built.omitted) expect(built.payload.channels[ch]).toBeUndefined()
  })
})

describe('incoming payloads are never trusted', () => {
  const frag = (q) => `${APP}?contact=1#${q}`
  it('rejects text that is not a contact text, or too long, or empty', () => {
    expect(parseContactText(APP, 'hello')).toBeNull()
    expect(parseContactText(APP, frag(''))).toBeNull()
    expect(parseContactText(APP, frag('signal=' + 'a'.repeat(600)))).toBeNull()
    expect(parseContactText(APP, undefined)).toBeNull()
  })
  it('drops unknown fields and keeps the valid ones', () => {
    const p = parseContactText(APP, frag(`signal=${encodeURIComponent(USER)}&evil=1&__proto__=x&matrix=%40lena%3Amatrix.org`))
    expect(p).toEqual({ v: 1, channels: { [Channel.Signal]: USER, [Channel.Matrix]: '@lena:matrix.org' } })
  })
  it('refuses a value that is not a valid handle for its channel', () => {
    expect(parseContactText(APP, frag('signal=' + encodeURIComponent('https://evil.example/#eu/abcdef')))).toBeNull()
    expect(parseContactText(APP, frag('signal=' + encodeURIComponent('javascript:alert(1)')))).toBeNull()
    expect(parseContactText(APP, frag('telegram=' + encodeURIComponent('<script>')))).toBeNull()
  })
  it('refuses a value carrying bidi or control characters', () => {
    expect(parseContactText(APP, frag('telegram=' + encodeURIComponent('lena_tw‮')))).toBeNull()
    expect(parseContactText(APP, frag('telegram=' + encodeURIComponent('lena\u0000_tw')))).toBeNull()
  })
  it('refuses a value over the length bound', () => {
    const long = 'https://signal.me/#eu/' + 'a'.repeat(CONTACT_VALUE_MAX)
    expect(validateContactPayload({ v: 1, channels: { signal: long } })).toBeNull()
  })
  it('ignores an unknown provider and a provider without a Signal entry', () => {
    const a = parseContactText(APP, frag(`signal=${encodeURIComponent(USER)}&p=whatsapp`))
    expect(a.signalProvider).toBeUndefined()
    const b = parseContactText(APP, frag(`matrix=%40lena%3Amatrix.org&p=molly`))
    expect(b.signalProvider).toBeUndefined()
  })
  it('validateContactPayload copes with any junk without throwing', () => {
    for (const junk of [null, undefined, 3, 'x', [], {}, { v: 2, channels: {} }, { v: 1 }, { v: 1, channels: null }, { v: 1, channels: { signal: 5 } }]) {
      expect(validateContactPayload(junk)).toBeNull()
    }
  })
})

describe('merging into a person', () => {
  const payload = { v: 1, channels: { [Channel.Signal]: USER }, signalProvider: SignalProvider.Molly }
  it('writes the optional their-fields and never the owner\'s own channels', () => {
    const person = { channels: { [Channel.Signal]: PHONE } }
    expect(mergeContact(person, payload, 1000)).toBe(true)
    expect(person.channels).toEqual({ [Channel.Signal]: PHONE })
    expect(person.theirChannels).toEqual({ [Channel.Signal]: USER })
    expect(person.theirSignalProvider).toBeUndefined()
    expect(person.theirChannelsAt).toBe(1000)
  })
  it('is idempotent: the same payload again changes nothing', () => {
    const person = {}
    mergeContact(person, payload, 1000)
    expect(mergeContact(person, payload, 2000)).toBe(false)
    expect(person.theirChannelsAt).toBe(1000)
  })
  it('a later payload with other channels ADDS them: a narrower scan never takes away what an earlier one gave', () => {
    const person = {}
    mergeContact(person, payload, 1000)
    expect(mergeContact(person, { v: 1, channels: { [Channel.Matrix]: '@lena:matrix.org' } }, 3000)).toBe(true)
    expect(person.theirChannels).toEqual({ [Channel.Signal]: USER, [Channel.Matrix]: '@lena:matrix.org' })
  })
  it('a changed value of one channel replaces that channel only', () => {
    const person = { theirChannels: { [Channel.Signal]: USER, [Channel.Matrix]: '@lena:matrix.org' } }
    const next = 'https://signal.me/#eu/otherCODE1234'
    expect(mergeContact(person, { v: 1, channels: { [Channel.Signal]: next } }, 4000)).toBe(true)
    expect(person.theirChannels).toEqual({ [Channel.Signal]: next, [Channel.Matrix]: '@lena:matrix.org' })
  })
  it('a payload that is a subset of what is held changes nothing', () => {
    const person = { theirChannels: { [Channel.Signal]: USER, [Channel.Matrix]: '@lena:matrix.org' }, theirChannelsAt: 1 }
    expect(mergeContact(person, { v: 1, channels: { [Channel.Matrix]: '@lena:matrix.org' } }, 9)).toBe(false)
    expect(person.theirChannelsAt).toBe(1)
  })
  it('the stored copy is detached from the payload object', () => {
    const person = {}
    mergeContact(person, payload, 1)
    payload.channels[Channel.Signal] = 'changed'
    expect(person.theirChannels[Channel.Signal]).toBe(USER)
    payload.channels[Channel.Signal] = USER
  })
})

describe('what the card shows', () => {
  it('nothing known: no link', () => {
    expect(primaryReachable({})).toBeNull()
    expect(reachableChannels({})).toEqual([])
  })
  it('a shared Signal link becomes "Message on Signal", with no provider', () => {
    const r = primaryReachable({ theirChannels: { [Channel.Signal]: USER } })
    expect(r).toMatchObject({ channel: Channel.Signal, link: USER, source: 'theirs' })
    expect(r.provider).toBeUndefined()
  })
  it('a value the owner typed wins over a shared one', () => {
    const r = primaryReachable({ channels: { [Channel.Signal]: PHONE }, theirChannels: { [Channel.Signal]: USER } })
    expect(r).toMatchObject({ link: 'https://signal.me/#p/+436601234567', source: 'own' })
  })
  it('every shared channel is listed for its own button, WhatsApp by its wa.me link, the share-QR link as it is', () => {
    const list = sharedReachables({ channels: { [Channel.Matrix]: '@a:matrix.org' }, theirChannels: { [Channel.Signal]: USER, [Channel.WhatsApp]: WA_NUMBER, [Channel.Matrix]: '@b:matrix.org' } })
    expect(list.map((r) => r.channel)).toEqual([Channel.Signal, Channel.WhatsApp])
    expect(list[1].link).toBe('https://wa.me/430000000000')
    expect(sharedReachables({ theirChannels: { [Channel.WhatsApp]: WA_QR } })[0].link).toBe(WA_QR)
  })
  it('lists several channels in the owner\'s order, Signal first', () => {
    const list = reachableChannels({ channels: { [Channel.Matrix]: '@a:matrix.org' }, theirChannels: { [Channel.Signal]: USER } })
    expect(list.map((r) => r.channel)).toEqual([Channel.Signal, Channel.Matrix])
  })
})

describe('sending once', () => {
  const p = { v: 1, channels: { [Channel.Signal]: USER } }
  it('sends when nothing went yet, not again for the same payload, again when it changed', () => {
    expect(shouldSendContact(undefined, p)).toBe(true)
    expect(shouldSendContact(contactFingerprint(p), p)).toBe(false)
    expect(shouldSendContact(contactFingerprint(p), { ...p, channels: { ...p.channels, [Channel.Matrix]: '@lena:matrix.org' } })).toBe(true)
  })
})

describe('settleDefaultTick (after the owner saves a value)', () => {
  it('records the visible default once for a username link', () => {
    expect(settleDefaultTick(undefined, Channel.Signal, USER)).toEqual({ shareOnConnect: { [Channel.Signal]: true } })
  })
  it('records nothing for a phone number: that tick is his to set', () => {
    expect(settleDefaultTick(undefined, Channel.Signal, PHONE)).toBeUndefined()
    const s = { signalProvider: SignalProvider.Molly }
    expect(settleDefaultTick(s, Channel.Signal, PHONE)).toBe(s)
  })
  it('never overrides a tick he already set, on or off', () => {
    const off = { shareOnConnect: { [Channel.Signal]: false } }
    expect(settleDefaultTick(off, Channel.Signal, USER)).toBe(off)
    const on = { shareOnConnect: { [Channel.Signal]: true } }
    expect(settleDefaultTick(on, Channel.Signal, PHONE)).toBe(on)
  })
  it('a tick given for a username link is reset when he replaces it by a phone number', () => {
    const on = { shareOnConnect: { [Channel.Signal]: true }, signalProvider: SignalProvider.Molly }
    expect(settleDefaultTick(on, Channel.Signal, PHONE, USER)).toEqual({ shareOnConnect: { [Channel.Signal]: false }, signalProvider: SignalProvider.Molly })
  })
  it('a phone number replaced by another keeps its tick, and a number replaced by a username link keeps it', () => {
    const on = { shareOnConnect: { [Channel.Signal]: true } }
    expect(settleDefaultTick(on, Channel.Signal, '+436609999999', PHONE)).toBe(on)
    expect(settleDefaultTick(on, Channel.Signal, USER, PHONE)).toBe(on)
  })
  it('an unticked setting stays unticked when the value widens, and a first save has no previous value', () => {
    const off = { shareOnConnect: { [Channel.Signal]: false } }
    expect(settleDefaultTick(off, Channel.Signal, PHONE, USER)).toBe(off)
    expect(settleDefaultTick({ shareOnConnect: { [Channel.Signal]: true } }, Channel.Signal, PHONE, undefined)).toEqual({ shareOnConnect: { [Channel.Signal]: true } })
  })
  it('does nothing for a channel that is never shared by a scan', () => {
    expect(settleDefaultTick(undefined, Channel.Telegram, 'lenaaa')).toBeUndefined()
  })
})

describe('contactToSend (the connect hook)', () => {
  const ticks = { shareOnConnect: { [Channel.Signal]: true } }
  it('nothing ticked: nothing to send, whatever is stored', () => {
    expect(contactToSend(APP, MINE, undefined, undefined)).toBeNull()
    expect(contactToSend(APP, MINE, { signalProvider: SignalProvider.Molly }, undefined)).toBeNull()
  })
  it('ticked: the text, its fingerprint and nothing omitted', () => {
    const out = contactToSend(APP, MINE, ticks, undefined)
    expect(out.omitted).toEqual([])
    expect(parseContactText(APP, out.text).channels).toEqual({ [Channel.Signal]: USER })
  })
  it('the same contact is not sent twice to one peer, a changed one is', () => {
    const first = contactToSend(APP, MINE, ticks, undefined)
    expect(contactToSend(APP, MINE, ticks, first.fingerprint)).toBeNull()
    expect(contactToSend(APP, MINE, { shareOnConnect: { ...ticks.shareOnConnect, [Channel.Matrix]: true } }, first.fingerprint)).not.toBeNull()
  })
  it('a narrower contact is not sent over a bigger one that went before (an older build would replace the set)', () => {
    const both = { shareOnConnect: { [Channel.Signal]: true, [Channel.Matrix]: true } }
    const sent = contactToSend(APP, MINE, both, undefined)
    expect(sent.channels).toEqual({ [Channel.Signal]: USER, [Channel.Matrix]: '@lena:matrix.org' })
    expect(contactToSend(APP, MINE, ticks, sent.fingerprint, sent.channels)).toBeNull()
  })
  it('a contact with a changed value or another channel is not "narrower" and goes', () => {
    const sent = { [Channel.Signal]: USER, [Channel.Matrix]: '@lena:matrix.org' }
    expect(isNarrower({ [Channel.Signal]: 'https://signal.me/#eu/changedCODE0000' }, sent)).toBe(false)
    expect(isNarrower({ [Channel.WhatsApp]: WA_NUMBER }, sent)).toBe(false)
    expect(isNarrower({ ...sent }, sent)).toBe(false)
    expect(isNarrower({ [Channel.Matrix]: '@lena:matrix.org' }, sent)).toBe(true)
  })
})

describe('receiveContactText', () => {
  it('stores a valid contact, ignores everything else, and is idempotent', () => {
    const text = contactText(APP, { v: 1, channels: { [Channel.Signal]: USER } })
    const person = {}
    expect(receiveContactText(APP, person, text, 5)).toBe(true)
    expect(person.theirChannels).toEqual({ [Channel.Signal]: USER })
    expect(receiveContactText(APP, person, text, 6)).toBe(false)
    expect(receiveContactText(APP, person, 'hello', 7)).toBe(false)
    expect(receiveContactText(APP, person, `${APP}?contact=1#signal=bad`, 8)).toBe(false)
    expect(person.theirChannels).toEqual({ [Channel.Signal]: USER })
  })
})

describe('held contacts (the text beats the card)', () => {
  it('holds a text until the card exists, then hands it over once', () => {
    const held = new Map()
    holdContact(held, 'p1', 'text-1')
    expect(takeContact(held, 'p1')).toBe('text-1')
    expect(takeContact(held, 'p1')).toBeUndefined()
    expect(takeContact(held, 'nobody')).toBeUndefined()
  })
  it('a newer text from the same peer replaces the older one', () => {
    const held = new Map()
    holdContact(held, 'p1', 'old')
    holdContact(held, 'p1', 'new')
    expect(takeContact(held, 'p1')).toBe('new')
  })
  it('is bounded: the oldest peer falls out', () => {
    const held = new Map()
    for (let i = 0; i < 25; i++) holdContact(held, `p${i}`, 't')
    expect(held.size).toBe(20)
    expect(held.has('p0')).toBe(false)
    expect(held.has('p24')).toBe(true)
  })
})
