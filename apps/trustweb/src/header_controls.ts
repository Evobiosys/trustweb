// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 views-header: the controls in the header of Web, People (wave 30: with the search too), Chat, Events and Resources, left to right: search, views (the eye),
 * the pinned buttons, QR, settings (so right to left: settings, QR, pins, views, search). Record keeps its own header. Pure, no DOM.
 */
export type HeaderControl = 'search' | 'views' | 'switch' | 'pins' | 'qr' | 'settings'

const SCREENS = ['web', 'chat', 'people', 'events', 'inventory']

/** The header's controls for a screen id (Screen enum value); undefined = the screen draws its own. */
export function headerControls(screen: string): HeaderControl[] | undefined {
  if (screen === 'chat') return ['search', 'switch', 'pins', 'qr', 'settings'] // wave 29: the messenger switch takes the eye's slot (wave 44c: it sits after the title)
  return SCREENS.includes(screen) ? ['search', 'views', 'pins', 'qr', 'settings'] : undefined
}

/** Wave 44c header-cluster: the top right is one ordered set on every screen, left to right: the eye, search, QR, settings, the AI sparkle (when its extension is on). A screen without eye or search leaves just those out. */
export const HEADER_RIGHT = ['views', 'switch', 'search', 'qr', 'settings', 'ai'] as const // wave44c answers-44c: the chat switch is back in the eye's slot (Jakob 20:22)
export const headerRight = (screen: string, aiOn: boolean): readonly (typeof HEADER_RIGHT)[number][] =>
  HEADER_RIGHT.filter((c) => (c === 'ai' ? aiOn : c === 'qr' || c === 'settings' || (headerControls(screen) ?? []).includes(c)))

/** Wave 44 steer-header-logo: the top left is the same on every header, left to right: the logo (a back arrow on a sub-page), the title, the inbox, the notification bell. */
export const HEADER_LEFT = ['logo', 'title', 'inbox', 'bell'] as const

/** Wave 44c: the controls that sit right after the title in the left cluster (the pins; answers-44c: the chat switch went back top right); there is no tools row. */
export const headerAfterTitle = (screen: string): HeaderControl[] => (headerControls(screen) ?? []).filter((c) => c === 'pins')

/** Wave 33: the settings gear sits in the header of every screen but Start (Meet, Review, Place, hand-over included). */
export const showsSettingsGear = (screen: string): boolean => screen !== 'start'

/** What can sit as a button beneath Settings: Do Not Disturb (unpinned by default; its switch is in Settings > Chat), Advanced settings and "Share QR only". (Wave 40: the select tool left the header again; it is a row of the Web's Tools.) */
export const HEADER_PINS = ['dnd', 'advanced', 'qr-only'] as const
export type HeaderPin = (typeof HEADER_PINS)[number]

/** The stored list (`uiPins.header`); absent = the default, none. */
export function headerPins(stored: readonly string[] | undefined): HeaderPin[] {
  return stored === undefined ? [] : HEADER_PINS.filter((p) => stored.includes(p))
}

export function togglePinned(stored: readonly string[] | undefined, pin: HeaderPin): HeaderPin[] {
  const now = headerPins(stored)
  return HEADER_PINS.filter((p) => (p === pin ? !now.includes(p) : now.includes(p)))
}

/** What the header's QR button shows: the event that is open, else the tag the web is filtered to, else my connect code. */
export function qrTarget(on: { eventOpen: boolean; tag?: string | null }): 'event' | 'tag' | 'web-root' {
  return on.eventOpen ? 'event' : on.tag ? 'tag' : 'web-root'
}

/** The settings key of the Advanced section a settings group draws (see settingsSection in main.ts). */
export function advancedKeyOf(section: string | undefined): string {
  return section === 'web' || section === 'inventory' || section === 'record' ? `advanced-${section}` : 'advanced'
}
