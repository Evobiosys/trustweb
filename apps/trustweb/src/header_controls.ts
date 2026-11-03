// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 views-header: the controls in the header of Web, People, Chat, Events and Resources, left to right: search, views (the eye),
 * the pinned buttons, QR, settings (so right to left: settings, QR, pins, views, search). Record keeps its own header. Pure, no DOM.
 */
export type HeaderControl = 'search' | 'views' | 'pins' | 'qr' | 'settings'

const SCREENS = ['web', 'chat', 'events', 'inventory']

/** The header's controls for a screen id (Screen enum value); undefined = the screen draws its own. */
export function headerControls(screen: string): HeaderControl[] | undefined {
  if (screen === 'chat') return ['search', 'pins', 'qr', 'settings']
  // Wave 29: People is a view the eye switches to; the page keeps its own search field.
  if (screen === 'people') return ['views', 'pins', 'qr', 'settings']
  return SCREENS.includes(screen) ? ['search', 'views', 'pins', 'qr', 'settings'] : undefined
}

/** What can sit as a button beneath Settings: Do Not Disturb (unpinned by default; its switch is in Settings > Chat), Advanced settings, "Share QR only". */
export const HEADER_PINS = ['dnd', 'advanced', 'qr-only'] as const
export type HeaderPin = (typeof HEADER_PINS)[number]

/** The stored list (`uiPins.header`); absent = the default, nothing pinned. */
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
