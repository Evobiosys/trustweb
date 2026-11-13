// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 settings-llm-first: ONE declarative table of the settings the record holds. It drives the simple Settings list in the app
 * (settings_page.ts), settings search, and the MCP tools settings_list / settings_get / settings_set / settings_search
 * (apps/mcp/src/settings_tools.ts), so a person and an LLM reach the same switches. Pure: no DOM, no model.ts (node loads this file).
 * `simple` entries show on the short Settings page; the rest sit under Advanced. `action` entries open a screen in the app and have no value.
 * Stored form follows the app: a value equal to the default is removed from the record where the app does so too.
 */
import type { SettingsSection } from './settings_sections.ts'

export type Rec = Record<string, unknown>
export type SettingValue = boolean | string | number
export type SettingType = 'boolean' | 'choice' | 'number' | 'text' | 'action'

export interface SettingDef {
  id: string
  section: SettingsSection
  label: string
  hint?: string
  type: SettingType
  default?: SettingValue
  choices?: readonly string[]
  /** number: inclusive bounds. */
  min?: number
  max?: number
  simple: boolean
  get?: (r: Rec) => SettingValue
  set?: (r: Rec, v: SettingValue) => void
}

const ALL_NOTICES = 'all-notices' // notices.ts
const HEADER_PINS = ['dnd', 'advanced', 'qr-only'] as const // header_controls.ts

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A boolean stored under one key; `dflt` is what an absent key reads as. */
function flag(id: string, section: SettingsSection, label: string, key: string, dflt: boolean, simple: boolean, hint?: string): SettingDef {
  return { id, section, label, ...(hint ? { hint } : {}), type: 'boolean', default: dflt, simple, get: (r) => (typeof r[key] === 'boolean' ? (r[key] as boolean) : dflt), set: (r, v) => { r[key] = v === true } }
}
/** A boolean the app stores only when it differs from the default (key absent = default; else `stored` sits under the key). */
function sparse(id: string, section: SettingsSection, label: string, key: string, dflt: boolean, stored: boolean, hint?: string): SettingDef {
  return { id, section, label, ...(hint ? { hint } : {}), type: 'boolean', default: dflt, simple: false, get: (r) => (r[key] === undefined ? dflt : !dflt), set: (r, v) => { if (v === dflt) delete r[key]; else r[key] = stored } }
}
function choice(id: string, section: SettingsSection, label: string, key: string, choices: readonly string[], dflt: string, hint?: string): SettingDef {
  return { id, section, label, ...(hint ? { hint } : {}), type: 'choice', default: dflt, choices, simple: false, get: (r) => (typeof r[key] === 'string' && choices.includes(r[key] as string) ? (r[key] as string) : dflt), set: (r, v) => { if (v === dflt) delete r[key]; else r[key] = v } }
}
function feature(id: string, key: 'events' | 'inventory', label: string): SettingDef {
  return {
    id, section: key, label, type: 'boolean', default: true, simple: false,
    get: (r) => obj(r.features)[key] !== false,
    set: (r, v) => {
      const f = { ...obj(r.features) }
      if (v) delete f[key]; else f[key] = false
      if (Object.keys(f).length) r.features = f; else delete r.features
    },
  }
}
function pin(id: (typeof HEADER_PINS)[number], label: string, hint: string): SettingDef {
  return {
    id: `pins.header.${id}`, section: 'general', label, hint, type: 'boolean', default: false, simple: false,
    get: (r) => list(obj(r.uiPins).header).includes(id),
    set: (r, v) => {
      const now = list(obj(r.uiPins).header)
      const header = HEADER_PINS.filter((p) => (p === id ? v === true : now.includes(p)))
      r.uiPins = { views: list(obj(r.uiPins).views), header }
    },
  }
}
const action = (id: string, section: SettingsSection, label: string, hint: string): SettingDef => ({ id, section, label, hint, type: 'action', simple: true })

export const SETTINGS_REGISTRY: readonly SettingDef[] = [
  // ---- simple: the short page (booleans here, screens as actions) ----
  action('ui.bar', 'general', 'Views in the bottom bar', 'Which views the bar shows, and in what order.'),
  action('ui.ai', 'general', 'Your AI', 'Switch the AI on or off and pick its provider.'),
  action('ui.appearance', 'general', 'Look, language and theme', 'Default, sleek or dex look; light, dark or system theme.'),
  flag('chats.hidden', 'chat', 'Do not disturb', 'chatsHidden', false, true, 'Hides chats and their notices until you switch it off.'),
  { id: 'notices.on', section: 'general', label: 'Show notices', hint: 'The short notes TrustWeb shows now and then.', type: 'boolean', default: true, simple: true,
    get: (r) => !list(r.dismissed).includes(ALL_NOTICES),
    set: (r, v) => {
      const rest = list(r.dismissed).filter((x) => x !== ALL_NOTICES)
      const next = v ? rest : [...rest, ALL_NOTICES]
      if (next.length) r.dismissed = next; else delete r.dismissed
    } },
  { id: 'feed.on', section: 'general', label: 'Feed', hint: 'The optional Feed view; off unless switched on.', type: 'boolean', default: false, simple: true,
    get: (r) => obj(r.feed).on === true, set: (r, v) => { r.feed = { ...obj(r.feed), on: v === true } } },
  flag('birthdays.reminders', 'events', 'Birthday reminders', 'birthdayReminders', true, true, 'A note on the day a person you know has a birthday.'),
  action('ui.import', 'general', 'Import', 'Bring in contacts and notes from other services.'),
  action('ui.help', 'general', 'Help and about', 'Version, the tutorial, and who built this.'),

  // ---- advanced: everything else the record stores ----
  feature('features.events', 'events', 'Events'),
  feature('features.inventory', 'inventory', 'Resources'),
  flag('web.ringNames', 'web', 'Show ring names on the web', 'showRingNames', false, false, 'Trust zone under each name.'),
  choice('web.queryStyle', 'web', 'How asks read', 'queryStyle', ['call', 'search'], 'call', 'Asks read as a call for help or as a search.'),
  choice('web.pinnedOrder', 'web', 'Pinned order', 'pinnedOrder', ['pinned', 'contact'], 'pinned', 'Newest pin first, or whoever you were last in touch with first.'),
  { id: 'web.engagementDays', section: 'web', label: 'Close ties expire after (days)', hint: '0 = never; a close tie with no contact for this long moves out.', type: 'number', default: 0, min: 0, max: 365, simple: false,
    get: (r) => (typeof r.engagementDays === 'number' && Number.isFinite(r.engagementDays) && r.engagementDays >= 0 ? r.engagementDays : 0),
    set: (r, v) => { const n = Math.min(365, Math.max(0, Math.round(Number(v)))); if (n) r.engagementDays = n; else delete r.engagementDays } },
  { id: 'web.askDirectOnly', section: 'web', label: 'Ask only my direct contacts', type: 'boolean', default: false, simple: false,
    get: (r) => r.askDirectOnly === true, set: (r, v) => { if (v) r.askDirectOnly = true; else delete r.askDirectOnly } },
  sparse('chat.preferConsensual', 'chat', 'Prefer Consensual for chats', 'preferConsensual', true, false, 'The Chat button opens Consensual when you hold the link.'),
  sparse('chat.reachOutsPaused', 'chat', 'Pause reach-outs', 'reachOutsPaused', false, true),
  { id: 'inventory.notesMatch', section: 'inventory', label: 'Let asks match my notes too', hint: 'Meeting notes can answer an ask (never a note that is "Only me").', type: 'boolean', default: true, simple: false,
    get: (r) => (typeof r.asksMatchNotes === 'boolean' ? r.asksMatchNotes : !r.testOf),
    set: (r, v) => { if (v === !r.testOf) delete r.asksMatchNotes; else r.asksMatchNotes = v === true } },
  choice('record.defaultRecording', 'record', 'Record starts as', 'defaultRecording', ['solo', 'meeting'], 'solo', '"solo" is a voice memo; "meeting" asks who and where first.'),
  sparse('general.profileAuto', 'general', 'Share my profile when we connect', 'profileAutoOff', true, true),
  flag('general.qrProfileOption', 'general', 'Offer "profile" on a person\'s QR code', 'qrProfileOption', false, false),
  flag('general.apkUpdates', 'general', 'Check for app updates', 'apkUpdates', true, false, 'Android app only.'),
  flag('general.notificationsOn', 'general', 'Notifications', 'notificationsOn', false, false, 'The app asks the system for permission when you switch it on; here the record only keeps the choice.'),
  sparse('mcp.applyDirectly', 'general', 'MCP applies directly', 'mcpApplyDirectly', false, true, 'Personal preview: what an agent changes through MCP is taken at once, without a card to approve.'),
  pin('dnd', 'Pin Do not disturb to the toolbar', 'A button beneath Settings.'),
  pin('advanced', 'Pin Advanced to the toolbar', 'A button beneath Settings.'),
  pin('qr-only', 'Pin the QR only button to the toolbar', 'A button beneath Settings.'),
]

export const settingById = (id: string): SettingDef | undefined => SETTINGS_REGISTRY.find((s) => s.id === id)

/** Entries with a value, i.e. what settings_get / settings_set reach. */
export const valued = (): SettingDef[] => SETTINGS_REGISTRY.filter((s) => s.type !== 'action')

export function readSetting(r: Rec, id: string): SettingValue {
  const d = settingById(id)
  if (!d?.get) throw new Error(d ? `${id} is an action, not a value: open it in the app` : `unknown setting: ${id}`)
  return d.get(r)
}

/** Validates `v` against the entry's type and applies it; throws a plain message for a bad id or value. */
export function writeSetting(r: Rec, id: string, v: unknown): SettingValue {
  const d = settingById(id)
  if (!d?.set || !d.get) throw new Error(d ? `${id} is an action, not a value: open it in the app` : `unknown setting: ${id}`)
  let val: SettingValue
  if (d.type === 'boolean') { if (typeof v !== 'boolean') throw new Error(`${id} needs true or false`); val = v }
  else if (d.type === 'choice') { if (typeof v !== 'string' || !d.choices?.includes(v)) throw new Error(`${id} needs one of: ${d.choices?.join(', ')}`); val = v }
  else if (d.type === 'number') { if (typeof v !== 'number' || !Number.isFinite(v) || v < (d.min ?? -Infinity) || v > (d.max ?? Infinity)) throw new Error(`${id} needs a number from ${d.min} to ${d.max}`); val = v }
  else { if (typeof v !== 'string') throw new Error(`${id} needs text`); val = v }
  d.set(r, val)
  return d.get(r)
}

/** Entries whose id, label, hint or section contain every word of `q` (accents and case folded). Empty query = all. */
export function searchSettings(q: string): SettingDef[] {
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const words = fold(q).split(/\s+/).filter(Boolean)
  return SETTINGS_REGISTRY.filter((s) => { const t = fold(`${s.id} ${s.label} ${s.hint ?? ''} ${s.section}`); return words.every((w) => t.includes(w)) })
}

/** The record form for the MCP and the tests: the entry without its functions, plus its value when `r` is given. */
export function describeSetting(d: SettingDef, r?: Rec): Record<string, unknown> {
  const { get, set, ...rest } = d
  return { ...rest, ...(r && get && set ? { value: get(r) } : {}) }
}
