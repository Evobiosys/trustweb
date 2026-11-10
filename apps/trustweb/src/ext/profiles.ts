// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39: profiles ("Variations" in Settings). A profile = a named set of module switches plus a few UI flags.
 * Stored in AppState.twSettings: `extensions` holds the switches in force now (explicit entries only; absent = the module's default),
 * `byProfile` keeps each profile's switches while another one is active, so leaving and coming back restores the user's own toggles.
 * Pure, no DOM.
 */
export type ProfileId = 'full' | 'iyg-support' | 'reader' | 'note-taker'

export interface TwSettings {
  profile?: ProfileId
  extensions?: Record<string, boolean>
  byProfile?: Partial<Record<ProfileId, Record<string, boolean>>>
}

export interface ProfileDef {
  id: ProfileId
  /** The switches this profile sets (modules it does not name keep their default or the user's toggle). */
  modules: Record<string, boolean>
  /** The Web screen's primary button asks for support instead of asking the web. */
  webPrimary?: 'support'
  /** No add or edit buttons (early version: hides the ask button and the Chat "new chat" button). */
  readOnly?: boolean
  /** The bottom row preset (bottom_bar.ts PROFILES id) applied on choosing it. */
  barPreset?: string
  /** Heading carries the "untested alpha feature" subscript. */
  alpha: true
}

export const TW_PROFILES: readonly ProfileDef[] = [
  { id: 'full', modules: {}, alpha: true },
  { id: 'iyg-support', modules: { resources: false, feed: false, events: false, matches: false, 'feed-view': false, 'events-view': false, 'support-ask': true, 'ai-button': true }, webPrimary: 'support', alpha: true },
  { id: 'reader', modules: { 'support-ask': false }, readOnly: true, alpha: true },
  { id: 'note-taker', modules: {}, barPreset: 'note_taker', alpha: true },
]

export function profileOf(tw: Pick<TwSettings, 'profile'> | undefined): ProfileId {
  return TW_PROFILES.find((p) => p.id === tw?.profile)?.id ?? 'full'
}

export const profileDef = (id: ProfileId): ProfileDef => TW_PROFILES.find((p) => p.id === id) as ProfileDef

export { moduleOff } from '../model'

/** A user's own toggle of one module under the profile in force. */
export function setToggle(tw: TwSettings | undefined, id: string, on: boolean): TwSettings {
  return { ...tw, extensions: { ...tw?.extensions, [id]: on } }
}

/** Makes `to` the profile: the old one's switches are kept, the new one's own saved toggles lay over its profile set. `defaults` names every module (id -> enabledByDefault). */
export function switchProfile(tw: TwSettings | undefined, to: ProfileId, defaults: Record<string, boolean>): TwSettings {
  const from = profileOf(tw)
  if (from === to && tw?.profile === to) return tw
  const byProfile = { ...tw?.byProfile, [from]: { ...tw?.extensions } }
  const own = Object.fromEntries(Object.entries(profileDef(to).modules).filter(([id]) => id in defaults))
  return { profile: to, extensions: { ...own, ...byProfile[to] }, byProfile }
}
