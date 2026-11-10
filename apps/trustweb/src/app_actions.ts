// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: TrustWeb's own actions in the registry (actions.ts): people (ring, tags, fields, the only-me note, a group tag),
 * import rows before Accept (tags, ring, note, accept, leave), places ("bring me there"), a tap on the page, settings, look, profile,
 * extensions and new variations. Every one is undoable except the tap. The host (main.ts) does what needs the screen; the rules here
 * stay pure, so the tests run them on a synthetic record.
 */
import { bool, oneOf, str, type Actions } from './actions'
import type { ColourTag } from './colour_tags'
import { addCustom, customProfile, removeCustom, type ProfileId, type TwSettings } from './ext/profiles'
import { setGeneralNote, generalNoteOf } from './general_notes'
import { bulkAddLabels, bulkAppendNote, normalizeName, tagSlug } from './import_curate'
import type { Look } from './look'
import { Ring } from './model'
import type { AppState, Person } from './model'
import { decide, pendingProposals, personFor, type Pending } from './services_import'
import { S } from './strings'
import { createTag, tagPerson, untagPerson } from './tag_create'

/** Where "open" can bring the person; PLACE_TARGET is what pulses there once it is open. */
export const PLACES = ['web', 'chat', 'people', 'resources', 'events', 'feed', 'notes', 'settings', 'variations', 'extensions', 'theme', 'your-ai', 'import', 'curate', 'person'] as const
export type Place = (typeof PLACES)[number]
export const PLACE_TARGET: Record<Place, string> = {
  web: '[data-go="web"]', chat: '[data-go="chat"]', people: '[data-go="people"]', resources: '[data-go="inventory"]', events: '[data-go="events"]',
  feed: '[data-go="feed"]', notes: '[data-go="notes"]',
  settings: '[data-settings-gear]', variations: '[data-settings-group="variations"]', extensions: '[data-settings-section="extensions"]', theme: '[data-theme-row]',
  'your-ai': '[data-ai-group="sub"]', import: '[data-import-home]', curate: '[data-svc-list]', person: '.card-name, h1',
}

/** Switches the assistant may flip (Settings and Tools toggles of this device). Never keys, addresses or accounts. */
export const SETTINGS = ['system-tags', 'chats-hidden', 'dark'] as const
export type SettingKey = (typeof SETTINGS)[number]

const RINGS = [Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Family] as const
const ROW_RINGS = [Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending] as const
const LOOKS: readonly Look[] = ['default', 'sleek', 'dex']
const PROFILE = /^(full|iyg-support|reader|note-taker|custom-[a-z0-9-]{1,48})$/
/** Only attribute selectors on data-* attributes: the assistant can tap a button, never run a script or reach outside the app's own marks. */
const TAP = /^(\[data-[a-z0-9-]{1,40}(="[^"\\\]]{0,80}")?\]){1,3}$/
const FIELD = /^[a-z][a-z0-9_-]{0,39}$/
const RESERVED = new Set(['ring', 'id', 'proto', 'constructor', 'prototype'])

export interface AppActionHost {
  state(): Pick<AppState, 'people' | 'serviceImports' | 'twSettings'>
  save(): void
  /** After a change of people or rows: the screen redraws. */
  changed(): void
  open(place: Place, personId?: string): void
  /** Where the person is now (for undoing an "open"); null when it is no place of the list. */
  place(): Place | null
  /** Taps the element; its text, or null when there is none. */
  tap(selector: string): string | null
  tags(): ColourTag[]
  saveTags(tags: ColourTag[]): void
  /** Tag definitions for the rows an Accept writes (import_curate_view.ts ensureTags); absent: the plain slug. */
  tagOf?(x: Pending): (label: string) => string
  look(): Look
  setLook(l: Look): void
  profile(): ProfileId
  setProfile(p: ProfileId): void
  modules(): string[]
  /** Each module's default switch (removeCustom falls back to them); absent: all on. */
  defaults?(): Record<string, boolean>
  isEnabled(id: string): boolean
  setExtension(id: string, on: boolean): void
  setting(k: SettingKey): boolean
  setSetting(k: SettingKey, on: boolean): void
  saveTw(tw: TwSettings): void
  newId(): string
  now(): number
}

export function defineAppActions(reg: Actions, host: AppActionHost): void {
  const T = S.assistant.act

  const person = (ref: string): Person => {
    const people = host.state().people.filter((p) => !p.deleted_at)
    const byId = people.find((p) => p.id === ref)
    if (byId) return byId
    const named = people.filter((p) => normalizeName(p.name) === normalizeName(ref))
    if (named.length > 1) throw new Error(`"${ref}" names more than one person: use the id`)
    if (!named.length) throw new Error(`no person "${ref}"`)
    return named[0]
  }
  const nameOf = (ref: string): string => { try { return person(ref).name } catch { return ref } }
  /** Someone holds tag `id` (review wave 40: an undo keeps a tag that is in use by now). */
  const held = (id: string): boolean => host.state().people.some((x) => String(x.fields?.[id]) === 'true')
  const tagByLabel = (label: string): ColourTag | undefined => {
    const l = label.replace(/^#/, '').trim().toLowerCase()
    return host.tags().find((t) => t.id === l || (t.label ?? '').toLowerCase() === l || t.id === tagSlug(l))
  }
  const done = (): void => { host.save(); host.changed() }

  const row = (ref: string): Pending => {
    const all = pendingProposals(host.state(), host.now())
    const hit = all.find((x) => x.row.key === ref) ?? all.find((x) => normalizeName(x.row.name) === normalizeName(ref))
    if (!hit) throw new Error(`no import row "${ref}"`)
    return hit
  }
  const rowName = (ref: string): string => { try { return row(ref).row.name } catch { return ref } }
  /** Puts one property of the row back exactly as it was (absent stays absent). */
  const restore = <K extends 'labels' | 'ring' | 'note'>(r: Pending['row'], k: K, v: Pending['row'][K]): void => { if (v === undefined) delete r[k]; else r[k] = v }

  // ---- places and the page ----
  reg.define({
    type: 'open', doc: 'Brings the person to a place and highlights it (person needs "person").', shape: '{"place": PLACE, "person"?: id or name}',
    parse: (a) => { const place = oneOf(a, 'place', PLACES); const who = str(a, 'person', 80, place !== 'person'); return { place, person: who } },
    label: (a) => T.open(a.place === 'person' && a.person ? nameOf(a.person) : S.assistant.places[a.place]),
    apply: (a) => {
      const prev = host.place()
      host.open(a.place, a.person ? person(a.person).id : undefined)
      return () => { if (prev) host.open(prev) }
    },
  })
  reg.define({
    type: 'tap', doc: 'Taps a button on the screen, as the person would (only [data-...] selectors). Always needs approval; cannot be undone.', shape: '{"selector": "[data-...]"}',
    parse: (a) => { const selector = str(a, 'selector', 200)!; if (!TAP.test(selector)) throw new Error('selector must be [data-...] attributes only'); return { selector } },
    label: (a) => T.tap(a.selector),
    apply: (a) => { if (host.tap(a.selector) === null) throw new Error(`nothing to tap: ${a.selector}`) },
    auto: false, undoable: false,
  })

  // ---- people ----
  reg.define({
    type: 'set-ring', doc: 'Moves a person to a ring.', shape: `{"person": id or name, "ring": ${RINGS.map((r) => `"${r}"`).join('|')}}`,
    parse: (a) => ({ person: str(a, 'person', 80)!, ring: oneOf(a, 'ring', RINGS) }),
    label: (a) => T.ring(nameOf(a.person), S.assistant.ringShort[a.ring]),
    // Review wave 40 (every undo below): put back only while the value is still the one this step set; a change made since stays.
    apply: (a) => { const p = person(a.person); const prev = p.ring; p.ring = a.ring; done(); return () => { if (p.ring !== a.ring) return; p.ring = prev; done() } },
  })
  reg.define({
    type: 'add-tag', doc: 'Gives a person a tag (an existing one by label, else a new one).', shape: '{"person": id or name, "tag": label}',
    parse: (a) => ({ person: str(a, 'person', 80)!, tag: str(a, 'tag', 60)!.replace(/^#/, '') }),
    label: (a) => T.tag(nameOf(a.person), a.tag),
    apply: (a) => {
      const p = person(a.person)
      let tag = tagByLabel(a.tag)
      const created = !tag
      if (!tag) { tag = createTag(host.tags(), a.tag); host.saveTags([...host.tags(), tag]) }
      const id = tag.id
      const had = String(p.fields?.[id]) === 'true'
      tagPerson(p, id)
      done()
      return () => {
        if (!had) untagPerson(p, id)
        if (created && !held(id)) host.saveTags(host.tags().filter((t) => t.id !== id))   // a tag someone holds by now stays
        done()
      }
    },
  })
  reg.define({
    type: 'remove-tag', doc: 'Takes a tag off a person.', shape: '{"person": id or name, "tag": label}',
    parse: (a) => ({ person: str(a, 'person', 80)!, tag: str(a, 'tag', 60)!.replace(/^#/, '') }),
    label: (a) => T.untag(nameOf(a.person), a.tag),
    apply: (a) => {
      const p = person(a.person)
      const tag = tagByLabel(a.tag)
      if (!tag || String(p.fields?.[tag.id]) !== 'true') throw new Error(`${p.name} has no tag "${a.tag}"`)
      untagPerson(p, tag.id)
      done()
      return () => { if (host.tags().some((t) => t.id === tag.id)) { tagPerson(p, tag.id); done() } }   // not with a tag deleted since
    },
  })
  reg.define({
    type: 'set-field', doc: 'Sets a field of a person: "name", "context" (where we met) or any other field key (email, phone, company...). Empty value clears it.', shape: '{"person": id or name, "field": key, "value": text}',
    parse: (a) => {
      const field = str(a, 'field', 40)!
      if (!FIELD.test(field) || RESERVED.has(field)) throw new Error(`field "${field}" cannot be set`)
      if (typeof a.value !== 'string') throw new Error('value must be text ("" clears the field)')   // review wave 40: a missing value never clears
      const value = a.value.trim()
      if (value.length > 500) throw new Error('value is too long')
      return { person: str(a, 'person', 80)!, field, value }
    },
    label: (a) => T.field(nameOf(a.person), a.field, a.value),
    apply: (a) => {
      const p = person(a.person)
      if (a.field === 'name' || a.field === 'context') {
        if (a.field === 'name' && !a.value) throw new Error('a name cannot be empty')
        const prev = p[a.field]
        p[a.field] = a.value.slice(0, a.field === 'name' ? 40 : 500)
        done()
        return () => { const f = a.field as 'name' | 'context'; if (p[f] !== a.value.slice(0, f === 'name' ? 40 : 500)) return; p[f] = prev; done() }
      }
      const prev = p.fields?.[a.field]
      const put = (v: string | undefined): void => {
        const { [a.field]: _old, ...rest } = p.fields ?? {}
        p.fields = v === undefined || v === '' ? rest : { ...rest, [a.field]: v }
        if (!Object.keys(p.fields).length) delete p.fields
      }
      put(a.value)
      done()
      return () => { if ((p.fields?.[a.field] ?? '') !== a.value) return; put(prev); done() }
    },
  })
  reg.define({
    type: 'add-note', doc: 'Adds a line to the person\'s own note (only the owner sees it).', shape: '{"person": id or name, "text": text}',
    parse: (a) => ({ person: str(a, 'person', 80)!, text: str(a, 'text', 1000)!.replace(/\s*\n\s*/g, ' ') }),
    label: (a) => T.note(nameOf(a.person), a.text),
    apply: (a) => {
      const p = person(a.person)
      const before = generalNoteOf(p)
      if (!setGeneralNote(p, before ? `${before}\n${a.text}` : a.text)) throw new Error('the note is full')
      done()
      return () => {
        const lines = generalNoteOf(p).split('\n')
        const at = lines.indexOf(a.text)
        if (at >= 0) lines.splice(at, 1)
        setGeneralNote(p, lines.join('\n'))
        done()
      }
    },
  })
  reg.define({
    type: 'create-group-tag', doc: 'Creates a tag that groups people and gives it to the members named.', shape: '{"label": text, "members"?: [id or name]}',
    parse: (a) => {
      const members = a.members === undefined ? [] : a.members
      if (!Array.isArray(members) || members.some((m) => typeof m !== 'string') || members.length > 200) throw new Error('members must be a list of ids or names')
      return { label: str(a, 'label', 60)!.replace(/^#/, ''), members: members as string[] }
    },
    label: (a) => T.group(a.label, a.members.length),
    apply: (a) => {
      const people = a.members.map(person)   // every name must resolve before anything changes
      if (tagByLabel(a.label)) throw new Error(`the tag "${a.label}" exists already: use add-tag`)
      const tag = createTag(host.tags(), a.label)
      host.saveTags([...host.tags(), tag])
      for (const p of people) tagPerson(p, tag.id)
      done()
      return () => {
        for (const p of people) untagPerson(p, tag.id)
        if (!held(tag.id)) host.saveTags(host.tags().filter((t) => t.id !== tag.id))
        done()
      }
    },
  })

  // ---- import rows, before Accept ----
  reg.define({
    type: 'row-add-tag', doc: 'Adds a tag to an import row waiting on Curate (before Accept).', shape: '{"row": key or name, "tag": label}',
    parse: (a) => ({ row: str(a, 'row', 200)!, tag: str(a, 'tag', 60)!.replace(/^#/, '') }),
    label: (a) => T.rowTag(rowName(a.row), a.tag),
    apply: (a) => { const r = row(a.row).row; const prev = r.labels ? [...r.labels] : undefined; bulkAddLabels([r], [a.tag]); host.save(); return () => { restore(r, 'labels', prev); host.save() } },
  })
  reg.define({
    type: 'row-set-ring', doc: 'Sets the ring an import row gets on Accept.', shape: `{"row": key or name, "ring": ${ROW_RINGS.map((r) => `"${r}"`).join('|')}}`,
    parse: (a) => ({ row: str(a, 'row', 200)!, ring: oneOf(a, 'ring', ROW_RINGS) }),
    label: (a) => T.rowRing(rowName(a.row), S.assistant.ringShort[a.ring]),
    apply: (a) => { const r = row(a.row).row; const prev = r.ring; r.ring = a.ring; host.save(); return () => { restore(r, 'ring', prev); host.save() } },
  })
  reg.define({
    type: 'row-note', doc: 'Adds a line to the note of an import row.', shape: '{"row": key or name, "text": text}',
    parse: (a) => ({ row: str(a, 'row', 200)!, text: str(a, 'text', 500)! }),
    label: (a) => T.rowNote(rowName(a.row), a.text),
    apply: (a) => { const r = row(a.row).row; const prev = r.note; bulkAppendNote([r], a.text); host.save(); return () => { restore(r, 'note', prev); host.save() } },
  })
  reg.define({
    type: 'accept-row', doc: 'Accepts an import row: the person joins the web with the row\'s ring, tags and note.', shape: '{"row": key or name}',
    parse: (a) => ({ row: str(a, 'row', 200)! }),
    label: (a) => T.accept(rowName(a.row)),
    apply: (a) => {
      const x = row(a.row)
      const s = host.state()
      const before = personFor(s, x.row)?.person
      const snap = before ? structuredClone(before) : undefined
      const ids = new Set(s.people.map((p) => p.id))
      decide(s, x.batchId, x.row.key, { do: 'accept' }, host.now(), () => host.newId(), host.tagOf?.(x) ?? tagSlug)
      // Review wave 40: undo takes out only the person THIS accept created, and puts an existing person back only while nobody changed them since.
      const created = new Set(s.people.filter((p) => !ids.has(p.id)).map((p) => p.id))
      const applied = before ? JSON.stringify(before) : ''
      done()
      return () => {
        const st = host.state()
        if (before && snap && JSON.stringify(before) === applied) { for (const k of Object.keys(before)) delete (before as unknown as Record<string, unknown>)[k]; Object.assign(before, snap) }
        st.people = st.people.filter((p) => !created.has(p.id))
        const batch = (st.serviceImports ?? []).find((b) => b.id === x.batchId)
        if (batch) delete batch.done[x.row.key]
        done()
      }
    },
  })
  reg.define({
    type: 'leave-row', doc: 'Leaves an import row out (nobody is added).', shape: '{"row": key or name}',
    parse: (a) => ({ row: str(a, 'row', 200)! }),
    label: (a) => T.leave(rowName(a.row)),
    apply: (a) => {
      const x = row(a.row)
      decide(host.state(), x.batchId, x.row.key, { do: 'leave' }, host.now(), () => host.newId())
      host.save()
      return () => { const b = (host.state().serviceImports ?? []).find((y) => y.id === x.batchId); if (b) delete b.done[x.row.key]; host.save() }
    },
  })

  // ---- settings, look, profile, extensions, variations ----
  reg.define({
    type: 'set-look', doc: 'Changes the look of the app.', shape: '{"look": "default"|"sleek"|"dex"}',
    parse: (a) => ({ look: oneOf(a, 'look', LOOKS) }),
    label: (a) => T.look(S.themeLooks[a.look]),
    apply: (a) => { const prev = host.look(); host.setLook(a.look); return () => { if (host.look() === a.look) host.setLook(prev) } },
  })
  reg.define({
    type: 'set-profile', doc: 'Switches the variation (built-in or one made before).', shape: '{"profile": VARIATION}',
    parse: (a) => { const profile = str(a, 'profile', 60)!; if (!PROFILE.test(profile)) throw new Error('profile must be a variation id'); return { profile: profile as ProfileId } },
    label: (a) => T.profile(S.var.names[a.profile] ?? host.state().twSettings?.custom?.find((c) => c.id === a.profile)?.name ?? a.profile.replace(/^custom-/, '').replace(/-/g, ' ')),
    apply: (a) => {
      if (a.profile.startsWith('custom-') && !host.state().twSettings?.custom?.some((c) => c.id === a.profile)) throw new Error(`no variation "${a.profile}"`)
      const prev = host.profile()
      host.setProfile(a.profile)
      return () => { if (host.profile() === a.profile) host.setProfile(prev) }
    },
  })
  reg.define({
    type: 'set-extension', doc: 'Switches a part of the app (a module) on or off.', shape: '{"module": MODULE, "on": true|false}',
    // Review wave 40: not the assistant itself (switching it off would take this card and every Undo with it).
    parse: (a) => ({ module: oneOf(a, 'module', host.modules().filter((m) => m !== 'assistant')), on: bool(a, 'on') }),
    label: (a) => T.ext(a.module, a.on),
    apply: (a) => { const prev = host.isEnabled(a.module); host.setExtension(a.module, a.on); return () => { if (host.isEnabled(a.module) === a.on) host.setExtension(a.module, prev) } },
  })
  reg.define({
    type: 'set-setting', doc: `Flips a switch of this device: ${SETTINGS.join(', ')}.`, shape: `{"key": ${SETTINGS.map((k) => `"${k}"`).join('|')}, "on": true|false}`,
    parse: (a) => ({ key: oneOf(a, 'key', SETTINGS), on: bool(a, 'on') }),
    label: (a) => T.setting(S.assistant.settings[a.key], a.on),
    apply: (a) => { const prev = host.setting(a.key); host.setSetting(a.key, a.on); return () => { if (host.setting(a.key) === a.on) host.setSetting(a.key, prev) } },
  })
  reg.define({
    type: 'create-variation', doc: 'Makes a named variation (listed under Settings > Variations): a built-in base, module switches, a look, design-token colours/sizes. Switch to it with set-profile "custom-<name>".',
    shape: '{"name": text, "base": "full"|"iyg-support"|"reader"|"note-taker", "modules"?: {MODULE: true|false}, "look"?: "default"|"sleek"|"dex", "tokens"?: {"--trust": "#335577", "--r-card": "6px"}}',
    parse: (a) => customProfile(a, host.modules()),
    label: (a) => T.variation(a.name),
    apply: (a) => {
      const prev = host.state().twSettings?.custom?.find((c) => c.id === a.id)   // review wave 40: a same-named one is replaced; undo brings it back
      host.saveTw(addCustom(host.state().twSettings, a))
      return () => {
        if (prev) { host.saveTw(addCustom(host.state().twSettings, prev)); return }
        const defaults = host.defaults?.() ?? Object.fromEntries(host.modules().map((m) => [m, true]))
        host.saveTw(removeCustom(host.state().twSettings, a.id, defaults))
      }
    },
  })
}
