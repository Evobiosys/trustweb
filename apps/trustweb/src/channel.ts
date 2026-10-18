/**
 * Contact links: turn what a person types (a phone number, a handle, or a
 * pasted link) into one canonical value per messenger, and that value into an
 * https link that opens the messenger's app where it is installed and its web
 * page where it is not. https, not custom schemes: a scheme like sgnl:// fails
 * silently when the app is missing.
 *
 * Linking out only, never embedding a messenger (WoT decision 2026-08-25:
 * "channel-linking OK, embedding never").
 */
import { Channel } from './model'

/** "+43 660 123 4567", "0043 660...", "+43-660-..." -> "+436601234567"; null if not E.164. */
export function toE164(input: string): string | null {
  let s = input.trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null
}

const MATRIX_ID = /^@[a-z0-9._=\-/+]+:[a-z0-9.-]+\.[a-z]{2,}(:\d{1,5})?$/i
const TELEGRAM_USER = /^[a-z][a-z0-9_]{4,31}$/i
const MESSENGER_USER = /^[a-z0-9.]{5,50}$/i
/** An address only: no ? # & = / anywhere, so a value (also one another phone sent) can never carry mailto: parameters such as a prefilled body. */
const EMAIL = /^[^\s@?#&=/]+@[^\s@?#&=/]+\.[a-z]{2,}$/i

function linkOn(input: string, hosts: readonly string[]): URL | null {
  try {
    const u = new URL(input.trim())
    return u.protocol === 'https:' && hosts.includes(u.hostname.toLowerCase()) ? u : null
  } catch {
    return null
  }
}

/** What signal.me accepts after the "#": a username code (#eu/...) or a phone number (#p/+...). */
const SIGNAL_FRAGMENT = /^#(?:eu\/[A-Za-z0-9_\-+/=]{4,200}|p\/\+[1-9]\d{6,14})$/

/** A pasted signal.me link in https or sgnl form -> the https form; null for any other fragment (Signal could not open it). */
function signalLink(input: string): string | null {
  try {
    const u = new URL(input.trim())
    const ok = (u.protocol === 'https:' || u.protocol === 'sgnl:') && u.hostname.toLowerCase() === 'signal.me'
    return ok && SIGNAL_FRAGMENT.test(u.hash) ? `https://signal.me/${u.hash}` : null
  } catch {
    return null
  }
}

function normalizeSignal(raw: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return signalLink(raw)
  return toE164(raw)
}

// ---------------------------------------------------------------------------
// WhatsApp (wave 6e). Two stored shapes, and only these:
//   +436601234567                 a phone number (canonical E.164): the link is https://wa.me/<digits>
//   https://wa.me/qr/<code>       WhatsApp's own share-QR link: it carries NO phone number
//   https://wa.me/message/<code>  WhatsApp Business short link: the same, no phone number
// A wa.me link with a query string, a hash or any other path is no WhatsApp handle at all (nothing a person pastes may smuggle a
// prefilled message or a tracking parameter into a link this phone shows, shares or draws).
// ---------------------------------------------------------------------------

/** The code of a wa.me/qr link: letters and digits only (WhatsApp's own are 13 upper-case characters; the bound is generous). */
const WA_QR_CODE = /^[A-Za-z0-9]{8,40}$/
const WA_QR_PATH = /^\/(qr|message)\/([A-Za-z0-9]{8,40})\/?$/
const WA_NUMBER_PATH = /^\/(\d{7,15})\/?$/

/** True for the canonical stored share-link forms (https://wa.me/qr/<code> or https://wa.me/message/<code>), nothing else. */
export function isWhatsAppQrLink(value: string): boolean {
  const m = /^https:\/\/wa\.me\/(?:qr|message)\/([^/]+)$/.exec(value)
  return m !== null && WA_QR_CODE.test(m[1])
}

function normalizeWhatsApp(raw: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return toE164(raw)
  const link = linkOn(raw, ['wa.me'])
  if (!link || link.search !== '' || link.hash !== '' || /[?#]/.test(raw)) return null
  const qr = WA_QR_PATH.exec(link.pathname)
  if (qr) return `https://wa.me/${qr[1]}/${qr[2]}`
  const digits = WA_NUMBER_PATH.exec(link.pathname)
  return digits ? toE164('+' + digits[1]) : null
}

/**
 * The canonical value to store, or null if the input is not a valid way to
 * reach someone on this channel.
 */
export function normalizeHandle(channel: Channel, input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  switch (channel) {
    case Channel.Signal:
      return normalizeSignal(raw)
    case Channel.WhatsApp:
      return normalizeWhatsApp(raw)
    case Channel.Matrix: {
      const link = linkOn(raw, ['matrix.to'])
      const id = link ? safeDecode(link.hash.replace(/^#\/?/, '')) : raw
      return id !== null && MATRIX_ID.test(id) ? id : null
    }
    case Channel.Delta: {
      const link = linkOn(raw, ['i.delta.chat'])
      if (link && link.hash.length > 1) return link.href
      return EMAIL.test(raw) ? raw.toLowerCase() : null
    }
    case Channel.Telegram: {
      const link = linkOn(raw, ['t.me', 'telegram.me'])
      const part = link ? link.pathname.replace(/^\//, '') : raw.replace(/^@/, '')
      if (part.startsWith('+')) return toE164(part)
      return TELEGRAM_USER.test(part) ? part : toE164(raw)
    }
    case Channel.Messenger: {
      const link = linkOn(raw, ['m.me'])
      const user = link ? link.pathname.replace(/^\//, '') : raw.replace(/^@/, '')
      return MESSENGER_USER.test(user) ? user : null
    }
  }
}

/** decodeURIComponent that never throws: a malformed escape (a typo, or a value another phone sent) is no handle at all. */
function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/** The link that opens this contact in the messenger. */
export function channelLink(channel: Channel, value: string): string {
  switch (channel) {
    case Channel.Signal:
      return value.startsWith('https://') ? value : `https://signal.me/#p/${value}`
    case Channel.WhatsApp:
      return isWhatsAppQrLink(value) ? value : `https://wa.me/${value.replace(/\D/g, '')}`
    case Channel.Matrix:
      return `https://matrix.to/#/${value}`
    case Channel.Delta:
      // A bare address can only become mailto:, which opens Delta Chat only
      // where it is the default mail app; an i.delta.chat invite always does.
      return value.startsWith('https://') ? value : `mailto:${value}`
    case Channel.Telegram:
      return `https://t.me/${value}`
    case Channel.Messenger:
      return `https://m.me/${value}`
  }
}

// ---------------------------------------------------------------------------
// Signal and Molly (wave 6, U3). Both open signal.me links, so the choice
// between them is a LABEL and a hint only. What the QR holds decides where it
// can be scanned: Signal's and Molly's in-app scanner reads username codes
// (#eu/...) only; a phone-number link (#p/...) opens from the camera app or a
// link opener (see DEVLOG wave6/u3_signal_finding.txt).
// ---------------------------------------------------------------------------

/**
 * Which app the owner once named for a Signal entry. Wave 6e removed the choice from every screen ("don't make me choose, most people
 * don't have Molly"): the record field `signalProvider` and a received `p=molly` are still read, and ignored.
 */
export enum SignalProvider {
  Signal = 'signal',
  Molly = 'molly',
}

export const SIGNAL_PROVIDERS: readonly SignalProvider[] = [SignalProvider.Signal, SignalProvider.Molly]

export function isSignalProvider(v: unknown): v is SignalProvider {
  return v === SignalProvider.Signal || v === SignalProvider.Molly
}

/** What a stored Signal value is. Also reads values stored as an https href (a pasted link) and bare numbers. */
export enum SignalHandleKind {
  UsernameLink = 'username-link',
  PhoneLink = 'phone-link',
  PhoneNumber = 'phone-number',
  Other = 'other',
}

export function signalHandleKind(value: string): SignalHandleKind {
  const v = value.trim()
  if (/^https:\/\/signal\.me\/#eu\//i.test(v)) return SignalHandleKind.UsernameLink
  if (/^https:\/\/signal\.me\/#p\/\+/i.test(v)) return SignalHandleKind.PhoneLink
  if (/^\+[1-9]\d{6,14}$/.test(v)) return SignalHandleKind.PhoneNumber
  return SignalHandleKind.Other
}

/** True when the value carries a phone number (a bare number or a #p/ link). */
export function revealsPhoneNumber(value: string): boolean {
  const kind = signalHandleKind(value)
  return kind === SignalHandleKind.PhoneNumber || kind === SignalHandleKind.PhoneLink
}

/**
 * The text to put into the QR of a Signal entry, or null when the entry is not
 * a Signal handle. Always https, never sgnl://: the in-app scanners read the
 * https form, and sgnl:// fails silently where no Signal app is installed.
 * `provider` never changes the payload (both apps use signal.me links).
 */
export function qrPayload(handle: string, provider?: SignalProvider): string | null {
  void provider
  return signalHandleKind(handle) === SignalHandleKind.Other ? null : channelLink(Channel.Signal, handle.trim())
}

/** Where a Signal QR can be scanned. */
export enum ScanAdvice {
  /** Username code: the in-app scanner and the camera app both work. */
  AnyScanner = 'any-scanner',
  /** Phone-number code: the camera app (or a link opener) only; Signal's and Molly's in-app scanner calls it invalid. */
  CameraAppOnly = 'camera-app-only',
}

export function scanAdvice(handle: string): ScanAdvice {
  return revealsPhoneNumber(handle) ? ScanAdvice.CameraAppOnly : ScanAdvice.AnyScanner
}

// ---------------------------------------------------------------------------
// WhatsApp, as a code (wave 6e)
// ---------------------------------------------------------------------------

/** True when a stored WhatsApp value is a phone number (a wa.me/qr share link carries none). */
export function revealsWhatsAppNumber(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value.trim())
}

/** Does this stored value carry a phone number, on the channels where that is a question (Signal, WhatsApp)? */
export function revealsNumberOn(channel: Channel, value: string): boolean {
  if (channel === Channel.Signal) return revealsPhoneNumber(value)
  if (channel === Channel.WhatsApp) return revealsWhatsAppNumber(value)
  return false
}

/** The https link a WhatsApp QR holds (https://wa.me/<digits> or the wa.me/qr share link), or null when the value is no WhatsApp handle. */
export function whatsAppQrPayload(handle: string): string | null {
  const v = handle.trim()
  return revealsWhatsAppNumber(v) || isWhatsAppQrLink(v) ? channelLink(Channel.WhatsApp, v) : null
}
