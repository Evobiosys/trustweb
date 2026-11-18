// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c answers-44c (A4, MCP parity D-P02): Settings > Recently deleted over MCP: trash_list (deleted events, resources, tasks, meetings,
 * invitations within 30 days) and trash_restore (puts one back; the restore travels to the linked devices with the next sync). Written straight into the record.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { TRASH_KINDS, recentlyTrashed, restoreTrashed, trashDaysLeft } from '../../trustweb/src/trash.ts'
import type { TrashKind } from '../../trustweb/src/trash.ts'
import type { Tool } from './protocol.ts'

type Rec = Record<string, unknown> & { trash?: [] }
const none = { type: 'object', properties: {}, required: [], additionalProperties: false }

export function trashTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const list: Tool = {
    name: 'trash_list', description: 'Settings > Recently deleted: deleted events, resources, tasks, meetings and invitations still restorable (30 days), newest first: kind, id, name, deletedAt, daysLeft.',
    inputSchema: none,
    run: () => {
      const now = Date.now()
      return { items: recentlyTrashed(load(), now).map((t) => { const x = t.item as Record<string, unknown>; return { kind: t.kind, id: t.id, name: [x.name, x.text, x.title, x.about, x.event].find((v) => typeof v === 'string') ?? t.id, deletedAt: t.deleted_at, daysLeft: trashDaysLeft(t, now) } }) }
    },
  }
  const restore: Tool = {
    name: 'trash_restore', description: `Restore one deleted item from Recently deleted (kind: ${TRASH_KINDS.join(', ')}; id from trash_list). The restore reaches the linked devices with the next sync.`,
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: [...TRASH_KINDS] }, id: { type: 'string' } }, required: ['kind', 'id'], additionalProperties: false },
    run: (a) => {
      if (typeof a.kind !== 'string' || !(TRASH_KINDS as readonly string[]).includes(a.kind) || typeof a.id !== 'string') throw new Error(`kind must be one of ${TRASH_KINDS.join(', ')} and id a string`)
      const r = load()
      if (!restoreTrashed(r, a.kind as TrashKind, a.id)) throw new Error(`${a.kind} ${a.id} is not in the trash`)
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return { restored: true }
    },
  }
  return o.write ? [list, restore] : [list]
}
