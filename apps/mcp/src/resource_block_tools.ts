// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b resources-outliner (POLICY P02, MCP parity): add, edit, move, remove and fold the blocks of a resource, paste an outline, and see exactly
 * what a share of a block or a line would carry. Review-44 added remove (the outliner's Backspace on an empty leaf), collapse (its bullet) and import (its Paste).
 */
import { randomBytes } from 'node:crypto'
import { addBlock, countBlocks, editBlock, locate, markdownToBlocks, moveBlock, MOVES, removeBlock, shareProjection, shareRefTag, SHARE_SCOPES, SHARE_VIA, toggleCollapsed } from '../../trustweb/src/resource_blocks.ts'
import type { MoveHow, ShareScope, ShareVia } from '../../trustweb/src/resource_blocks.ts'
import { addSocialPost } from '../../trustweb/src/feed_social.ts'
import type { AppState } from '../../trustweb/src/model.ts'
import { announce } from './events.ts'
import type { InventoryItem } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'
import type { ResourceToolsEnv } from './resource_tools.ts'

type Obj = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })

function itemOf(items: InventoryItem[] | undefined, id: string): InventoryItem {
  const i = (items ?? []).find((x) => x.id === id)
  if (!i) throw new Error(`no resource "${id}"`)
  return i
}

/** wave44 answers-44b: resource_share via chat / feed writes (a Feed post, an approval card), so it needs writes on, the record file and a person lookup. */
export interface ResourceBlockToolsEnv extends ResourceToolsEnv { write?: boolean; file?: string; now?: () => Date; person?: (r: Obj, who: unknown) => { id: string; name: string; peerId?: string } }

export function resourceBlockTools(e: ResourceBlockToolsEnv): { read: Tool[]; write: Tool[] } {
  const read: Tool[] = [{
    name: 'resource_share', description: `Share one block of a resource: scope block = the block with its whole subtree, line = that one line only. via link (default) returns the text, the counts and the back-reference (resource id + block id) and sends nothing; via feed posts exactly that text to my Feed tagged ref:<resource>.<block> (kept on this phone, like feed_post); via chat sends it with the ref line to one connected person (peer = person id or exact name), queued as an approval card for the open preview. chat and feed need writes on. A protected resource has no share.`,
    inputSchema: schema({ id: S('resource id'), blockId: S('block id'), scope: S(SHARE_SCOPES.join(' or ')), via: S(SHARE_VIA.join(', ') + '; default link'), peer: S('via chat: the person (id or exact name)') }, ['id', 'blockId', 'scope']),
    run: (a) => {
      const via = (str(a.via) || 'link') as ShareVia
      if (!SHARE_VIA.includes(via)) throw new Error(`via must be one of ${SHARE_VIA.join(', ')}`)
      if (via !== 'link' && !e.write) throw new Error(`via ${via} needs write access (writes are off)`)
      const r = e.load()
      const item = itemOf(r.inventory as InventoryItem[] | undefined, str(a.id))
      if (item.protected) throw new Error('a protected resource cannot be shared')
      const p = shareProjection(item, str(a.blockId), str(a.scope) as ShareScope)
      if (via === 'link') return { ...p, via }
      const now = (e.now ?? (() => new Date()))()
      if (via === 'feed') {
        e.commit((rec) => { if (!addSocialPost(rec as unknown as AppState, p.text, now.getTime(), { tag: shareRefTag(p.ref) })) throw new Error('nothing to post') })
        return { ...p, via, posted: true }
      }
      if (!str(a.peer).trim()) throw new Error('peer is required for via chat')
      if (!e.person || !e.file) throw new Error('chat is not available here')
      const who = e.person(r, a.peer)
      if (!who.peerId) throw new Error(`${who.name} is not connected`)
      const args = { id: item.id, blockId: p.ref.blockId, scope: p.scope, person: who.id }
      announce(e.file, { at: now.toISOString(), kind: 'action', tool: 'resource_share', summary: `resource-share-chat ${item.id}.${p.ref.blockId}`, action: { type: 'resource-share-chat', args } })
      return { ...p, via, queued: true, person: who.id }
    },
  }]
  const write: Tool[] = [
    {
      name: 'resource_block_add', description: 'Add a block to a resource: after a block (afterId), as the last child of a block (parentId), or at the end of the top level.',
      inputSchema: schema({ id: S('resource id'), text: S('block text'), afterId: S('block id to add below'), parentId: S('block id to add inside') }, ['id', 'text']),
      run: (a) => {
        const blockId = randomBytes(4).toString('hex')
        e.commit((r) => {
          const item = itemOf(r.inventory, str(a.id))
          item.blocks ??= []
          addBlock(item.blocks, blockId, str(a.text), { ...(str(a.afterId) ? { afterId: str(a.afterId) } : {}), ...(str(a.parentId) ? { parentId: str(a.parentId) } : {}) })
        })
        return { id: str(a.id), blockId }
      },
    },
    {
      name: 'resource_block_edit', description: 'Change the text of one block.',
      inputSchema: schema({ id: S('resource id'), blockId: S('block id'), text: S('new text') }, ['id', 'blockId', 'text']),
      run: (a) => { e.commit((r) => { editBlock(itemOf(r.inventory, str(a.id)).blocks ?? [], str(a.blockId), str(a.text)) }); return { id: str(a.id), blockId: str(a.blockId) } },
    },
    {
      name: 'resource_block_move', description: `Move a block: ${MOVES.join(', ')} (indent = under the block above, outdent = out of its parent, the following siblings become its children like Logseq). moved:false when it cannot move that way.`,
      inputSchema: schema({ id: S('resource id'), blockId: S('block id'), how: S(MOVES.join(', ')) }, ['id', 'blockId', 'how']),
      run: (a) => {
        const how = str(a.how)
        if (!(MOVES as readonly string[]).includes(how)) throw new Error(`how must be one of ${MOVES.join(', ')}`)
        let moved = false
        e.commit((r) => { moved = moveBlock(itemOf(r.inventory, str(a.id)).blocks ?? [], str(a.blockId), how as MoveHow) })
        return { id: str(a.id), blockId: str(a.blockId), moved }
      },
    },
    {
      name: 'resource_block_remove', description: 'Remove one block, as Backspace in the outliner does: only a block without text and without sub-blocks (empty it with resource_block_edit first).',
      inputSchema: schema({ id: S('resource id'), blockId: S('block id') }, ['id', 'blockId']),
      run: (a) => {
        e.commit((r) => {
          const blocks = itemOf(r.inventory, str(a.id)).blocks ?? []
          const at = locate(blocks, str(a.blockId))
          if (!at) throw new Error(`no block "${str(a.blockId)}"`)
          if (at.block.children.length) throw new Error('the block still has sub-blocks: remove or move them first')
          if (at.block.text) throw new Error('the block still has text: empty it first')
          removeBlock(blocks, str(a.blockId))
        })
        return { id: str(a.id), blockId: str(a.blockId), removed: true }
      },
    },
    {
      name: 'resource_block_collapse', description: 'Fold or unfold a block (the outliner\'s bullet). A block without sub-blocks stays open. Returns collapsed true/false.',
      inputSchema: schema({ id: S('resource id'), blockId: S('block id') }, ['id', 'blockId']),
      run: (a) => {
        let collapsed = false
        e.commit((r) => { collapsed = toggleCollapsed(itemOf(r.inventory, str(a.id)).blocks ?? [], str(a.blockId)) })
        return { id: str(a.id), blockId: str(a.blockId), collapsed }
      },
    },
    {
      name: 'resource_blocks_import', description: 'Paste an outline (Markdown bullets - * + 1., deeper indent = sub-block, or plain lines) at the end of a resource, as the outliner\'s Paste does.',
      inputSchema: schema({ id: S('resource id'), markdown: S('the outline') }, ['id', 'markdown']),
      run: (a) => {
        let added = 0
        e.commit((r) => {
          const item = itemOf(r.inventory, str(a.id))
          const more = markdownToBlocks(str(a.markdown), () => randomBytes(4).toString('hex'))
          added = countBlocks(more)
          item.blocks = [...(item.blocks ?? []), ...more]
        })
        return { id: str(a.id), added }
      },
    },
  ]
  return { read, write }
}
