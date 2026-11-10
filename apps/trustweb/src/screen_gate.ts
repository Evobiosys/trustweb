// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 review: a part that is switched off (Settings > Features, a profile such as "IYG support only", or the Extensions list) is never
 * shown, whichever way it is reached: bottom row, eye menu, an event link, a button on a card. Its screen falls back to the Web. Pure.
 */
export interface ScreenParts {
  /** featureOn(s, 'events') */
  events: boolean
  /** featureOn(s, 'inventory'): Resources */
  inventory: boolean
  /** featureOn(s, 'feed') */
  feed: boolean
  /** The Resources module (ext registry): Notes hangs under Resources and leaves with the module, not with the older Features switch. */
  resources: boolean
}

const NEEDS: Record<string, (on: ScreenParts) => boolean> = {
  events: (on) => on.events,
  inventory: (on) => on.inventory,
  feed: (on) => on.feed,
  notes: (on) => on.resources,
}

/** The screen to show for `target` (Screen enum values): itself, or 'web' when its part is off. */
export function gateScreen(target: string, on: ScreenParts): string {
  return NEEDS[target]?.(on) === false ? 'web' : target
}
