// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave46 iyg-shared-resource: the sheet of a resource somebody else shares into a community and its events: read-only (only its author changes it; it updates by itself). Logic: resource_sync.ts. */
import { el } from '../../demo/src/ui/dom'
import type { InventoryItem, ResBlock } from './model'
import { emojiTitle } from './title_emoji'
import { S } from './strings'
import { editSynced } from './resource_scope'

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

/** wave46 iyg-assemble (G1): the author edits title and link of a resource shared with an event and its community; the next save sends it (resource_sync.ts sweep). */
export function editSection(item: InventoryItem, done: (saved: boolean) => void): HTMLElement {
  const title = el('input', { class: 'field', type: 'text', maxlength: '120', value: item.text, 'aria-label': S.w46asm.editTitle, 'data-rs-edit-title': '' }) as HTMLInputElement
  const link = el('input', { class: 'field', type: 'url', value: item.link ?? '', placeholder: S.w46asm.editLink, 'aria-label': S.w46asm.editLink, 'data-rs-edit-link': '' }) as HTMLInputElement
  return el('div', { class: 'rs-edit', 'data-rs-edit': item.id }, [
    title, link,
    el('button', { class: 'btn btn-ghost', type: 'button', 'data-rs-edit-save': '', onclick: () => done(editSynced([item], item.id, title.value, link.value)) }, [S.w46asm.editSave]),
  ])
}
