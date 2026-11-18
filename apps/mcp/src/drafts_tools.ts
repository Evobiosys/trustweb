// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c event-autosave (MCP parity D-P02): the drafts every editor keeps on this device (apps/trustweb/src/drafts.ts). drafts_list names them
 * (editor, target, size, time) without what was typed; draft_discard drops one, as Settings > Drafts does. Over the record file.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { discardDraft, draftKey, listDrafts } from '../../trustweb/src/drafts.ts'
import type { AppState } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Rec = Pick<AppState, 'drafts'>

export function draftsTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const read: Tool = {
    name: 'drafts_list', description: 'The drafts this device keeps (what was typed in an editor and not sent or saved yet), newest first: key, editor, target, size in bytes, last change. Never the typed content.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run: () => listDrafts(load()).map((d) => ({ key: draftKey(d.editor, d.target), editor: d.editor, target: d.target, size: d.size, updatedAt: new Date(d.updatedAt).toISOString() })),
  }
  const write: Tool = {
    name: 'draft_discard', description: 'Discard one draft by its key (from drafts_list), as Settings > Drafts does.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'editor:target' } }, required: ['key'], additionalProperties: false },
    run: (a) => {
      const key = typeof a.key === 'string' ? a.key : ''
      const r = load()
      if (!discardDraft(r, key)) throw new Error(`no draft "${key}"`)
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return { key, discarded: true }
    },
  }
  return [read, ...(o.write ? [write] : [])]
}
