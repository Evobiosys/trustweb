/**
 * Connect AND message (wave 6, U3, owner 2026-10-08: "first connect to
 * TrustWeb and then they are connected to me AND when they click on me have my
 * Signal link there"). When two phones are connected, each side may send the
 * messenger links its owner ticked "share when we connect"; the other phone
 * keeps them on that person's card ("Message on Signal / Molly").
 *
 * Pure and DOM-free so the unit tests import the exact functions the app calls.
 *
 * Wire: ONE short text inside the already encrypted chat envelope of a paired
 * peer (the pattern share.ts uses for meeting links), never inside the
 * cleartext connect-ack:
 *     <app url>?contact=1#signal=<link>&whatsapp=<+number>&wa=<wa.me/qr link>&matrix=<id>
 * `whatsapp` holds a phone number (older builds show it); the wa.me/qr share link travels under its own key `wa`, which an older
 * build drops instead of reading a number out of it. Wave 6e stopped writing the Signal/Molly hint `p=` (it is still read).
 * A build that does not know it shows nothing (share.ts only reads its own
 * prefix), so records stay v:1 and older builds ignore it. Everything received
 * is untrusted: bounded, normalised with channel.ts, stripped of control and
 * bidi characters, unknown keys dropped.
 *
 * NOTHING LEAVES WITHOUT A TICK: with no recorded tick the payload is empty and
 * nothing is built. "Default on" is only the initial state of the tick the
 * owner SEES when he saves a link on the Meet page (defaultShareTick), and only
 * for a username link; a phone number needs his own tick.
 */
import {
  SignalHandleKind, SignalProvider, channelLink, isSignalProvider, isWhatsAppQrLink, normalizeHandle, revealsNumberOn, signalHandleKind,
} from './channel'
import { CHANNELS, Channel, Ring } from './model'
import { stripUnsafe, fingerprint } from './safe_text'

export type ChannelMap = Partial<Record<Channel, string>>

export const CONTACT_PARAM = 'contact'
/** Longest single value accepted or sent (a Delta Chat invite is the longest real one). */
export const CONTACT_VALUE_MAX = 200
/** The whole text must fit the 500 characters of a chat envelope, with room to spare. */
export const CONTACT_TEXT_MAX = 480
const PROVIDER_KEY = 'p'
/** The key of a WhatsApp share-QR link (https://wa.me/qr/<code>): a number goes under `whatsapp`, as before. */
const WHATSAPP_QR_KEY = 'wa'

/** The owner's choices; both fields are optional on the app state and absent in older records. */
export interface ShareSettings {
  /** Explicit ticks per channel: only `true` shares. Absent channel = not ticked. */
  shareOnConnect?: Partial<Record<Channel, boolean>>
  /** Wave 6e: no longer chosen anywhere; still read from older records and ignored. */
  signalProvider?: SignalProvider
}

/** What travels. */
export interface ContactPayload {
  v: 1
  channels: ChannelMap
  signalProvider?: SignalProvider
}

export interface BuiltContact {
  payload: ContactPayload
  /** Ticked channels that did not fit the text bound (never silently dropped: the UI can say so). */
  omitted: Channel[]
}

/**
 * The initial state of the tick beside a contact-box entry: on for a link or id that holds no phone number (a Signal username link,
 * a WhatsApp share-QR link, a Matrix id), never for a phone number. The owner sees the tick and can clear it.
 */
export function defaultShareTick(channel: Channel, handle: string): boolean {
  switch (channel) {
    case Channel.Signal: return signalHandleKind(handle) === SignalHandleKind.UsernameLink
    case Channel.WhatsApp: return isWhatsAppQrLink(handle)
    case Channel.Matrix: return true
    default: return false
  }
}

/** Does this value carry a phone number in a channel where that matters (the box warns before the tick)? Signal and WhatsApp only. */
export function sharesPhoneNumber(channel: Channel, handle: string): boolean {
  return revealsNumberOn(channel, handle)
}

/** The stored ticks, or none when the record holds anything but a plain object there (a corrupted record never throws). */
function tickMap(settings: ShareSettings | undefined): ShareSettings['shareOnConnect'] {
  const t = settings?.shareOnConnect
  return typeof t === 'object' && t !== null && !Array.isArray(t) ? t : undefined
}

export function withTick(settings: ShareSettings | undefined, channel: Channel, on: boolean): ShareSettings {
  return { ...settings, shareOnConnect: { ...tickMap(settings), [channel]: on } }
}

/**
 * Called right after the owner SAVES a value on the Meet page: records the
 * visible default tick once (never over a tick he already set, never for a
 * phone number). A tick given for a username link does not carry over when he
 * replaces it by a phone number: that tick is reset, because the consent was
 * for something that does not reveal his number. `previous` is the value that
 * was saved before this one. Returns the settings unchanged when nothing applies.
 */
export function settleDefaultTick(
  settings: ShareSettings | undefined, channel: Channel, handle: string, previous?: string,
): ShareSettings | undefined {
  const ticks = tickMap(settings)
  if (ticks && channel in ticks) {
    const widened = ticks[channel] === true && sharesPhoneNumber(channel, handle) && !!previous && !sharesPhoneNumber(channel, previous)
    return widened ? withTick(settings, channel, false) : settings
  }
  return defaultShareTick(channel, handle) ? withTick(settings, channel, true) : settings
}

/** A value fit to leave this phone: still a valid handle for its channel, bounded, free of hidden characters. */
function sendable(channel: Channel, value: string | undefined): string | null {
  if (!value) return null
  const clean = cleanValue(value)
  return clean === null ? null : normalizeHandle(channel, clean)
}

function cleanValue(value: string): string | null {
  const clean = stripUnsafe(value).trim()
  return clean === value.trim() && clean.length > 0 && clean.length <= CONTACT_VALUE_MAX ? clean : null
}

/** The channels the owner ticked and has a valid value for, in his channel order. */
export function ticked(mine: ChannelMap | undefined, settings: ShareSettings | undefined): ChannelMap {
  const out: ChannelMap = {}
  for (const ch of CHANNELS) {
    if (settings?.shareOnConnect?.[ch] !== true) continue
    const v = sendable(ch, mine?.[ch])
    if (v) out[ch] = v
  }
  return out
}

/**
 * The contact to send to a newly connected peer, or null when nothing is ticked
 * (or nothing fits). `appUrl` only measures the text bound.
 */
export function buildContactPayload(appUrl: string, mine: ChannelMap | undefined, settings: ShareSettings | undefined): BuiltContact | null {
  const wanted = ticked(mine, settings)
  const channels: ChannelMap = {}
  const omitted: Channel[] = []
  for (const ch of CHANNELS) {
    const v = wanted[ch]
    if (!v) continue
    const trial: ContactPayload = { v: 1, channels: { ...channels, [ch]: v } }
    if (contactText(appUrl, trial).length <= CONTACT_TEXT_MAX) channels[ch] = v
    else omitted.push(ch)
  }
  if (!Object.keys(channels).length) return null
  return { payload: { v: 1, channels }, omitted }
}

/** The wire key of one value: the channel's own name, except a WhatsApp share-QR link (see the header). */
function wireKey(channel: Channel, value: string): string {
  return channel === Channel.WhatsApp && isWhatsAppQrLink(value) ? WHATSAPP_QR_KEY : channel
}

/** The chat text that carries a payload. */
export function contactText(appUrl: string, payload: ContactPayload): string {
  const q = new URLSearchParams()
  for (const ch of CHANNELS) {
    const v = payload.channels[ch]
    if (v) q.set(wireKey(ch, v), v)
  }
  if (payload.signalProvider) q.set(PROVIDER_KEY, payload.signalProvider)
  return `${appUrl}?${CONTACT_PARAM}=1#${q.toString()}`
}

/** True when a chat text is a contact text of this app (it must not show up as a chat message). */
export function isContactText(appUrl: string, text: string): boolean {
  return text.startsWith(`${appUrl}?${CONTACT_PARAM}=1#`)
}

/** Reads a contact text; null for anything that is not one or carries nothing usable. Never throws. */
export function parseContactText(appUrl: string, text: string): ContactPayload | null {
  const prefix = `${appUrl}?${CONTACT_PARAM}=1#`
  if (typeof text !== 'string' || !text.startsWith(prefix) || text.length > CONTACT_TEXT_MAX + 20) return null
  let q: URLSearchParams
  try {
    q = new URLSearchParams(text.slice(prefix.length))
  } catch {
    return null
  }
  const channels: Record<string, string> = Object.fromEntries(CHANNELS.map((ch) => [ch, q.get(ch)]).filter(([, v]) => v !== null))
  const waQr = q.get(WHATSAPP_QR_KEY)
  // wa= (a WhatsApp share-QR link) stands in when there is no usable whatsapp= value: a broken whatsapp= must not hide a valid wa=.
  const waNumber = channels[Channel.WhatsApp]
  if (waQr !== null && (waNumber === undefined || sendable(Channel.WhatsApp, waNumber) === null)) channels[Channel.WhatsApp] = waQr
  const raw: Record<string, unknown> = { v: 1, channels }
  const p = q.get(PROVIDER_KEY)
  if (p !== null) raw.signalProvider = p
  return validateContactPayload(raw)
}

/** The untrusted-input boundary for a payload object: only known channels and a known provider survive. */
export function validateContactPayload(raw: unknown): ContactPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1 || typeof o.channels !== 'object' || o.channels === null) return null
  const given = o.channels as Record<string, unknown>
  const channels: ChannelMap = {}
  for (const ch of CHANNELS) {
    const v = given[ch]
    if (typeof v !== 'string') continue
    const ok = sendable(ch, v)
    if (ok) channels[ch] = ok
  }
  if (!Object.keys(channels).length) return null
  const payload: ContactPayload = { v: 1, channels }
  if (channels[Channel.Signal] && isSignalProvider(o.signalProvider)) payload.signalProvider = o.signalProvider
  return payload
}

export interface ContactToSend {
  text: string
  fingerprint: string
  omitted: Channel[]
  /** What the text carries, to be remembered next to the fingerprint (AppState.contactSentChannels). */
  channels: ChannelMap
}

/**
 * Everything the connect hook needs: the text to send to one peer, or null when
 * nothing is ticked, this exact contact already went to that peer, or what would
 * go is NARROWER than what that peer already holds (a second scan in another mode
 * must not wipe, on an older build that replaces the whole set, what the first one
 * gave). `sentChannels` is what went to that peer before.
 */
export function contactToSend(
  appUrl: string, mine: ChannelMap | undefined, settings: ShareSettings | undefined, sentFingerprint: string | undefined,
  sentChannels?: ChannelMap,
): ContactToSend | null {
  const built = buildContactPayload(appUrl, mine, settings)
  if (!built || !shouldSendContact(sentFingerprint, built.payload)) return null
  if (sentChannels && isNarrower(built.payload.channels, sentChannels)) return null
  return { text: contactText(appUrl, built.payload), fingerprint: contactFingerprint(built.payload), omitted: built.omitted, channels: built.payload.channels }
}

/** True when `next` offers fewer channels than `sent` and every one of them is unchanged: sending it would only take something away. */
export function isNarrower(next: ChannelMap, sent: ChannelMap): boolean {
  const kept = (Object.keys(next) as Channel[])
  return kept.length < Object.keys(sent).length && kept.every((ch) => sent[ch] === next[ch])
}

/** A contact text arrived from a connected peer: stores it on their card. True when the card changed. */
export function receiveContactText(appUrl: string, person: ContactCarrier, text: string, now: number): boolean {
  const payload = parseContactText(appUrl, text)
  return payload ? mergeContact(person, payload, now) : false
}

/** A short stable fingerprint of what would be sent, so the same payload is not sent twice to one peer. */
export function contactFingerprint(payload: ContactPayload): string {
  return fingerprint(contactText('', payload))
}

/** Send when nothing was sent to this peer yet, or what is ticked now differs from what went. */
export function shouldSendContact(sentFingerprint: string | undefined, payload: ContactPayload): boolean {
  return sentFingerprint !== contactFingerprint(payload)
}

/**
 * The optional fields a person record gains (all absent in older records, all
 * ignored by older builds). `channels` is the owner's own typed list and is
 * NEVER written from the wire; what a person shared lands in `theirChannels`.
 */
export interface ContactCarrier {
  channels?: ChannelMap
  theirChannels?: ChannelMap
  theirChannelsAt?: number
}

/**
 * Stores a received payload on a person, channel by channel: a channel in the payload replaces that channel, the others stay (wave 6e:
 * a later scan in another mode carries fewer channels and must not take away what an earlier one gave). Returns false when it changed
 * nothing (idempotent). The Signal/Molly hint of older senders is read by the parser and ignored here.
 */
export function mergeContact(person: ContactCarrier, payload: ContactPayload, now: number): boolean {
  const next: ChannelMap = { ...person.theirChannels, ...payload.channels }
  if (JSON.stringify(person.theirChannels ?? {}) === JSON.stringify(next)) return false
  person.theirChannels = next
  person.theirChannelsAt = now
  return true
}

/** One way to reach a person, ready to show as a link. */
export interface Reachable {
  channel: Channel
  value: string
  link: string
  /** Typed by the owner on the card, or shared by the person when they connected. */
  source: 'own' | 'theirs'
}

/** Every known way to reach a person in the owner's channel order; a value the owner typed wins over a shared one. */
export function reachableChannels(person: ContactCarrier): Reachable[] {
  const out: Reachable[] = []
  for (const ch of CHANNELS) {
    const own = person.channels?.[ch]
    const theirs = person.theirChannels?.[ch]
    const value = own ?? theirs
    if (!value) continue
    out.push({ channel: ch, value, link: channelLink(ch, value), source: own ? 'own' : 'theirs' })
  }
  return out
}

/** Every way to reach a person that THEY shared and the owner has not typed himself: one "Message on ..." button each. */
export function sharedReachables(person: ContactCarrier): Reachable[] {
  return reachableChannels(person).filter((r) => r.source === 'theirs')
}

/**
 * Wave 6h, S3: their Signal link, when one is known (typed by the owner or shared by them), for the icon next to their name. Review 6h:
 * only a signal.me link (what channel.ts stores today); a value an older build kept that points anywhere else draws no icon, so the
 * "Message on Signal" glyph can never open another site.
 */
export function signalReachable(person: ContactCarrier): Reachable | null {
  const r = reachableChannels(person).find((x) => x.channel === Channel.Signal)
  return r && r.link.startsWith('https://signal.me/') ? r : null
}

/** The one link the chat's "Message on ..." points at: Signal first, then the owner's channel order. */
export function primaryReachable(person: ContactCarrier): Reachable | null {
  return reachableChannels(person)[0] ?? null
}

// ---------------------------------------------------------------------------
// Wave 9: asking a connected person for their links
// ---------------------------------------------------------------------------

export const CONTACT_REQ_PARAM = 'contactreq'
/** What a card can ask for: the three channels the contact box saves. */
export const REQUESTABLE: readonly Channel[] = [Channel.Signal, Channel.WhatsApp, Channel.Matrix]
/** A person may be asked again after this long. */
export const REQ_AGAIN_MS = 24 * 60 * 60 * 1000

/** The chat text that asks for these channels: <app url>?contactreq=1#want=signal,whatsapp,matrix. */
export function requestText(appUrl: string, wants: readonly Channel[]): string {
  return `${appUrl}?${CONTACT_REQ_PARAM}=1#want=${wants.join(',')}`
}

/** The channels a request text asks for (known, requestable, no duplicates); null for anything else or an empty ask. Never throws. */
export function parseRequestText(appUrl: string, text: string): Channel[] | null {
  const prefix = `${appUrl}?${CONTACT_REQ_PARAM}=1#`
  if (typeof text !== 'string' || !text.startsWith(prefix) || text.length > CONTACT_TEXT_MAX + 20) return null
  const want = new URLSearchParams(text.slice(prefix.length)).get('want') ?? ''
  const out = REQUESTABLE.filter((ch) => want.split(',').includes(ch))
  return out.length ? out : null
}

export function isRequestText(appUrl: string, text: string): boolean {
  return text.startsWith(`${appUrl}?${CONTACT_REQ_PARAM}=1#`)
}

/** May this person be asked now (never asked, or the last ask is older than REQ_AGAIN_MS)? */
export function mayAskAgain(askedAt: number | undefined, now: number): boolean {
  return askedAt === undefined || now - askedAt >= REQ_AGAIN_MS
}

export interface AnswerPlan {
  /** Saved and ticked: goes out at once. */
  auto: Channel[]
  /** Saved, not ticked: the owner is asked, one by one. */
  ask: Channel[]
}

/** What to do with a request: ticked -> auto, saved but not ticked -> ask, not saved (or not a sendable value) -> nothing. */
export function answerPlan(mine: ChannelMap | undefined, settings: ShareSettings | undefined, wanted: readonly Channel[]): AnswerPlan {
  const auto = wanted.filter((ch) => ticked(mine, settings)[ch])
  const ask = wanted.filter((ch) => !auto.includes(ch) && ticked(mine, withTick(settings, ch, true))[ch])
  return { auto, ask }
}

// A contact text can reach the scanning phone before it has created the card of
// the person who sent it (the card is made after the connect call returns). The
// text is held, bounded, and applied the moment the card exists.
const HELD_MAX = 20

export type HeldContacts = Map<string, string>

export function holdContact(held: HeldContacts, peerId: string, text: string): void {
  held.delete(peerId)
  held.set(peerId, text)
  while (held.size > HELD_MAX) held.delete(held.keys().next().value as string)
}

/** Removes and returns the held text of one peer. */
export function takeContact(held: HeldContacts, peerId: string): string | undefined {
  const text = held.get(peerId)
  held.delete(peerId)
  return text
}

/**
 * Who may be ANSWERED when they ask for my messenger links (Jakob 2026-10-15 22:25): only a connection I made or confirmed myself.
 * Never a reach-out through the public trustweb.one/<name> link, and nobody I still hold on the Intending ring: moving them to a real
 * ring is my deliberate act, and until then a request is dropped, not answered. Links never leave at connect time at all.
 */
export function mayAnswerRequest(peer: { reachOut?: true }, person: { ring: Ring; reachedOut?: 'sent' | 'received' }): boolean {
  return !peer.reachOut && !person.reachedOut && person.ring !== Ring.Intending
}
