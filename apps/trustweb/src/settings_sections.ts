// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27: Settings opens on the section of the screen it was opened from, then the other sections in bottom-bar order
 * (left to right), then General, always last. Pure, no DOM.
 */
export type SettingsSection = 'web' | 'chat' | 'record' | 'events' | 'inventory' | 'general'

const OWN: readonly SettingsSection[] = ['web', 'chat', 'record', 'events', 'inventory']

const OF_SCREEN: Record<string, SettingsSection> = {
  web: 'web', people: 'web', still: 'web',
  chat: 'chat',
  record: 'record', meeting: 'record',
  events: 'events',
  inventory: 'inventory',
}

/** The section a screen id (Screen enum value) belongs to; none for Start, Feed and the like. */
export function sectionOfScreen(screen: string): SettingsSection | undefined {
  return OF_SCREEN[screen]
}

/** Section order: `from` (when it has one), the rest as the bottom bar `row` lists them, sections the bar lacks after, General last. */
export function settingsOrder(from: SettingsSection | string | undefined, row: readonly string[]): SettingsSection[] {
  const lead = OWN.find((s) => s === from)
  const bar = row.filter((id): id is SettingsSection => OWN.includes(id as SettingsSection))
  return [...new Set([...(lead ? [lead] : []), ...bar, ...OWN]), 'general']
}
