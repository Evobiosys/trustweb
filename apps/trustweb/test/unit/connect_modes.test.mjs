/** The Advanced choice (src/connect_modes.ts, wave 6b): what the QR carries per mode, and that Only TrustWeb shares nothing. */
import {
  ConnectMode, CONNECT_MODES, SignalSharing, isConnectMode, mayShareContact, modePayload, needsCameraApp, signalSharing,
} from '../../src/connect_modes.ts'
import { SignalProvider, revealsPhoneNumber } from '../../src/channel.ts'
import { Channel } from '../../src/model.ts'
import { buildContactPayload, contactToSend, withTick } from '../../src/contact_share.ts'

const CODE_LINK = 'https://app.trustintheweb.org/c/AbCdEfGhIjKlMnOpQrStUv'
const USERNAME = 'https://signal.me/#eu/adaUsernameCode0123456789'
const NUMBER = 'https://signal.me/#p/+4300000000'
const APP = 'https://app.trustintheweb.org/'

describe('modes', () => {
  it('three modes, the unified one first', () => expect(CONNECT_MODES).toEqual([ConnectMode.Both, ConnectMode.OnlyMolly, ConnectMode.OnlyTrustWeb]))
  it('isConnectMode', () => {
    expect(isConnectMode('both')).toBe(true)
    expect(isConnectMode('nope')).toBe(false)
    expect(isConnectMode(undefined)).toBe(false)
  })
})

describe('modePayload', () => {
  it('Both and Only TrustWeb carry the connect link', () => {
    expect(modePayload(ConnectMode.Both, CODE_LINK, USERNAME, true)).toBe(CODE_LINK)
    expect(modePayload(ConnectMode.OnlyTrustWeb, CODE_LINK, USERNAME, true)).toBe(CODE_LINK)
    expect(modePayload(ConnectMode.OnlyTrustWeb, CODE_LINK, undefined, false)).toBe(CODE_LINK)
  })
  it('Only Molly/Signal carries the signal.me https link, never the connect link', () => {
    expect(modePayload(ConnectMode.OnlyMolly, CODE_LINK, USERNAME, true)).toBe(USERNAME)
    expect(modePayload(ConnectMode.OnlyMolly, CODE_LINK, USERNAME, false, SignalProvider.Molly)).toBe(USERNAME)
    expect(modePayload(ConnectMode.OnlyMolly, CODE_LINK, USERNAME, false)).not.toContain('/c/')
  })
  it('Only Molly/Signal without a saved link has no QR (null)', () => expect(modePayload(ConnectMode.OnlyMolly, CODE_LINK, undefined, true)).toBeNull())
  it('never emits an sgnl:// link', () => expect(String(modePayload(ConnectMode.OnlyMolly, CODE_LINK, 'sgnl://signal.me/#eu/abc', true))).not.toMatch(/^sgnl:/))
  it('a phone-number link goes into the Only Signal code only with the owner\'s tick (review 6b)', () => {
    expect(modePayload(ConnectMode.OnlyMolly, CODE_LINK, NUMBER, false)).toBeNull()
    expect(modePayload(ConnectMode.OnlyMolly, CODE_LINK, NUMBER, true)).toMatch(/^https:\/\/signal\.me\/#p\//)
  })
  it('a phone-number code keeps the camera-app note, a username code does not', () => {
    expect(needsCameraApp(ConnectMode.OnlyMolly, NUMBER)).toBe(true)
    expect(needsCameraApp(ConnectMode.OnlyMolly, USERNAME)).toBe(false)
    expect(needsCameraApp(ConnectMode.OnlyMolly, undefined)).toBe(false)
    expect(needsCameraApp(ConnectMode.Both, NUMBER)).toBe(false)
  })
})

describe('Only TrustWeb shares nothing, and touches no tick', () => {
  const mine = { [Channel.Signal]: USERNAME }
  const ticks = withTick(undefined, Channel.Signal, true)
  it('Both may share, Only TrustWeb may not', () => {
    expect(mayShareContact(ConnectMode.Both)).toBe(true)
    expect(mayShareContact(ConnectMode.OnlyMolly)).toBe(true)
    expect(mayShareContact(ConnectMode.OnlyTrustWeb)).toBe(false)
  })
  it('the tick is not read or changed by asking the mode: the settings object stays as it was', () => {
    const before = JSON.stringify(ticks)
    mayShareContact(ConnectMode.OnlyTrustWeb)
    signalSharing(ConnectMode.OnlyTrustWeb, mine, ticks, revealsPhoneNumber)
    expect(JSON.stringify(ticks)).toBe(before)
  })
  it('with the tick on, Both still builds the contact (the gate in main.ts is the mode, the payload code is untouched)', () => {
    expect(contactToSend(APP, mine, ticks, undefined)).not.toBeNull()
    expect(buildContactPayload(APP, mine, ticks)?.payload.channels[Channel.Signal]).toBe(USERNAME)
  })
})

describe('signalSharing: the sentence under the QR', () => {
  const sharing = (mode, mine, settings) => signalSharing(mode, mine, settings, revealsPhoneNumber)
  it('Only TrustWeb: off, whatever is saved or ticked', () => {
    expect(sharing(ConnectMode.OnlyTrustWeb, { [Channel.Signal]: USERNAME }, withTick(undefined, Channel.Signal, true))).toBe(SignalSharing.Off)
    expect(sharing(ConnectMode.OnlyTrustWeb, undefined, undefined)).toBe(SignalSharing.Off)
  })
  it('a ticked username link is shared', () => expect(sharing(ConnectMode.Both, { [Channel.Signal]: USERNAME }, withTick(undefined, Channel.Signal, true))).toBe(SignalSharing.Shared))
  it('a phone-number link is never shared without his own tick, and the page says so', () => {
    expect(sharing(ConnectMode.Both, { [Channel.Signal]: NUMBER }, undefined)).toBe(SignalSharing.NumberNotTicked)
    expect(sharing(ConnectMode.Both, { [Channel.Signal]: NUMBER }, withTick(undefined, Channel.Signal, false))).toBe(SignalSharing.NumberNotTicked)
    expect(sharing(ConnectMode.Both, { [Channel.Signal]: NUMBER }, withTick(undefined, Channel.Signal, true))).toBe(SignalSharing.Shared)
  })
  it('a username link he unticked is not shared', () => expect(sharing(ConnectMode.Both, { [Channel.Signal]: USERNAME }, withTick(undefined, Channel.Signal, false))).toBe(SignalSharing.NotTicked))
  it('no link saved', () => expect(sharing(ConnectMode.Both, {}, undefined)).toBe(SignalSharing.NoLink))
  it('the default mode never overrides the U3 rule: a number is not contact-built without a tick', () => {
    expect(contactToSend(APP, { [Channel.Signal]: NUMBER }, undefined, undefined)).toBeNull()
    expect(contactToSend(APP, { [Channel.Signal]: NUMBER }, withTick(undefined, Channel.Signal, false), undefined)).toBeNull()
  })
})
