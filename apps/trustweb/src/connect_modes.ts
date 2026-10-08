/**
 * The Advanced choice under the Meet page's one QR (wave 6b, owner 2026-10-08: "one unified link and then the dropdown that
 * indicates advanced options and there I can choose only molly or only trustweb"). Three modes; the default is the unified link.
 *
 *   Both          the connect code in the QR; scanning also hands over the Signal link he ticked (contact_share.ts), as in wave 6
 *   OnlyMolly     the QR holds the signal.me https link (channel.ts qrPayload: a username link scans in Signal's and Molly's own scanner,
 *                 a phone-number link only in the phone's camera app); Copy, Send and NFC follow the QR
 *   OnlyTrustWeb  the connect code, and this scan shares no Signal or Matrix link at all: the contact payload is not built, the tick
 *                 is neither read nor changed, nothing is recorded as sent
 *
 * The mode is a choice for the code on screen, not a setting: it lives in memory, starts at Both whenever Meet is opened, and only
 * counts while Meet is on screen (the QR that could be scanned). Pure and DOM-free.
 */
import { SignalProvider, qrPayload, scanAdvice, ScanAdvice } from './channel'
import { Channel } from './model'
import type { ChannelMap, ShareSettings } from './contact_share'
import { ticked } from './contact_share'

export enum ConnectMode {
  Both = 'both',
  OnlyMolly = 'molly',
  OnlyTrustWeb = 'trustweb',
}

export const CONNECT_MODES: readonly ConnectMode[] = [ConnectMode.Both, ConnectMode.OnlyMolly, ConnectMode.OnlyTrustWeb]

export function isConnectMode(v: unknown): v is ConnectMode {
  return CONNECT_MODES.includes(v as ConnectMode)
}

/** The mode in force for what leaves the phone when somebody connects: only the open Meet page's choice counts, otherwise the default. */
export function effectiveMode(mode: ConnectMode, meetOnScreen: boolean): ConnectMode {
  return meetOnScreen ? mode : ConnectMode.Both
}

/** May this phone send its ticked messenger links to a newly connected phone, in this mode? Only TrustWeb says no. */
export function mayShareContact(mode: ConnectMode): boolean {
  return mode !== ConnectMode.OnlyTrustWeb
}

/** What the QR (and Copy, Send, NFC) carries; null when the mode needs a Signal link that is not saved. `connectLink` is the code link or the long one. */
export function modePayload(mode: ConnectMode, connectLink: string, signalHandle: string | undefined, provider?: SignalProvider): string | null {
  if (mode !== ConnectMode.OnlyMolly) return connectLink
  return signalHandle ? qrPayload(signalHandle, provider) : null
}

/** Does the Only Molly/Signal code need the camera app (a phone-number link)? */
export function needsCameraApp(mode: ConnectMode, signalHandle: string | undefined): boolean {
  return mode === ConnectMode.OnlyMolly && !!signalHandle && scanAdvice(signalHandle) === ScanAdvice.CameraAppOnly
}

/** Why the Signal link is, or is not, handed over by a scan right now: the one plain sentence the Meet page shows. */
export enum SignalSharing {
  /** Both: ticked and saved, so a scan also hands it over. */
  Shared = 'shared',
  /** Both: saved but not ticked, and it holds a phone number: needs the owner's own tick. */
  NumberNotTicked = 'number-not-ticked',
  /** Both: saved but not ticked (a username link he unticked, or one saved before ticks existed). */
  NotTicked = 'not-ticked',
  /** Both: no Signal link saved. */
  NoLink = 'no-link',
  /** Only TrustWeb: this scan shares no messenger link. */
  Off = 'off',
}

export function signalSharing(
  mode: ConnectMode, mine: ChannelMap | undefined, settings: ShareSettings | undefined, isNumber: (handle: string) => boolean,
): SignalSharing {
  if (mode === ConnectMode.OnlyTrustWeb) return SignalSharing.Off
  const handle = mine?.[Channel.Signal]
  if (!handle) return SignalSharing.NoLink
  if (ticked(mine, settings)[Channel.Signal]) return SignalSharing.Shared
  return isNumber(handle) ? SignalSharing.NumberNotTicked : SignalSharing.NotTicked
}
