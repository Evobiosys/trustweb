/**
 * The share modes (src/share_modes.ts, wave 6e): pins and their order, the default row, the remembered mode and its fallbacks, what
 * the QR carries per mode, what a mode narrows the contact text to, and the boot repair of the two record fields.
 * Fake numbers only.
 */
import {
  MAX_PINS, ModeSharing, SHARE_MODES, ShareMode, channelOf, defaultModes, effectiveMode, isOnlyMessenger, isShareMode, mayShareContact, modeAvailable,
  modePayload, modeSharing, narrowMine, needsCameraApp, readPins, repairShareFields, rowModes, togglePin,
} from '../../src/share_modes.ts'
import { Channel } from '../../src/model.ts'
import { buildContactPayload, contactText, contactToSend, withTick } from '../../src/contact_share.ts'

const CODE_LINK = 'https://app.trustintheweb.org/c/AbCdEfGhIjKlMnOpQrStUv'
const APP = 'https://app.trustintheweb.org/'
const SIGNAL_USER = 'https://signal.me/#eu/adaUsernameCode0123456789'
const SIGNAL_NUMBER = 'https://signal.me/#p/+430000000000'
const WA_NUMBER = '+430000000000'
const WA_QR = 'https://wa.me/qr/ABCDEFGH12345'
const MATRIX = '@lena:matrix.org'
const ALL = { [Channel.Signal]: SIGNAL_USER, [Channel.WhatsApp]: WA_QR, [Channel.Matrix]: MATRIX }
const tick = (...chs) => ({ shareOnConnect: Object.fromEntries(chs.map((c) => [c, true])) })

describe('the modes', () => {
  it('six, TrustWeb+X first', () => {
    expect(SHARE_MODES).toEqual([
      ShareMode.TrustWebSignal, ShareMode.TrustWebWhatsApp, ShareMode.TrustWebMatrix, ShareMode.OnlyTrustWeb, ShareMode.OnlySignal, ShareMode.OnlyWhatsApp,
    ])
  })
  it('isShareMode guards unknown values', () => {
    expect(isShareMode('only-signal')).toBe(true)
    expect(isShareMode('both')).toBe(false)
    expect(isShareMode(undefined)).toBe(false)
    expect(isShareMode(3)).toBe(false)
  })
  it('each mode names its channel, Only TrustWeb none', () => {
    expect(channelOf(ShareMode.TrustWebSignal)).toBe(Channel.Signal)
    expect(channelOf(ShareMode.OnlySignal)).toBe(Channel.Signal)
    expect(channelOf(ShareMode.TrustWebWhatsApp)).toBe(Channel.WhatsApp)
    expect(channelOf(ShareMode.OnlyWhatsApp)).toBe(Channel.WhatsApp)
    expect(channelOf(ShareMode.TrustWebMatrix)).toBe(Channel.Matrix)
    expect(channelOf(ShareMode.OnlyTrustWeb)).toBeNull()
  })
  it('only Only Signal and Only WhatsApp replace the connect link', () => {
    expect(SHARE_MODES.filter(isOnlyMessenger)).toEqual([ShareMode.OnlySignal, ShareMode.OnlyWhatsApp])
  })
  it('modeAvailable: Only TrustWeb always, the others when their link is saved', () => {
    expect(modeAvailable(ShareMode.OnlyTrustWeb, undefined)).toBe(true)
    expect(modeAvailable(ShareMode.TrustWebSignal, {})).toBe(false)
    expect(modeAvailable(ShareMode.TrustWebSignal, ALL)).toBe(true)
    expect(modeAvailable(ShareMode.OnlyWhatsApp, { [Channel.Signal]: SIGNAL_USER })).toBe(false)
  })
})

describe('pins: first pin first, a third refused, unpin promotes', () => {
  it('pin first -> first, pin second -> second', () => {
    let r = togglePin([], ShareMode.TrustWebWhatsApp)
    expect(r).toEqual({ pins: [ShareMode.TrustWebWhatsApp], refused: false })
    r = togglePin(r.pins, ShareMode.TrustWebSignal)
    expect(r.pins).toEqual([ShareMode.TrustWebWhatsApp, ShareMode.TrustWebSignal])
  })
  it('unpin the first -> the still pinned one becomes the first', () => {
    const r = togglePin([ShareMode.TrustWebWhatsApp, ShareMode.TrustWebSignal], ShareMode.TrustWebWhatsApp)
    expect(r.pins).toEqual([ShareMode.TrustWebSignal])
    expect(rowModes(r.pins, ALL)[0]).toBe(ShareMode.TrustWebSignal)
  })
  it('unpin the second leaves the first where it was', () => {
    expect(togglePin([ShareMode.TrustWebWhatsApp, ShareMode.TrustWebSignal], ShareMode.TrustWebSignal).pins).toEqual([ShareMode.TrustWebWhatsApp])
  })
  it('a third pin is refused and changes nothing', () => {
    const two = [ShareMode.TrustWebSignal, ShareMode.OnlyTrustWeb]
    const r = togglePin(two, ShareMode.OnlyWhatsApp)
    expect(r).toEqual({ pins: two, refused: true })
    expect(MAX_PINS).toBe(2)
  })
  it('does not mutate its input', () => {
    const pins = [ShareMode.TrustWebSignal]
    togglePin(pins, ShareMode.OnlyTrustWeb)
    expect(pins).toEqual([ShareMode.TrustWebSignal])
  })
  it('readPins keeps known modes only, no duplicates, at most two, in order; junk gives none', () => {
    expect(readPins(['only-signal', 'nope', 'only-signal', 'only-trustweb', 'trustweb-signal'])).toEqual([ShareMode.OnlySignal, ShareMode.OnlyTrustWeb])
    expect(readPins('only-signal')).toEqual([])
    expect(readPins(undefined)).toEqual([])
    expect(readPins([null, 3, {}])).toEqual([])
  })
})

describe('the row: pinned in pin order, else the default', () => {
  it('default: Signal saved -> TrustWeb+Signal first; WhatsApp saved too -> TrustWeb+WhatsApp second', () => {
    expect(defaultModes({ [Channel.Signal]: SIGNAL_USER, [Channel.WhatsApp]: WA_QR })).toEqual([ShareMode.TrustWebSignal, ShareMode.TrustWebWhatsApp, ShareMode.OnlyTrustWeb])
    expect(rowModes([], { [Channel.Signal]: SIGNAL_USER, [Channel.WhatsApp]: WA_QR })).toEqual([ShareMode.TrustWebSignal, ShareMode.TrustWebWhatsApp])
  })
  it('default: no Signal but WhatsApp -> TrustWeb+WhatsApp, then Only TrustWeb', () => {
    expect(rowModes([], { [Channel.WhatsApp]: WA_NUMBER })).toEqual([ShareMode.TrustWebWhatsApp, ShareMode.OnlyTrustWeb])
  })
  it('default: Signal only -> TrustWeb+Signal, then Only TrustWeb', () => {
    expect(rowModes([], { [Channel.Signal]: SIGNAL_USER })).toEqual([ShareMode.TrustWebSignal, ShareMode.OnlyTrustWeb])
  })
  it('default: nothing saved -> Only TrustWeb alone (no secondary)', () => {
    expect(rowModes([], {})).toEqual([ShareMode.OnlyTrustWeb])
    expect(rowModes(undefined, undefined)).toEqual([ShareMode.OnlyTrustWeb])
  })
  it('two pins are the row, whatever is saved', () => {
    expect(rowModes([ShareMode.OnlyWhatsApp, ShareMode.TrustWebMatrix], ALL)).toEqual([ShareMode.OnlyWhatsApp, ShareMode.TrustWebMatrix])
  })
  it('one pin comes first and the next default that differs fills the second place', () => {
    expect(rowModes([ShareMode.TrustWebWhatsApp], ALL)).toEqual([ShareMode.TrustWebWhatsApp, ShareMode.TrustWebSignal])
    expect(rowModes([ShareMode.TrustWebSignal], ALL)).toEqual([ShareMode.TrustWebSignal, ShareMode.TrustWebWhatsApp])
    expect(rowModes([ShareMode.OnlySignal], {})).toEqual([ShareMode.OnlySignal, ShareMode.OnlyTrustWeb])
  })
  it('a damaged pin list reads as no pins', () => expect(rowModes('junk', ALL)).toEqual(rowModes([], ALL)))
})

describe('the remembered mode', () => {
  it('nothing stored -> the primary button', () => {
    expect(effectiveMode(undefined, [], ALL)).toBe(ShareMode.TrustWebSignal)
    expect(effectiveMode(undefined, [ShareMode.TrustWebWhatsApp], ALL)).toBe(ShareMode.TrustWebWhatsApp)
  })
  it('a stored mode wins while its link is saved, also when it is not one of the two buttons', () => {
    expect(effectiveMode(ShareMode.TrustWebWhatsApp, [], ALL)).toBe(ShareMode.TrustWebWhatsApp)
    expect(effectiveMode(ShareMode.OnlySignal, [], ALL)).toBe(ShareMode.OnlySignal)
    expect(effectiveMode(ShareMode.OnlyTrustWeb, [], ALL)).toBe(ShareMode.OnlyTrustWeb)
  })
  it('a stored mode whose link was removed falls back to the default', () => {
    expect(effectiveMode(ShareMode.TrustWebWhatsApp, [], { [Channel.Signal]: SIGNAL_USER })).toBe(ShareMode.TrustWebSignal)
    expect(effectiveMode(ShareMode.OnlySignal, [], {})).toBe(ShareMode.OnlyTrustWeb)
  })
  it('an unknown stored value (a newer or damaged record) counts as none', () => {
    expect(effectiveMode('both', [], ALL)).toBe(ShareMode.TrustWebSignal)
    expect(effectiveMode(42, [], {})).toBe(ShareMode.OnlyTrustWeb)
  })
})

describe('repairShareFields (boot migration, never throws)', () => {
  it('a good record is untouched', () => {
    const s = { shareMode: ShareMode.OnlySignal, sharePins: [ShareMode.TrustWebSignal] }
    expect(repairShareFields(s)).toBe(false)
    expect(s).toEqual({ shareMode: ShareMode.OnlySignal, sharePins: [ShareMode.TrustWebSignal] })
  })
  it('an old record without the fields is untouched', () => {
    const s = {}
    expect(repairShareFields(s)).toBe(false)
    expect(s).toEqual({})
  })
  it('an unknown mode is dropped, a pin list is cleaned to known, unique, at most two', () => {
    const s = { shareMode: 'both', sharePins: ['only-signal', 'x', 'only-signal', 'trustweb-signal', 'only-trustweb'] }
    expect(repairShareFields(s)).toBe(true)
    expect(s).toEqual({ sharePins: [ShareMode.OnlySignal, ShareMode.TrustWebSignal] })
  })
  it('junk values are removed, not thrown on', () => {
    for (const junk of [null, 5, 'x', {}, [], [1, 2]]) {
      const s = { shareMode: junk, sharePins: junk }
      expect(() => repairShareFields(s)).not.toThrow()
      expect(isShareMode(s.shareMode)).toBe(false)
      expect(s.sharePins === undefined || Array.isArray(s.sharePins)).toBe(true)
    }
  })
  it('is idempotent', () => {
    const s = { shareMode: 7, sharePins: ['nope'] }
    repairShareFields(s)
    expect(repairShareFields(s)).toBe(false)
  })
})

describe('modePayload: what the QR carries', () => {
  it('the three TrustWeb+X modes and Only TrustWeb carry the same connect link', () => {
    for (const m of [ShareMode.TrustWebSignal, ShareMode.TrustWebWhatsApp, ShareMode.TrustWebMatrix, ShareMode.OnlyTrustWeb]) {
      expect(modePayload(m, CODE_LINK, ALL, undefined)).toBe(CODE_LINK)
      expect(modePayload(m, CODE_LINK, undefined, undefined)).toBe(CODE_LINK)
    }
  })
  it('Only Signal: the signal.me https link, never the connect link, never sgnl://', () => {
    expect(modePayload(ShareMode.OnlySignal, CODE_LINK, ALL, tick(Channel.Signal))).toBe(SIGNAL_USER)
    expect(modePayload(ShareMode.OnlySignal, CODE_LINK, { [Channel.Signal]: 'sgnl://signal.me/#eu/abcdef123456' }, undefined)).toBeNull()
    expect(modePayload(ShareMode.OnlySignal, CODE_LINK, ALL, undefined)).not.toContain('/c/')
  })
  it('Only WhatsApp: the wa.me/qr link as it is, a number as wa.me/<digits>', () => {
    expect(modePayload(ShareMode.OnlyWhatsApp, CODE_LINK, { [Channel.WhatsApp]: WA_QR }, undefined)).toBe(WA_QR)
    expect(modePayload(ShareMode.OnlyWhatsApp, CODE_LINK, { [Channel.WhatsApp]: WA_NUMBER }, tick(Channel.WhatsApp))).toBe('https://wa.me/430000000000')
  })
  it('a phone number goes into an Only-X code only with its own tick, in Signal and in WhatsApp', () => {
    expect(modePayload(ShareMode.OnlySignal, CODE_LINK, { [Channel.Signal]: SIGNAL_NUMBER }, undefined)).toBeNull()
    expect(modePayload(ShareMode.OnlySignal, CODE_LINK, { [Channel.Signal]: SIGNAL_NUMBER }, { shareOnConnect: { [Channel.Signal]: false } })).toBeNull()
    expect(modePayload(ShareMode.OnlySignal, CODE_LINK, { [Channel.Signal]: SIGNAL_NUMBER }, tick(Channel.Signal))).toMatch(/^https:\/\/signal\.me\/#p\//)
    expect(modePayload(ShareMode.OnlyWhatsApp, CODE_LINK, { [Channel.WhatsApp]: WA_NUMBER }, undefined)).toBeNull()
    expect(modePayload(ShareMode.OnlyWhatsApp, CODE_LINK, { [Channel.WhatsApp]: WA_NUMBER }, tick(Channel.WhatsApp))).toBe('https://wa.me/430000000000')
  })
  it('an Only-X mode with no saved link has no QR', () => {
    expect(modePayload(ShareMode.OnlySignal, CODE_LINK, {}, undefined)).toBeNull()
    expect(modePayload(ShareMode.OnlyWhatsApp, CODE_LINK, { [Channel.Signal]: SIGNAL_USER }, undefined)).toBeNull()
  })
  it('the camera-app note: a phone-number code, not a link without a number', () => {
    expect(needsCameraApp(ShareMode.OnlySignal, { [Channel.Signal]: SIGNAL_NUMBER })).toBe(true)
    expect(needsCameraApp(ShareMode.OnlyWhatsApp, { [Channel.WhatsApp]: WA_NUMBER })).toBe(true)
    expect(needsCameraApp(ShareMode.OnlySignal, { [Channel.Signal]: SIGNAL_USER })).toBe(false)
    expect(needsCameraApp(ShareMode.OnlyWhatsApp, { [Channel.WhatsApp]: WA_QR })).toBe(false)
    expect(needsCameraApp(ShareMode.TrustWebSignal, { [Channel.Signal]: SIGNAL_NUMBER })).toBe(false)
    expect(needsCameraApp(ShareMode.OnlySignal, undefined)).toBe(false)
  })
})

describe('the mode NARROWS the contact text, never widens it', () => {
  const all = tick(Channel.Signal, Channel.WhatsApp, Channel.Matrix)
  const sent = (mode, mine, settings) => {
    const out = contactToSend(APP, narrowMine(mode, mine), settings, undefined)
    return out ? Object.keys(out.channels).sort() : []
  }
  it('TrustWeb+Signal sends the Signal link only, WhatsApp the WhatsApp link only, Matrix the Matrix id only', () => {
    expect(sent(ShareMode.TrustWebSignal, ALL, all)).toEqual(['signal'])
    expect(sent(ShareMode.TrustWebWhatsApp, ALL, all)).toEqual(['whatsapp'])
    expect(sent(ShareMode.TrustWebMatrix, ALL, all)).toEqual(['matrix'])
  })
  it('Only Signal / Only WhatsApp also narrow to their channel (a TrustWeb ack can still arrive from an old tag)', () => {
    expect(sent(ShareMode.OnlySignal, ALL, all)).toEqual(['signal'])
    expect(sent(ShareMode.OnlyWhatsApp, ALL, all)).toEqual(['whatsapp'])
  })
  it('Only TrustWeb sends nothing, and may not share', () => {
    expect(narrowMine(ShareMode.OnlyTrustWeb, ALL)).toEqual({})
    expect(sent(ShareMode.OnlyTrustWeb, ALL, all)).toEqual([])
    expect(mayShareContact(ShareMode.OnlyTrustWeb)).toBe(false)
    for (const m of SHARE_MODES.filter((x) => x !== ShareMode.OnlyTrustWeb)) expect(mayShareContact(m)).toBe(true)
  })
  it('a channel that is not ticked is sent in no mode', () => {
    for (const m of SHARE_MODES) expect(sent(m, ALL, tick(Channel.Matrix))).toEqual(m === ShareMode.TrustWebMatrix ? ['matrix'] : [])
    for (const m of SHARE_MODES) expect(sent(m, ALL, undefined)).toEqual([])
    for (const m of SHARE_MODES) expect(sent(m, ALL, { shareOnConnect: { [Channel.Signal]: false, [Channel.WhatsApp]: false, [Channel.Matrix]: false } })).toEqual([])
  })
  it('a mode whose link is missing sends nothing', () => {
    expect(sent(ShareMode.TrustWebWhatsApp, { [Channel.Signal]: SIGNAL_USER }, all)).toEqual([])
  })
  it('a WhatsApp number is sent in the WhatsApp mode only with its own tick', () => {
    const mine = { [Channel.WhatsApp]: WA_NUMBER }
    expect(sent(ShareMode.TrustWebWhatsApp, mine, undefined)).toEqual([])
    expect(sent(ShareMode.TrustWebWhatsApp, mine, tick(Channel.WhatsApp))).toEqual(['whatsapp'])
    expect(contactText(APP, buildContactPayload(APP, narrowMine(ShareMode.TrustWebWhatsApp, mine), tick(Channel.WhatsApp)).payload)).toContain('whatsapp=')
  })
  it('narrowing does not mutate the owner\'s map', () => {
    const mine = { ...ALL }
    narrowMine(ShareMode.TrustWebSignal, mine)
    expect(mine).toEqual(ALL)
  })
})

describe('modeSharing: the sentence under the QR', () => {
  it('Only TrustWeb: off, whatever is saved or ticked', () => {
    expect(modeSharing(ShareMode.OnlyTrustWeb, ALL, tick(Channel.Signal))).toBe(ModeSharing.Off)
    expect(modeSharing(ShareMode.OnlyTrustWeb, undefined, undefined)).toBe(ModeSharing.Off)
  })
  it('TrustWeb+X: shared when ticked, not ticked, number not ticked, no link', () => {
    expect(modeSharing(ShareMode.TrustWebSignal, ALL, tick(Channel.Signal))).toBe(ModeSharing.Shared)
    expect(modeSharing(ShareMode.TrustWebSignal, ALL, withTick(undefined, Channel.Signal, false))).toBe(ModeSharing.NotTicked)
    expect(modeSharing(ShareMode.TrustWebSignal, { [Channel.Signal]: SIGNAL_NUMBER }, undefined)).toBe(ModeSharing.NumberNotTicked)
    expect(modeSharing(ShareMode.TrustWebWhatsApp, { [Channel.WhatsApp]: WA_NUMBER }, undefined)).toBe(ModeSharing.NumberNotTicked)
    expect(modeSharing(ShareMode.TrustWebWhatsApp, { [Channel.WhatsApp]: WA_NUMBER }, tick(Channel.WhatsApp))).toBe(ModeSharing.Shared)
    expect(modeSharing(ShareMode.TrustWebMatrix, {}, undefined)).toBe(ModeSharing.NoLink)
  })
  it('Only-X: the code is the link itself, unless a number still waits for its tick', () => {
    expect(modeSharing(ShareMode.OnlySignal, ALL, tick(Channel.Signal))).toBe(ModeSharing.LinkOnly)
    expect(modeSharing(ShareMode.OnlyWhatsApp, { [Channel.WhatsApp]: WA_QR }, undefined)).toBe(ModeSharing.LinkOnly)
    expect(modeSharing(ShareMode.OnlyWhatsApp, { [Channel.WhatsApp]: WA_NUMBER }, undefined)).toBe(ModeSharing.NumberNotTicked)
    expect(modeSharing(ShareMode.OnlySignal, {}, undefined)).toBe(ModeSharing.NoLink)
  })
  it('asking never changes the settings object', () => {
    const t = tick(Channel.Signal)
    const before = JSON.stringify(t)
    modeSharing(ShareMode.TrustWebSignal, ALL, t)
    expect(JSON.stringify(t)).toBe(before)
  })
})
