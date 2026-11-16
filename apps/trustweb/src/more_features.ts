// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 (Jakob items 9, 10, P3): "Show more features": one line with the V expander on the right (the contact editor's `tw-expander`,
 * ▾ that turns into the roof ▴). The content stays in the page while folded (hidden), so typed values survive. Also the compact variations
 * of the ⋮ list: Reader and Note taker live in "change bottom row", so they are left out there.
 */
import { el } from '../../demo/src/ui/dom'
import { TW_PROFILES } from './ext/profiles'
import type { ProfileDef, ProfileId } from './ext/profiles'
import { S } from './strings'

const IN_BOTTOM_ROW: readonly ProfileId[] = ['reader', 'note-taker']

/** The variations the ⋮ list shows behind "Show more features": all but Reader and Note taker, unless one of them is in force. */
export const compactProfiles = (cur: ProfileId): ProfileDef[] => TW_PROFILES.filter((p) => !IN_BOTTOM_ROW.includes(p.id) || p.id === cur)

/** open absent: the line remembers itself per `attr` across redraws (the ⋮ sheet redraws after a choice). */
export interface MoreOptions { open?: boolean; onToggle?: (open: boolean) => void; attr?: string; label?: string }

const remembered = new Map<string, boolean>()

export function moreFeatures(o: MoreOptions, content: (Node | null)[]): HTMLElement {
  const label = o.label ?? S.ev44.showMore
  const attr = o.attr ?? 'data-more-features'
  const open = o.open ?? remembered.get(attr) ?? false
  const panel = el('div', { class: 'more-features-panel', hidden: !open }, content.filter((n): n is Node => n !== null))
  const set = (open: boolean): void => {
    panel.hidden = !open
    for (const b of [line, toggle]) b.setAttribute('aria-expanded', String(open))
    toggle.textContent = open ? '▴' : '▾'
    if (o.open === undefined) remembered.set(attr, open)
    o.onToggle?.(open)
  }
  const line = el('button', { class: 'more-features-line', type: 'button', 'aria-expanded': String(open), [attr]: '', onclick: () => set(panel.hidden) }, [label])
  const toggle = el('button', { class: 'tw-expander', type: 'button', 'aria-expanded': String(open), 'aria-label': label, 'data-more-toggle': '', onclick: () => set(panel.hidden) }, [open ? '▴' : '▾'])
  return el('div', { class: 'more-features' }, [el('div', { class: 'roles-line' }, [line, toggle]), panel])
}
