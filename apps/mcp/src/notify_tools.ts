// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b notify-center (POLICY P02, MCP parity): the bell's notifications page as tools over the record file: list by section, mark all read. */
import { SECTIONS, listNotifications, markAllRead, unreadCount, type Section } from '../../trustweb/src/notify_center.ts'
import type { AppState } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
export interface NotifyToolsEnv { load: () => Obj; commit: (change: (r: Obj) => void) => boolean; now: () => Date }

const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })

export function notifyTools(e: NotifyToolsEnv): { read: Tool[]; write: Tool[] } {
  const read: Tool[] = [
    {
      name: 'notifications_list', description: `The bell's notifications page: items by section (${SECTIONS.join(', ')}), newest first, with how many are unread. section limits it to one.`,
      inputSchema: schema({ section: { type: 'string', enum: [...SECTIONS], description: 'one section' } }),
      run: (a) => {
        if (a.section !== undefined && !SECTIONS.includes(a.section as Section)) throw new Error(`section must be one of ${SECTIONS.join(', ')}`)
        const s = e.load() as unknown as AppState
        const at = e.now().getTime()
        return { unread: unreadCount(s, at), items: listNotifications(s, a.section as Section | undefined, at) }
      },
    },
  ]
  const write: Tool[] = [
    {
      name: 'notifications_mark_read', description: 'Mark every notification of the bell read (the long press on the bell). Returns the unread count, 0.',
      inputSchema: schema({}),
      run: () => {
        const at = e.now().getTime()
        e.commit((r) => markAllRead(r as unknown as AppState, at))
        return { unread: unreadCount(e.load() as unknown as AppState, at) }
      },
    },
  ]
  return { read, write }
}
