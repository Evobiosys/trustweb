// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b resources-outliner: tree ops, markdown round trip, share projection. */
import { addBlock, blocksToMarkdown, countBlocks, editBlock, locate, markdownToBlocks, moveBlock, removeBlock, shareProjection, toggleCollapsed, refToken } from '../../src/resource_blocks.ts'

const ids = () => { let n = 0; return () => `b${++n}` }
const tree = () => markdownToBlocks('- A\n  - A1\n    - A1a\n  - A2\n- B', ids())

describe('markdown <-> blocks', () => {
  it('indent is depth', () => {
    const t = tree()
    expect(t.map((b) => b.text)).toEqual(['A', 'B'])
    expect(t[0].children.map((b) => b.text)).toEqual(['A1', 'A2'])
    expect(t[0].children[0].children[0].text).toBe('A1a')
    expect(countBlocks(t)).toBe(5)
  })
  it('round trips', () => {
    const md = '- A\n  - A1\n    - A1a\n  - A2\n- B'
    expect(blocksToMarkdown(markdownToBlocks(md, ids()))).toBe(md)
  })
  it('accepts tabs, numbers, stars, plain lines and 4-space steps', () => {
    const t = markdownToBlocks('* one\n\t1. two\n\t\t3) three\nplain\n    deeper\n\n', ids())
    expect(blocksToMarkdown(t)).toBe('- one\n  - two\n    - three\n- plain\n  - deeper')
  })
  it('empty input is empty', () => { expect(markdownToBlocks('  \n\n', ids())).toEqual([]) })
})

describe('tree ops', () => {
  it('Enter adds a sibling below; with a parent it adds the last child', () => {
    const t = tree()
    addBlock(t, 'n1', 'new', { afterId: 'b1' })
    expect(t.map((b) => b.text)).toEqual(['A', 'new', 'B'])
    addBlock(t, 'n2', 'kid', { parentId: 'b5' })
    expect(locate(t, 'b5').block.children[0].id).toBe('n2')
    addBlock(t, 'n3', 'last')
    expect(t.at(-1).id).toBe('n3')
  })
  it('Tab indents under the previous sibling, Shift+Tab outdents after the parent', () => {
    const t = tree()
    expect(moveBlock(t, 'b5', 'indent')).toBe(true)
    expect(t[0].children.at(-1).id).toBe('b5')
    expect(moveBlock(t, 'b5', 'outdent')).toBe(true)
    expect(t.map((b) => b.id)).toEqual(['b1', 'b5'])
  })
  it('Shift+Tab adopts the following siblings as children, like Logseq (answers-44b: was "siblings stay siblings")', () => {
    const t = markdownToBlocks('- A\n  - A1\n  - A2\n    - A2a\n  - A3\n- B', ids())
    expect(moveBlock(t, 'b2', 'outdent')).toBe(true)
    expect(t.map((b) => b.text)).toEqual(['A', 'A1', 'B'])
    expect(t[0].children).toEqual([])
    expect(t[1].children.map((b) => b.text)).toEqual(['A2', 'A3'])
    expect(t[1].children[0].children[0].text).toBe('A2a')
  })
  it('outdent appends adopted siblings after the block\'s own children and opens it', () => {
    const t = markdownToBlocks('- A\n  - A1\n    - A1a\n  - A2', ids())
    locate(t, 'b2').block.collapsed = true
    expect(moveBlock(t, 'b2', 'outdent')).toBe(true)
    expect(t[1].children.map((b) => b.text)).toEqual(['A1a', 'A2'])
    expect(t[1].collapsed).toBeUndefined()
  })
  it('refuses impossible moves', () => {
    const t = tree()
    expect(moveBlock(t, 'b1', 'indent')).toBe(false)
    expect(moveBlock(t, 'b1', 'outdent')).toBe(false)
    expect(moveBlock(t, 'b1', 'up')).toBe(false)
    expect(moveBlock(t, 'b5', 'down')).toBe(false)
  })
  it('moves up and down among siblings', () => {
    const t = tree()
    expect(moveBlock(t, 'b1', 'down')).toBe(true)
    expect(t.map((b) => b.text)).toEqual(['B', 'A'])
  })
  it('edit, collapse (only with children) and remove take the subtree', () => {
    const t = tree()
    editBlock(t, 'b5', '  new   text ')
    expect(locate(t, 'b5').block.text).toBe('new text')
    expect(toggleCollapsed(t, 'b1')).toBe(true)
    expect(toggleCollapsed(t, 'b1')).toBe(false)
    expect(toggleCollapsed(t, 'b5')).toBe(false)
    removeBlock(t, 'b1')
    expect(t.map((b) => b.id)).toEqual(['b5'])
  })
  it('unknown block throws', () => { expect(() => editBlock(tree(), 'zz', 'x')).toThrow(/no block/) })
})

describe('share projection', () => {
  const item = { id: 'r1', blocks: tree() }
  it('block = the whole subtree', () => {
    const p = shareProjection(item, 'b1', 'block')
    expect(p).toMatchObject({ scope: 'block', blocks: 1, lines: 4, ref: { resourceId: 'r1', blockId: 'b1' } })
    expect(p.text).toBe('- A\n  - A1\n    - A1a\n  - A2')
    expect(p.text).not.toContain('B')
  })
  it('line = only that line, no children', () => {
    const p = shareProjection(item, 'b1', 'line')
    expect(p).toMatchObject({ scope: 'line', blocks: 1, lines: 1, text: 'A' })
    expect(refToken(p.ref)).toBe('r1.b1')
  })
  it('a leaf block and its line agree on count; bad scope throws', () => {
    expect(shareProjection(item, 'b4', 'block').lines).toBe(1)
    expect(() => shareProjection(item, 'b1', 'all')).toThrow(/scope/)
  })
})
