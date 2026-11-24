// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave46 iyg-shared-resource: the sheet of a resource somebody else shares into a community and its events: read-only (only its author changes it; it updates by itself). Logic: resource_sync.ts. */
import { el } from '../../demo/src/ui/dom'
import type { InventoryItem, ResBlock } from './model'
import { emojiTitle } from './title_emoji'
import { S } from './strings'

const outline = (blocks: readonly ResBlock[]): HTMLElement => el('ul', { class: 'rs-outline' }, blocks.map((b) => el('li', {}, [b.text, b.children.length ? outline(b.children) : null])))

/** The nodes of the sheet; `close` is its Close button. */
export function receivedSheet(item: InventoryItem, emoji: boolean, close: () => void): Node[] {
  return [
    el('h3', { 'data-rs-received': item.id }, [emojiTitle(item.text, emoji)]),
    el('p', { class: 'meta' }, [S.w46sr.readOnly(item.sharedBy ?? '')]),
    item.link ? el('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', 'data-rs-received-link': '' }, [item.link]) : null,
    item.blocks?.length ? outline(item.blocks) : null,
    el('button', { class: 'btn btn-ghost', onclick: close }, [S.close]),
  ].filter((n): n is HTMLElement => n !== null)
}
