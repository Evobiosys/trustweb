// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b resources-outliner: the outline of one resource in its detail sheet, Logseq-like. Enter = sibling below, Tab / Shift+Tab = indent / outdent,
 * the bullet collapses; buttons do the same on a phone. Long press (or right click) on a bullet: share the whole block or only that line. Logic: resource_blocks.ts.
 */
import { el } from '../../demo/src/ui/dom'
import { contextPress } from './context_press'
import type { InventoryItem, ResBlock } from './model'
import { addBlock, countBlocks, editBlock, locate, markdownToBlocks, moveBlock, removeBlock, shareProjection, toggleCollapsed } from './resource_blocks'
import type { BlockShare, MoveHow, ShareScope, ShareVia } from './resource_blocks'
import { S } from './strings'

export interface OutlineCtx {
  item: InventoryItem
  newId: () => string
  save: () => void
  /** False for a protected resource: no share menu. */
  canShare: boolean
  /** Hands the chosen projection to the app's share route: link (QR), chat or feed (answers-44b); the shared copy carries projection.ref. */
  share: (p: BlockShare, via: ShareVia) => void
}

/** "1 line" / "1 block, 12 lines": what the share sheet says will travel. */
export const scopeLabel = (p: Pick<BlockShare, 'scope' | 'blocks' | 'lines'>): string => (p.scope === 'line' ? S.resOutliner.oneLine : S.resOutliner.blockLines(p.blocks, p.lines))

export function outlineView(c: OutlineCtx): HTMLElement {
  const root = el('div', { class: 'ol', 'data-outline': c.item.id })
  let focusId: string | null = null
  let picking: string | null = null
  let sharing: BlockShare | null = null
  const blocks = (): ResBlock[] => (c.item.blocks ??= [])
  const change = (f: () => void): void => { f(); c.save(); draw() }
  const move = (id: string, how: MoveHow): void => { focusId = id; change(() => { moveBlock(blocks(), id, how) }) }

  const bullet = (b: ResBlock): HTMLElement => {
    const kids = b.children.length > 0
    const btn = el('button', {
      class: 'ol-bullet' + (b.collapsed ? ' ol-closed' : ''), 'data-ol-bullet': b.id, 'aria-label': kids ? S.resOutliner.collapse : S.resOutliner.bulletAria,
      ...(kids ? { 'aria-expanded': String(!b.collapsed) } : {}),
      onclick: () => { if (kids) change(() => { toggleCollapsed(blocks(), b.id) }) },
    }, [kids ? (b.collapsed ? '▸' : '▾') : '•'])
    if (c.canShare) contextPress(btn, () => { picking = b.id; sharing = null; draw() })
    return btn
  }

  const rowOf = (b: ResBlock, depth: number): Node[] => {
    const input = el('input', {
      class: 'ol-text', 'data-ol-text': b.id, 'aria-label': S.resOutliner.lineAria, maxlength: '400', value: b.text,
      onfocus: () => { focusId = b.id },
      onchange: (e: Event) => { editBlock(blocks(), b.id, (e.target as HTMLInputElement).value); c.save() },
      onkeydown: (ev: Event) => {
        const e = ev as KeyboardEvent
        const v = (e.target as HTMLInputElement).value
        if (e.key === 'Enter') { e.preventDefault(); addBelow(b.id, v) }
        else if (e.key === 'Tab') { e.preventDefault(); editBlock(blocks(), b.id, v); move(b.id, e.shiftKey ? 'outdent' : 'indent') }
        else if (e.key === 'Backspace' && v === '' && b.children.length === 0) { e.preventDefault(); change(() => { removeBlock(blocks(), b.id) }); focusId = null }
      },
    })
    const row = el('div', { class: 'ol-row', style: `padding-left:${depth * 18}px`, 'data-ol-row': b.id }, [bullet(b), input])
    const out: Node[] = [row]
    if (picking === b.id) out.push(pickRow(b))
    if (!b.collapsed) for (const k of b.children) out.push(...rowOf(k, depth + 1))
    return out
  }
  const addBelow = (afterId: string, current: string): void => {
    const id = c.newId()
    editBlock(blocks(), afterId, current)
    focusId = id
    change(() => { addBlock(blocks(), id, '', { afterId }) })
  }

  const pickRow = (b: ResBlock): HTMLElement => {
    const pick = (scope: ShareScope): void => { sharing = shareProjection(c.item, b.id, scope); picking = null; draw() }
    return el('div', { class: 'ol-pick', 'data-ol-pick': b.id, role: 'group' }, [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-ol-share-block': b.id, onclick: () => pick('block') }, [S.resOutliner.shareBlock]),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-ol-share-line': b.id, onclick: () => pick('line') }, [S.resOutliner.shareLine]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { picking = null; draw() } }, [S.close]),
    ])
  }

  const tool = (key: string, label: string, f: () => void): HTMLElement =>
    el('button', { class: 'btn btn-ghost btn-sm', 'data-ol-tool': key, 'aria-label': label, title: label, onmousedown: (e: Event) => e.preventDefault(), onclick: f }, [label])

  const shareBox = (p: BlockShare): HTMLElement => el('div', { class: 'ol-share', 'data-ol-share': p.scope }, [
    el('b', { 'data-ol-scope': '' }, [scopeLabel(p)]),
    el('pre', { class: 'ol-share-text' }, [p.text]),
    el('button', { class: 'btn btn-electric btn-sm', 'data-ol-share-go': '', onclick: () => c.share(p, 'link') }, [S.resOutliner.shareGo]),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-ol-share-chat': '', onclick: () => c.share(p, 'chat') }, [S.resShare.chat]),
    el('button', { class: 'btn btn-ghost btn-sm', 'data-ol-share-feed': '', onclick: () => c.share(p, 'feed') }, [S.resShare.feed]),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { sharing = null; draw() } }, [S.close]),
  ])

  const importBox = (): HTMLElement => {
    const area = el('textarea', { class: 'field ol-paste', 'data-ol-paste': '', rows: '4', placeholder: S.resOutliner.pastePh, 'aria-label': S.resOutliner.pasteAria })
    return el('details', { class: 'ol-import' }, [
      el('summary', {}, [S.resOutliner.pasteTitle]),
      area,
      el('button', { class: 'btn btn-ghost btn-sm', 'data-ol-import': '', onclick: () => { const add = markdownToBlocks((area as HTMLTextAreaElement).value, c.newId); if (add.length) change(() => { blocks().push(...add) }) } }, [S.resOutliner.pasteGo]),
    ])
  }

  function draw(): void {
    const list = blocks()
    root.replaceChildren(
      el('h4', { class: 'eyebrow' }, [S.resOutliner.title(countBlocks(list))]),
      ...(list.length === 0 ? [el('p', { class: 'meta' }, [S.resOutliner.empty])] : list.flatMap((b) => rowOf(b, 0))),
      el('div', { class: 'ol-tools' }, [
        tool('add', S.resOutliner.add, () => { const id = c.newId(); const prev = focusId; focusId = id; change(() => { addBlock(blocks(), id, '', prev && locate(blocks(), prev) ? { afterId: prev } : {}) }) }),
        tool('outdent', S.resOutliner.outdent, () => { if (focusId) move(focusId, 'outdent') }),
        tool('indent', S.resOutliner.indent, () => { if (focusId) move(focusId, 'indent') }),
        tool('up', S.resOutliner.up, () => { if (focusId) move(focusId, 'up') }),
        tool('down', S.resOutliner.down, () => { if (focusId) move(focusId, 'down') }),
      ]),
      importBox(),
      ...(sharing ? [shareBox(sharing)] : []),
    )
    if (focusId) { const t = root.querySelector<HTMLInputElement>(`[data-ol-text="${focusId}"]`); if (t) setTimeout(() => t.focus(), 0) }
  }
  draw()
  return root
}
