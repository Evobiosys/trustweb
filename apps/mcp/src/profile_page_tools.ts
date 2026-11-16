// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b profile-page (POLICY P02, MCP parity): the own "Your profile" page as tools: read it (profile_get), change fields, display name and
 * per-field visibility (profile_set), add or remove one of up to four related links. The Discoverable switch stays profile_discoverable_set.
 */
import { FIELDS, LINK_MAX, VIS, addLink, directoryExtra, profileOf, removeLink, setFields, setVis, visOf, fieldOf, type HasProfile, type VisKey } from '../../trustweb/src/profile_fields.ts'
import { commitTo, load, schema, S, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
const VIS_KEYS: readonly string[] = [...FIELDS, 'links']
const meOf = (r: Obj): HasProfile & { displayName?: string } => (r.me ?? (r.me = {})) as never

function shown(r: Obj): Obj {
  const me = meOf(r)
  return {
    displayName: me.displayName ?? '',
    fields: Object.fromEntries(FIELDS.map((k) => [k, fieldOf(me, k)]).filter(([, v]) => v)),
    links: profileOf(me).links ?? [],
    visibility: Object.fromEntries(VIS_KEYS.map((k) => [k, visOf(me, k as VisKey)])),
    discoverable: r.discoverable === true,
    directoryCarries: directoryExtra(me),
  }
}

export function profilePageTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const read: Tool[] = [{
    name: 'profile_get', description: 'Your profile page: display name, phone-book fields (prefix, first, middle, last, suffix, nickname), bio, pronouns, languages, place, up to four links, the visibility of each (me | trusted | discoverable) and what the directory record would carry.',
    inputSchema: schema({}), run: () => shown(load(o.file)),
  }]
  if (!o.write) return read
  const write: Tool[] = [
    {
      name: 'profile_set', description: `Change profile fields: display name (displayName) and any of ${FIELDS.join(', ')} (empty text clears one), and/or visibility {field|links: ${VIS.join(' | ')}}. Default visibility is me.`,
      inputSchema: schema({ displayName: S('your name as people see it, 1 to 40 characters'), fields: { type: 'object', description: 'field name -> text' }, visibility: { type: 'object', description: `field name or "links" -> ${VIS.join(' | ')}` } }),
      run: (a) => {
        let out: Obj = {}
        commitTo(o.file, now, (r) => {
          const me = meOf(r)
          if (a.displayName !== undefined) {
            const n = typeof a.displayName === 'string' ? a.displayName.trim().slice(0, 40) : ''
            if (!n) throw new Error('displayName cannot be empty')
            me.displayName = n
          }
          if (a.fields !== undefined) { if (typeof a.fields !== 'object' || a.fields === null) throw new Error('fields must be an object'); setFields(me, a.fields as Obj) }
          if (a.visibility !== undefined) {
            if (typeof a.visibility !== 'object' || a.visibility === null) throw new Error('visibility must be an object')
            for (const [k, v] of Object.entries(a.visibility)) {
              if (!VIS_KEYS.includes(k)) throw new Error(`unknown field "${k}" (one of: ${VIS_KEYS.join(', ')})`)
              setVis(me, k as VisKey, String(v))
            }
          }
          out = shown(r)
        })
        return out
      },
    },
    {
      name: 'profile_link_add', description: `Add a related link (label + https URL) to your profile; at most ${LINK_MAX}. Not checked against the page until you ask the app to check rel="me".`,
      inputSchema: schema({ label: S('1 to 30 characters'), url: S('https address') }, ['label', 'url']),
      run: (a) => { let out: Obj = {}; commitTo(o.file, now, (r) => { addLink(meOf(r), String(a.label ?? ''), String(a.url ?? '')); out = shown(r) }); return out },
    },
    {
      name: 'profile_link_remove', description: 'Remove one related link from your profile by its URL.',
      inputSchema: schema({ url: S('the link address') }, ['url']),
      run: (a) => { let out: Obj = {}; commitTo(o.file, now, (r) => { removeLink(meOf(r), String(a.url ?? '')); out = shown(r) }); return out },
    },
  ]
  return [...read, ...write]
}
