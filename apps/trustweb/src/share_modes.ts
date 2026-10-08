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

/** At most this many modes sit on the Meet row; a third pin is refused. */
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
// the row: pins and defaults
// ---------------------------------------------------------------------------

/**
 * The default order when nothing is pinned: TrustWeb+Signal when a Signal link is saved, then TrustWeb+WhatsApp when a WhatsApp link
 * is saved, then OnlyTrustWeb. The first is the primary button, the next the secondary.
 */
export function defaultModes(mine: ChannelMap | undefined): ShareMode[] {
  return [
    ...(mine?.[Channel.Signal] ? [ShareMode.TrustWebSignal] : []),
    ...(mine?.[Channel.WhatsApp] ? [ShareMode.TrustWebWhatsApp] : []),
    ShareMode.OnlyTrustWeb,
  ]
}

/** A stored pin list, checked: known modes only, no duplicates, at most MAX_PINS, in order. Never throws. */
export function readPins(raw: unknown): ShareMode[] {
  if (!Array.isArray(raw)) return []
  const out: ShareMode[] = []
  for (const v of raw) if (isShareMode(v) && !out.includes(v)) out.push(v)
  return out.slice(0, MAX_PINS)
}

export interface PinResult {
  pins: ShareMode[]
  /** True when a pin was asked for while two are already pinned: nothing changed, the caller says so in plain words. */
  refused: boolean
}

/**
 * Pin or unpin one mode. The first pin is the first button; a second pin the second. Unpinning the first moves the remaining one to the
 * first place. A third pin is refused.
 */
export function togglePin(pins: readonly ShareMode[], mode: ShareMode): PinResult {
  const now = readPins(pins)
  if (now.includes(mode)) return { pins: now.filter((m) => m !== mode), refused: false }
  if (now.length >= MAX_PINS) return { pins: now, refused: true }
  return { pins: [...now, mode], refused: false }
}

/** The modes on the two buttons of the Meet row: the pinned ones in pin order, then the defaults that are not pinned already. */
export function rowModes(pins: unknown, mine: ChannelMap | undefined): ShareMode[] {
  const pinned = readPins(pins)
  const fill = defaultModes(mine).filter((m) => !pinned.includes(m))
  return [...pinned, ...fill].slice(0, MAX_PINS)
}

/**
 * The mode in force: the remembered one while its channel is still saved, else the primary button. A stored value that is not a mode
 * (a newer or damaged record) counts as none.
 */
export function effectiveMode(stored: unknown, pins: unknown, mine: ChannelMap | undefined): ShareMode {
  if (isShareMode(stored) && modeAvailable(stored, mine)) return stored
  return rowModes(pins, mine)[0]
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
