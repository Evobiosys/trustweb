// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 (group-tags): the one tag pill, Tana-like (a tinted rounded chip, "#" in front by CSS). Group, managed and event tags get a ring around it. Styles: "wave 40 group-tags" at the end of styles.css. */
import { el } from '../../../demo/src/ui/dom'
import type { TagKind } from '../tags_model'

export const pillClass = (kind: TagKind | undefined): string => 'tag-pill' + (kind && kind !== 'personal' ? ` tag-ring tag-kind-${kind}` : '')

export interface PillTag { id: string; label?: string; colour: string; kind?: TagKind }
export interface PillOpts {
  /** A button when it does something, else a span. */
  onclick?: () => void
  /** Extra classes and data-attributes of the caller. */
  class?: string
  attrs?: Record<string, string>
  /** Replaces the label (e.g. with a count or a "×"). */
  text?: string
  /** Nodes after the label (a remove button). */
  after?: (Node | null)[]
}

export function tagPill(t: PillTag, o: PillOpts = {}): HTMLElement {
  const attrs = { class: [pillClass(t.kind), o.class].filter(Boolean).join(' '), style: `--tp:${t.colour}`, 'data-tag-pill': t.id, ...o.attrs }
  const body = [o.text ?? t.label ?? t.id, ...(o.after ?? [])]
  return o.onclick ? el('button', { type: 'button', ...attrs, onclick: o.onclick }, body) : el('span', attrs, body)
}
