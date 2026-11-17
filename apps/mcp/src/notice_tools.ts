// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c chat-notices (MCP parity P02): notices_list (what the one notice layer is made of, and what waits for it in the record) and the default view of
 * Contacts (the Web screen): web_default_view_get / web_default_view_set over uiViews.webDefault, written straight into the record like bar_tools.ts.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { NOTICE_CAP, NOTICE_KINDS } from '../../trustweb/src/notice_layer.ts'
import type { Tool } from './protocol.ts'

/** The view_menu ViewKeys a person can pin. */
const VIEWS = ['home', 'rings', 'network', 'people', 'complete', 'map', 'dex', 'compact', 'groups', 'circles']
/** web_default_view.ts, inlined: that module imports without file endings, which plain node cannot load. */
type Rec = Record<string, unknown> & { uiViews?: { webDefault?: string }; wantsToConnect?: unknown[] }
const none = { type: 'object', properties: {}, required: [], additionalProperties: false }

export function noticeTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const read: Tool[] = [
    {
      name: 'notices_list', description: 'The one notice layer: how many notices show at once, its kinds top to bottom, and how many "Wants to connect" rows wait in the record.',
      inputSchema: none, run: () => ({ cap: NOTICE_CAP, kinds: [...NOTICE_KINDS], waiting: { wants: load().wantsToConnect?.length ?? 0 } }),
    },
    { name: 'web_default_view_get', description: 'The view the Web (Contacts) tab opens: Home unless another is pinned.', inputSchema: none, run: () => ({ view: load().uiViews?.webDefault || 'home' }) },
  ]
  const write: Tool[] = [{
    name: 'web_default_view_set', description: `Pin the default view of Web (Contacts): ${VIEWS.join(', ')}; rings opens the rings first, home (the default) the Home board.`,
    inputSchema: { type: 'object', properties: { view: { type: 'string', enum: VIEWS } }, required: ['view'], additionalProperties: false },
    run: (a) => {
      if (typeof a.view !== 'string' || !VIEWS.includes(a.view)) throw new Error(`view must be one of ${VIEWS.join(', ')}`)
      const r = load()
      r.uiViews = { ...r.uiViews, webDefault: a.view }
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return { view: a.view }
    },
  }]
  return [...read, ...(o.write ? write : [])]
}
