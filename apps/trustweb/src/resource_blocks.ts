// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b resources-outliner (Jakob item 26, "like Logseq"): a resource is a tree of blocks (id, text, children, collapsed). Tree edits, the markdown
 * round trip (Tana / Obsidian / pasted lists: indent = depth) and the share projection (a whole block or only its line). Pure: no DOM, no storage.
 */
import type { InventoryItem, ResBlock } from './model'

export type ShareScope = 'block' | 'line'
export const SHARE_SCOPES: readonly ShareScope[] = ['block', 'line']
export type MoveHow = 'up' | 'down' | 'indent' | 'outdent'
export const MOVES: readonly MoveHow[] = ['up', 'down', 'indent', 'outdent']

/** Block text is capped like a resource title's neighbours: one line of thought. */
export const BLOCK_TEXT_MAX = 400

export interface Located { block: ResBlock; siblings: ResBlock[]; index: number; parent: ResBlock | null }

export function locate(blocks: readonly ResBlock[], id: string, parent: ResBlock | null = null): Located | null {
  for (const [index, block] of blocks.entries()) {
    if (block.id === id) return { block, siblings: blocks as ResBlock[], index, parent }
    const inner = locate(block.children, id, block)
    if (inner) return inner
  }
  return null
}

const need = (blocks: readonly ResBlock[], id: string): Located => {
  const at = locate(blocks, id)
  if (!at) throw new Error(`no block "${id}"`)
  return at
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, BLOCK_TEXT_MAX)

/** Enter: a new empty (or given) block as the next sibling of `afterId`; with a `parentId` instead, the last child of that block; neither: last at the top. */
export function addBlock(blocks: ResBlock[], newId: string, text = '', where: { afterId?: string; parentId?: string } = {}): ResBlock {
  const block: ResBlock = { id: newId, text: clean(text), children: [] }
  if (where.afterId) { const at = need(blocks, where.afterId); at.siblings.splice(at.index + 1, 0, block) }
  else if (where.parentId) need(blocks, where.parentId).block.children.push(block)
  else blocks.push(block)
  return block
}

export function editBlock(blocks: ResBlock[], id: string, text: string): void { need(blocks, id).block.text = clean(text) }

export function toggleCollapsed(blocks: ResBlock[], id: string): boolean {
  const b = need(blocks, id).block
  if (b.collapsed) delete b.collapsed; else if (b.children.length) b.collapsed = true
  return Boolean(b.collapsed)
}

export function removeBlock(blocks: ResBlock[], id: string): void { const at = need(blocks, id); at.siblings.splice(at.index, 1) }

/** Tab / Shift+Tab / move up / move down. False when the move is not possible (first block cannot indent, a top block cannot outdent, ends cannot move).
 *  Outdent adopts the following siblings as children (Logseq). */
export function moveBlock(blocks: ResBlock[], id: string, how: MoveHow): boolean {
  const at = need(blocks, id)
  if (how === 'up' || how === 'down') {
    const to = at.index + (how === 'up' ? -1 : 1)
    if (to < 0 || to >= at.siblings.length) return false
    ;[at.siblings[at.index], at.siblings[to]] = [at.siblings[to], at.siblings[at.index]]
    return true
  }
  if (how === 'indent') {
    const prev = at.siblings[at.index - 1]
    if (!prev) return false
    at.siblings.splice(at.index, 1)
    prev.children.push(at.block)
    delete prev.collapsed
    return true
  }
  if (!at.parent) return false
  const up = locate(blocks, at.parent.id)
  if (!up) return false
  // answers-44b (Logseq): the following siblings become the outdented block's last children.
  const adopted = at.siblings.splice(at.index, at.siblings.length - at.index).slice(1)
  if (adopted.length) { at.block.children.push(...adopted); delete at.block.collapsed }
  up.siblings.splice(up.index + 1, 0, at.block)
  return true
}

/** Every block's text, depth first. */
export const subtreeTexts = (b: ResBlock): string[] => [b.text, ...b.children.flatMap(subtreeTexts)]
export const countBlocks = (blocks: readonly ResBlock[]): number => blocks.reduce((n, b) => n + 1 + countBlocks(b.children), 0)

// ---- markdown <-> blocks ----
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/

/** Bullet lists (- * + 1.) or plain lines to blocks; deeper indent = child (tab counts 4 spaces; any consistent width works). Plain lines sit at their own indent. Blank lines are skipped. */
export function markdownToBlocks(md: string, newId: () => string): ResBlock[] {
  const root: ResBlock[] = []
  const stack: { indent: number; block: ResBlock }[] = []
  for (const raw of md.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const m = BULLET.exec(raw)
    const indent = (m ? m[1] : /^\s*/.exec(raw)![0]).replace(/\t/g, '    ').length
    const text = clean(m ? m[2] : raw)
    if (!text) continue
    const block: ResBlock = { id: newId(), text, children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    ;(stack.length ? stack[stack.length - 1].block.children : root).push(block)
    stack.push({ indent, block })
  }
  return root
}

export function blocksToMarkdown(blocks: readonly ResBlock[], depth = 0): string {
  return blocks.map((b) => [`${'  '.repeat(depth)}- ${b.text}`, ...(b.children.length ? [blocksToMarkdown(b.children, depth + 1)] : [])].join('\n')).join('\n')
}

// ---- share granularity (Jakob 26: a whole block or only a sub-block / a line) ----
export interface BlockShare {
  /** Back-reference carried by the shared copy. */
  ref: { resourceId: string; blockId: string }
  scope: ShareScope
  text: string
  blocks: number
  lines: number
}

/** Exactly what travels: scope 'block' = the block and its whole subtree (as an indented list), 'line' = that one line only. */
export function shareProjection(item: Pick<InventoryItem, 'id' | 'blocks'>, blockId: string, scope: ShareScope): BlockShare {
  if (!(SHARE_SCOPES as readonly string[]).includes(scope)) throw new Error(`scope must be one of ${SHARE_SCOPES.join(', ')}`)
  const b = need(item.blocks ?? [], blockId).block
  const ref = { resourceId: item.id, blockId }
  if (scope === 'line') return { ref, scope, text: b.text, blocks: 1, lines: 1 }
  const n = countBlocks([b])
  return { ref, scope, text: blocksToMarkdown([b]), blocks: 1, lines: n }
}

/** The back-reference as one URL-safe token for a share link. */
export const refToken = (r: BlockShare['ref']): string => `${r.resourceId}.${r.blockId}`
