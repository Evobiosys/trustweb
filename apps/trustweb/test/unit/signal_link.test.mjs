/**
 * Signal (src/channel.ts, wave 6 U3): what a stored Signal value is,
 * the QR payload and where a code can be scanned. The Signal/Molly label choice went in wave 6e.
 * See DEVLOG wave6/u3_signal_finding.txt for the source-code evidence.
 */
import {
  ScanAdvice, SignalHandleKind, SignalProvider, isSignalProvider, qrPayload,
  revealsPhoneNumber, scanAdvice, signalHandleKind,
} from '../../src/channel.ts'

const USER = 'https://signal.me/#eu/abcDEF123_-xyz'
const PHONE_LINK = 'https://signal.me/#p/+436601234567'

describe('signalHandleKind', () => {
  it('tells the four kinds apart, also for values stored as an href', () => {
    expect(signalHandleKind(USER)).toBe(SignalHandleKind.UsernameLink)
    expect(signalHandleKind(PHONE_LINK)).toBe(SignalHandleKind.PhoneLink)
    expect(signalHandleKind('+436601234567')).toBe(SignalHandleKind.PhoneNumber)
    expect(signalHandleKind('lena.42')).toBe(SignalHandleKind.Other)
    expect(signalHandleKind('')).toBe(SignalHandleKind.Other)
    expect(signalHandleKind('https://signal.me/#xyz')).toBe(SignalHandleKind.Other)
  })
  it('flags a phone number in either shape (the pasted phone link was missed by a leading-plus test)', () => {
    expect(revealsPhoneNumber('+436601234567')).toBe(true)
    expect(revealsPhoneNumber(PHONE_LINK)).toBe(true)
    expect(revealsPhoneNumber(USER)).toBe(false)
    expect(revealsPhoneNumber('lena')).toBe(false)
  })
})

describe('qrPayload', () => {
  it('username link: the https link itself', () => expect(qrPayload(USER)).toBe(USER))
  it('phone number: the https #p/ link', () => expect(qrPayload('+436601234567')).toBe(PHONE_LINK))
  it('phone link: unchanged', () => expect(qrPayload(PHONE_LINK)).toBe(PHONE_LINK))
  it('not a Signal handle: null', () => {
    expect(qrPayload('lena.42')).toBeNull()
    expect(qrPayload('')).toBeNull()
    expect(qrPayload('https://signal.me/#xyz')).toBeNull()
  })
  it('the provider never changes the payload', () => {
    for (const v of [USER, PHONE_LINK, '+436601234567']) {
      expect(qrPayload(v, SignalProvider.Molly)).toBe(qrPayload(v, SignalProvider.Signal))
      expect(qrPayload(v, SignalProvider.Molly)).toBe(qrPayload(v))
    }
  })
  it('never emits sgnl:// (it fails silently without the app), for any input', () => {
    for (const v of [USER, PHONE_LINK, '+436601234567', 'sgnl://signal.me/#eu/abcDEF123']) {
      for (const p of [undefined, SignalProvider.Signal, SignalProvider.Molly]) {
        expect(qrPayload(v, p) ?? '').not.toMatch(/sgnl/i)
      }
    }
  })
  it('trims what it is given', () => expect(qrPayload('  ' + USER + ' ')).toBe(USER))
})

describe('scanAdvice', () => {
  it('a username code scans anywhere, a phone code only with the camera app', () => {
    expect(scanAdvice(USER)).toBe(ScanAdvice.AnyScanner)
    expect(scanAdvice('+436601234567')).toBe(ScanAdvice.CameraAppOnly)
    expect(scanAdvice(PHONE_LINK)).toBe(ScanAdvice.CameraAppOnly)
  })
})

describe('the provider guard (the record field is still read)', () => {
  it('isSignalProvider guards unknown values', () => {
    expect(isSignalProvider('molly')).toBe(true)
    expect(isSignalProvider('whatsapp')).toBe(false)
    expect(isSignalProvider(undefined)).toBe(false)
  })
})
