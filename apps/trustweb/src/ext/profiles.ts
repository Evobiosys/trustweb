// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39: profiles ("Variations" in Settings). A profile = a named set of module switches plus a few UI flags.
 * Stored in AppState.twSettings: `extensions` holds the switches in force now (explicit entries only; absent = the module's default),
 * `byProfile` keeps each profile's switches while another one is active, so leaving and coming back restores the user's own toggles.
 * Pure, no DOM.
 */
export type BuiltinProfileId = 'full' | 'iyg-support' | 'reader' | 'note-taker'
/** Wave 40 ai-edit-chat: a variation the assistant made (CustomProfile). */
export type CustomProfileId = `custom-${string}`
export type ProfileId = BuiltinProfileId | CustomProfileId

/** Wave 41: the whole-app interface (ext/community_mode): today's shell, or the Community module as the shell. */
export type UiInterface = 'personal' | 'community'

export interface TwSettings {
  profile?: ProfileId
  /** Wave 41: the interface the app opens in, per profile (absent = personal). */
  interfaces?: Partial<Record<ProfileId, UiInterface>>
  extensions?: Record<string, boolean>
  byProfile?: Partial<Record<string, Record<string, boolean>>>
  /** Wave 40: variations made by talking to the assistant, listed under Settings > Variations after the built-in ones. */
  custom?: CustomProfile[]
}

/** Wave 40: a named variation over a built-in profile: its own module switches, a look and a token overlay (html inline style). */
export interface CustomProfile {
  id: CustomProfileId
  name: string
  base: BuiltinProfileId
  modules: Record<string, boolean>
  look?: 'default' | 'sleek' | 'dex'
  tokens?: Record<string, string>
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

export const TW_PROFILES: readonly (ProfileDef & { id: BuiltinProfileId })[] = [
  { id: 'full', modules: {}, alpha: true },
  { id: 'iyg-support', modules: { resources: false, feed: false, events: false, matches: false, 'feed-view': false, 'events-view': false, 'support-ask': true, 'ai-button': true }, webPrimary: 'support', alpha: true },
  { id: 'reader', modules: { 'support-ask': false }, readOnly: true, alpha: true },
  { id: 'note-taker', modules: {}, barPreset: 'note_taker', alpha: true },
]

export function profileOf(tw: Pick<TwSettings, 'profile' | 'custom'> | undefined): ProfileId {
  return allProfiles(tw).find((p) => p.id === tw?.profile)?.id ?? 'full'
}

/** A built-in profile, or a custom variation read over its base (its switches laid over the base's). Unknown: full. */
export function profileDef(id: ProfileId, tw?: Pick<TwSettings, 'custom'>): ProfileDef {
  const c = tw?.custom?.find((x) => x.id === id)
  if (c) { const b = profileDef(c.base); return { ...b, id: c.id, modules: { ...b.modules, ...c.modules } } }
  return TW_PROFILES.find((p) => p.id === id) ?? TW_PROFILES[0]
}

/** Wave 40: the built-in profiles, then the custom variations. */
export const allProfiles = (tw: Pick<TwSettings, 'custom'> | undefined): ProfileDef[] => [...TW_PROFILES, ...(tw?.custom ?? []).map((c) => profileDef(c.id, tw))]

const BUILTIN: readonly BuiltinProfileId[] = ['full', 'iyg-support', 'reader', 'note-taker']
const TOKEN_NAME = /^--[a-z][a-z0-9-]{0,40}$/
/** Plain values only: a colour, a length or a time. No url(), no semicolons or braces, so an overlay can never load or break out. */
const TOKEN_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)|\d{1,4}(\.\d{1,3})?(px|rem|em|ms|%)?)$/i

/** The design-token overlay of a variation: every key a token name, every value plain; throws on anything else. */
export function safeTokens(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('tokens must be an object')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!TOKEN_NAME.test(k)) throw new Error(`not a design token: ${k}`)
    if (typeof v !== 'string' || !TOKEN_VALUE.test(v.trim())) throw new Error(`unsafe value for ${k}`)
    out[k] = v.trim()
  }
  if (Object.keys(out).length > 60) throw new Error('at most 60 tokens')
  return out
}

/** A variation from what the assistant wrote: name, base, module switches (known modules only), look and tokens. Throws with a plain message. */
export function customProfile(raw: Record<string, unknown>, modules: readonly string[]): CustomProfile {
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : ''
  if (!name) throw new Error('name is required')
  if (!(BUILTIN as readonly unknown[]).includes(raw.base)) throw new Error(`base must be one of ${BUILTIN.join(', ')}`)
  const sw: Record<string, boolean> = {}
  if (raw.modules !== undefined) {
    if (!raw.modules || typeof raw.modules !== 'object' || Array.isArray(raw.modules)) throw new Error('modules must be an object')
    for (const [id, on] of Object.entries(raw.modules as Record<string, unknown>)) {
      if (!modules.includes(id)) throw new Error(`unknown module: ${id}`)
      if (typeof on !== 'boolean') throw new Error(`modules.${id} must be true or false`)
      sw[id] = on
    }
  }
  if (raw.look !== undefined && !['default', 'sleek', 'dex'].includes(raw.look as string)) throw new Error('look must be one of default, sleek, dex')
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'variation'
  return {
    id: `custom-${slug}`, name, base: raw.base as BuiltinProfileId, modules: sw,
    ...(raw.look !== undefined ? { look: raw.look as CustomProfile['look'] } : {}),
    ...(raw.tokens !== undefined ? { tokens: safeTokens(raw.tokens) } : {}),
  }
}

/** Lists the variation (one of the same id is replaced). */
export function addCustom(tw: TwSettings | undefined, c: CustomProfile): TwSettings {
  return { ...tw, custom: [...(tw?.custom ?? []).filter((x) => x.id !== c.id), c] }
}

/** Takes the variation off the list; when it is in force, its base takes over. */
export function removeCustom(tw: TwSettings | undefined, id: ProfileId, defaults: Record<string, boolean>): TwSettings {
  const c = tw?.custom?.find((x) => x.id === id)
  const next = tw?.profile === id && c ? switchProfile(tw, c.base, defaults) : { ...tw }
  const { [id]: _gone, ...byProfile } = next.byProfile ?? {}
  return { ...next, byProfile, custom: (next.custom ?? []).filter((x) => x.id !== id) }
}

export { moduleOff } from '../model'

/** A user's own toggle of one module under the profile in force. */
export function setToggle(tw: TwSettings | undefined, id: string, on: boolean): TwSettings {
  return { ...tw, extensions: { ...tw?.extensions, [id]: on } }
}

/** Makes `to` the profile: the old one's switches are kept, the new one's own saved toggles lay over its profile set. `defaults` names every module (id -> enabledByDefault). */
export function switchProfile(tw: TwSettings | undefined, to: ProfileId, defaults: Record<string, boolean>): TwSettings {
  const from = profileOf(tw)
  if (from === to && tw?.profile === to) return tw
  const byProfile: NonNullable<TwSettings['byProfile']> = { ...tw?.byProfile, [from]: { ...tw?.extensions } }
  const own = Object.fromEntries(Object.entries(profileDef(to, tw).modules).filter(([id]) => id in defaults))
  return { ...tw, profile: to, extensions: { ...own, ...byProfile[to] }, byProfile }
}
