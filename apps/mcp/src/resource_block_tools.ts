// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b resources-outliner (POLICY P02, MCP parity): add, edit and move the blocks of a resource, and see exactly what a share of a block or a line would carry. */
import { randomBytes } from 'node:crypto'
import { addBlock, editBlock, moveBlock, MOVES, shareProjection, SHARE_SCOPES } from '../../trustweb/src/resource_blocks.ts'
import type { MoveHow, ShareScope } from '../../trustweb/src/resource_blocks.ts'
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

export function resourceBlockTools(e: ResourceToolsEnv): { read: Tool[]; write: Tool[] } {
  const read: Tool[] = [{
    name: 'resource_share', description: `What a share of one block of a resource carries: scope block = the block with its whole subtree, line = that one line only. Returns the text, the counts and the back-reference (resource id + block id); nothing is sent. A protected resource has no share.`,
    inputSchema: schema({ id: S('resource id'), blockId: S('block id'), scope: S(SHARE_SCOPES.join(' or ')) }, ['id', 'blockId', 'scope']),
    run: (a) => {
      const item = itemOf(e.load().inventory, str(a.id))
      if (item.protected) throw new Error('a protected resource cannot be shared')
      return shareProjection(item, str(a.blockId), str(a.scope) as ShareScope)
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
      name: 'resource_block_move', description: `Move a block: ${MOVES.join(', ')} (indent = under the block above, outdent = out of its parent). moved:false when it cannot move that way.`,
      inputSchema: schema({ id: S('resource id'), blockId: S('block id'), how: S(MOVES.join(', ')) }, ['id', 'blockId', 'how']),
      run: (a) => {
        const how = str(a.how)
        if (!(MOVES as readonly string[]).includes(how)) throw new Error(`how must be one of ${MOVES.join(', ')}`)
        let moved = false
        e.commit((r) => { moved = moveBlock(itemOf(r.inventory, str(a.id)).blocks ?? [], str(a.blockId), how as MoveHow) })
        return { id: str(a.id), blockId: str(a.blockId), moved }
      },
    },
  ]
  return { read, write }
}
