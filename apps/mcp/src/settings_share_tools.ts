// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 settings-suggest (MCP parity): Settings > Share settings as tools, over apps/trustweb/src/settings_share.ts, the same steps the app takes.
 * What goes out waits in the record's outbox; the open app seals it for the person and posts it on the relay (an MCP server holds no key).
 */
import { randomUUID } from 'node:crypto'
import { SHARE_GROUPS, answer, diffOf, follow, followers, follows, setFollowAuto, shareOf, suggest, unfollow, type ShareGroup } from '../../trustweb/src/settings_share.ts'
import { settingById } from '../../trustweb/src/settings_registry.ts'
import { commitTo, findPerson, load, needText, schema, S, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

const GROUP = { type: 'string', enum: [...SHARE_GROUPS], description: SHARE_GROUPS.join(' | ') }
const newId = (): string => randomUUID().replace(/-/g, '').slice(0, 16)
const nameOf = (r: Rec, id: string): string => r.people.find((p) => p.id === id)?.name ?? ''
type Share = Parameters<typeof shareOf>[0]

export function settingsShareTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const commit = (change: (r: Rec) => void): void => { commitTo(o.file, now, change) }
  const list: Tool = {
    name: 'settings_suggestions_list',
    description: 'Settings > Share settings: suggestions waiting for my answer (kind "suggest": someone\'s settings group with the changes it would make; kind "follow": someone asks to follow one of my groups), whom I follow per group (auto-apply, waiting for their first update) and who follows mine. Groups: privacy, feed, notifications, events.',
    inputSchema: schema({}),
    run: () => {
      const r = load(o.file)
      const rec = r as unknown as Share
      return {
        groups: [...SHARE_GROUPS],
        suggestions: shareOf(rec).inbox.map((i) => ({
          id: i.id, kind: i.t, from: i.from, fromName: nameOf(r, i.from), group: i.group, at: i.at, ...(i.follow ? { update: true } : {}),
          ...(i.t === 'suggest' ? { changes: diffOf(rec, i.group, i.values).map((d) => ({ ...d, label: settingById(d.id)?.label ?? d.id })) } : {}),
        })),
        following: follows(rec).map((f) => ({ group: f.group, person: f.person, name: nameOf(r, f.person), auto: f.auto, waiting: f.waiting })),
        followers: followers(rec).map((f) => ({ ...f, name: nameOf(r, f.person) })),
      }
    },
  }
  if (!o.write) return [list]
  return [list, {
    name: 'settings_suggest',
    description: 'Suggest one of my settings groups (privacy, feed, notifications, events) to a person: they see the differences and tap Accept or Decline. Sealed for them; goes out when the app is next open. Returns {queued, id, to, group}.',
    inputSchema: schema({ person: S('id or exact name'), group: GROUP }, ['person', 'group']),
    run: (a) => {
      let out: { id: string; to: string } | undefined
      commit((r) => { out = suggest(r as unknown as Share, findPerson(r, a.person).id, a.group as ShareGroup, now().getTime(), newId) })
      return { queued: true, id: out!.id, to: out!.to, group: a.group }
    },
  }, {
    name: 'settings_follow',
    description: 'Follow a person\'s settings group: they are asked to allow it; then I get their group now and whenever they change it, applied at once when auto is true, else as a suggestion. Without person: auto switches auto-apply of my follow on that group; on:false stops following that group.',
    inputSchema: schema({ group: GROUP, person: S('id or exact name; omit to change or stop the current follow'), auto: { type: 'boolean', description: 'auto-apply (default false)' }, on: { type: 'boolean', description: 'false = stop following this group' } }, ['group']),
    run: (a) => {
      const group = a.group as ShareGroup
      let res: Record<string, unknown> = {}
      commit((r) => {
        const rec = r as unknown as Share
        if (a.on === false) { unfollow(rec, group, now().getTime(), newId); res = { group, following: null }; return }
        if (a.person !== undefined) {
          const id = findPerson(r, needText(a.person, 'person')).id
          follow(rec, id, group, a.auto === true, now().getTime(), newId)
          res = { group, following: id, auto: a.auto === true, waiting: true }
          return
        }
        if (typeof a.auto !== 'boolean') throw new Error('give a person to follow, auto to switch auto-apply, or on:false to stop')
        if (!setFollowAuto(rec, group, a.auto)) throw new Error(`I follow nobody on ${group}`)
        res = { group, auto: a.auto }
      })
      return res
    },
  }, {
    name: 'settings_suggestion_accept',
    description: 'Answer a waiting item of settings_suggestions_list: accept (default true) applies a suggestion, or allows a follow request (my group is sent to them at once and on every change); accept:false declines it. Returns the setting ids changed.',
    inputSchema: schema({ id: S('suggestion id from settings_suggestions_list'), accept: { type: 'boolean', description: 'false = decline' } }, ['id']),
    run: (a) => {
      const id = needText(a.id, 'id')
      const accepted = a.accept !== false
      let applied: string[] = []
      commit((r) => { applied = answer(r as unknown as Share, id, accepted, now().getTime(), newId).applied })
      return { id, accepted, applied }
    },
  }]
}
