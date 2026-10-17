/**
 * How the Meet page shares this phone (wave 6e, owner 2026-10-08 16:12: "the combined code for TrustWeb and Signal, and the combined
 * code for TrustWeb and WhatsApp ... three buttons: the primary, the secondary, and one with an arrow down ... I should be able to pin
 * these options ... depending on what I pin first, that should be the first option").
 *
 * Six modes (ShareMode). The three TrustWeb+X modes show ONE QR, the connect link, and differ in what the encrypted contact text
 * carries once a scan is accepted: only channel X, and only if X is saved AND ticked. A mode never widens: a link that is not ticked
 * is sent in no mode. OnlyTrustWeb sends no contact at all. OnlySignal and OnlyWhatsApp draw the messenger's own link instead of the
 * connect link (Advanced only by default).
 *
 * The mode in force and the pins live in the record (AppState.shareMode, AppState.sharePins: optional, record stays v:1, an older
 * build ignores them). Pure and DOM-free; the 6b ConnectMode ids map onto these and are never deleted.
 */
import { qrPayload, revealsNumberOn, whatsAppQrPayload } from './channel'
import { ConnectMode } from './connect_modes'
import { ticked } from './contact_share'
import type { ChannelMap, ShareSettings } from './contact_share'
import { Channel } from './model'

export enum ShareMode {
  TrustWebSignal = 'trustweb-signal',
  TrustWebWhatsApp = 'trustweb-whatsapp',
  TrustWebMatrix = 'trustweb-matrix',
  OnlyTrustWeb = 'only-trustweb',
  /** Advanced only: the QR is the signal.me link. */
  OnlySignal = 'only-signal',
  /** Advanced only: the QR is the wa.me link. */
  OnlyWhatsApp = 'only-whatsapp',
}

/** The order of the Advanced list. */
export const SHARE_MODES: readonly ShareMode[] = [
  ShareMode.TrustWebSignal, ShareMode.TrustWebWhatsApp, ShareMode.TrustWebMatrix, ShareMode.OnlyTrustWeb, ShareMode.OnlySignal, ShareMode.OnlyWhatsApp,
]

/** Older records may hold up to this many pins; none is offered any more. */
export const MAX_PINS = 2

export function isShareMode(v: unknown): v is ShareMode {
  return SHARE_MODES.includes(v as ShareMode)
}

/** The 6b ids: Both -> TrustWebSignal, OnlyMolly -> OnlySignal, OnlyTrustWeb -> OnlyTrustWeb. */
export function fromConnectMode(mode: ConnectMode): ShareMode {
  switch (mode) {
    case ConnectMode.Both: return ShareMode.TrustWebSignal
    case ConnectMode.OnlyMolly: return ShareMode.OnlySignal
    case ConnectMode.OnlyTrustWeb: return ShareMode.OnlyTrustWeb
  }
}

/** The one channel a mode is about (null: OnlyTrustWeb). */
export function channelOf(mode: ShareMode): Channel | null {
  switch (mode) {
    case ShareMode.TrustWebSignal:
    case ShareMode.OnlySignal: return Channel.Signal
    case ShareMode.TrustWebWhatsApp:
    case ShareMode.OnlyWhatsApp: return Channel.WhatsApp
    case ShareMode.TrustWebMatrix: return Channel.Matrix
    case ShareMode.OnlyTrustWeb: return null
  }
}

/** Does the QR hold the messenger's own link instead of the connect link? */
export function isOnlyMessenger(mode: ShareMode): boolean {
  return mode === ShareMode.OnlySignal || mode === ShareMode.OnlyWhatsApp
}

/** May this phone send its ticked links to a newly connected phone, in this mode? OnlyTrustWeb says no. */
export function mayShareContact(mode: ShareMode): boolean {
  return mode !== ShareMode.OnlyTrustWeb
}

/** Is the channel of this mode saved (OnlyTrustWeb needs none)? */
export function modeAvailable(mode: ShareMode, mine: ChannelMap | undefined): boolean {
  const ch = channelOf(mode)
  return ch === null || !!mine?.[ch]
}

// ---------------------------------------------------------------------------
// the row: one mode
// ---------------------------------------------------------------------------

/** The row, in this order; a mode shows once its link is saved (Only TrustWeb always). */
const ROW: readonly ShareMode[] = [
  ShareMode.OnlyTrustWeb, ShareMode.TrustWebSignal, ShareMode.TrustWebWhatsApp, ShareMode.OnlySignal, ShareMode.OnlyWhatsApp,
]

// honey: no Matrix mode in the row until owner decision F (Matrix) says so.
export function defaultModes(mine: ChannelMap | undefined): ShareMode[] {
  return ROW.filter((m) => modeAvailable(m, mine))
}

/** A stored pin list, checked: known modes only, no duplicates, at most MAX_PINS, in order. Never throws. */
export function readPins(raw: unknown): ShareMode[] {
  if (!Array.isArray(raw)) return []
  const out: ShareMode[] = []
  for (const v of raw) if (isShareMode(v) && !out.includes(v)) out.push(v)
  return out.slice(0, MAX_PINS)
}

/** The mode in force: the stored one while it is in the row (its link still saved), else Only TrustWeb. */
export function effectiveMode(stored: unknown, mine: ChannelMap | undefined): ShareMode {
  return defaultModes(mine).find((m) => m === stored) ?? ShareMode.OnlyTrustWeb
}

/** The marker the LONG connect link of TrustWeb + Signal / WhatsApp carries in its fragment: the channel name only, never the handle. */
export function viaFragment(mode: ShareMode): string {
  return mode === ShareMode.TrustWebSignal || mode === ShareMode.TrustWebWhatsApp ? `via=${(channelOf(mode) as Channel).toUpperCase()}` : ''
}

/** The channel a connect link's fragment names with `via=`; null for anything else. */
export function parseVia(hash: string): Channel | null {
  const v = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('via')
  return v === 'SIGNAL' ? Channel.Signal : v === 'WHATSAPP' ? Channel.WhatsApp : null
}

/** Boot repair for the two optional record fields. True when the state changed. Never throws. */
export function repairShareFields(state: { shareMode?: unknown; sharePins?: unknown }): boolean {
  let changed = false
  if (state.shareMode !== undefined && !isShareMode(state.shareMode)) { delete state.shareMode; changed = true }
  if (state.sharePins !== undefined) {
    const clean = readPins(state.sharePins)
    if (JSON.stringify(clean) !== JSON.stringify(state.sharePins)) {
      if (clean.length) state.sharePins = clean
      else delete state.sharePins
      changed = true
    }
  }
  return changed
}

// ---------------------------------------------------------------------------
// what a mode puts into the QR and into the contact text
// ---------------------------------------------------------------------------

function isTicked(mine: ChannelMap | undefined, settings: ShareSettings | undefined, ch: Channel): boolean {
  return !!ticked(mine, settings)[ch]
}

/**
 * What the QR (and Copy, Send, NFC) carries; null when the mode needs a link that is not saved, or that holds a phone number its owner
 * has not ticked (a phone number never leaves without its own tick, in any mode; an NFC tag keeps it for good).
 * `connectLink` is the code link or the long one.
 */
export function modePayload(mode: ShareMode, connectLink: string, mine: ChannelMap | undefined, settings: ShareSettings | undefined): string | null {
  if (!isOnlyMessenger(mode)) return connectLink
  const ch = channelOf(mode) as Channel
  const handle = mine?.[ch]
  if (!handle) return null
  if (revealsNumberOn(ch, handle) && !isTicked(mine, settings, ch)) return null
  return ch === Channel.Signal ? qrPayload(handle) : whatsAppQrPayload(handle)
}

/**
 * The messenger links to hand over when a scan is accepted in this mode: only the channel of the mode, and nothing for OnlyTrustWeb.
 * The tick is still applied afterwards by contact_share.ts (narrowing never widens).
 */
export function narrowMine(mode: ShareMode, mine: ChannelMap | undefined): ChannelMap {
  const ch = channelOf(mode)
  const value = ch ? mine?.[ch] : undefined
  return ch && value ? { [ch]: value } : {}
}

/** Does the code of this mode need the phone's camera app (a phone-number link, which the messengers' own scanners call invalid)? */
export function needsCameraApp(mode: ShareMode, mine: ChannelMap | undefined): boolean {
  if (!isOnlyMessenger(mode)) return false
  const ch = channelOf(mode) as Channel
  const handle = mine?.[ch]
  return !!handle && revealsNumberOn(ch, handle)
}

/** Why the link of the mode is, or is not, handed over by a scan right now: the one plain sentence the Meet page shows. */
export enum ModeSharing {
  /** TrustWeb+X: ticked and saved, so a scan also hands it over. */
  Shared = 'shared',
  /** The link holds a phone number and its tick is off. */
  NumberNotTicked = 'number-not-ticked',
  /** Saved but not ticked (a link that holds no number, unticked). */
  NotTicked = 'not-ticked',
  /** No link saved for the mode's channel. */
  NoLink = 'no-link',
  /** OnlyTrustWeb: this scan shares no messenger link. */
  Off = 'off',
  /** OnlySignal / OnlyWhatsApp with its code drawn: the code is the link itself. */
  LinkOnly = 'link-only',
}

export function modeSharing(mode: ShareMode, mine: ChannelMap | undefined, settings: ShareSettings | undefined): ModeSharing {
  const ch = channelOf(mode)
  if (ch === null) return ModeSharing.Off
  const handle = mine?.[ch]
  if (!handle) return ModeSharing.NoLink
  if (isTicked(mine, settings, ch)) return isOnlyMessenger(mode) ? ModeSharing.LinkOnly : ModeSharing.Shared
  if (revealsNumberOn(ch, handle)) return ModeSharing.NumberNotTicked
  return isOnlyMessenger(mode) ? ModeSharing.LinkOnly : ModeSharing.NotTicked
}
