// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * E3: the scope editor both the Share page (share_page_view.ts) and a profile section (profile_view.ts) use: the zone ladder as a
 * vertical radio list, two chip rows (Also / Except) with a typeahead over people, tags and events, and the "n people would see this"
 * preview. Pure DOM: no state access; the caller passes the starting scope, the choices, the preview rule and gets every change back.
 * The data attributes are the Share page's (data-share-zone, -input, -suggest, -chip, -chip-wrap, -remove, -more, -preview, -names) so its e2e proof stays valid.
 */
import { el } from '../../demo/src/ui/dom'
import { MEMBERS_PEEK, suggest, withChip, withoutChip, type Candidate, type ChipRow } from './share_page'
import { onHoverOrLongPress } from './press'
import type { Scope } from './share_sink/share_lines'
import type { Zone } from './share_sink/zones'
import { chipLabel } from './scope_summary'
import { S } from './strings'

export interface ScopeEditorOpts {
  scope: Scope
  /** The radios, top to bottom (the Share page: Public..Closest; a profile section adds Only me). */
  zones: readonly Zone[]
  candidates: readonly Candidate[]
  label: (id: string) => string
  /** Who would see it under `scope`, by the same check as enforcement (names are for the owner only, I2). */
  preview: (scope: Scope) => { count: number; names: string[] }
  onChange: (scope: Scope) => void
  /** The names behind a tag or event chip: hover or long press peeks at MEMBERS_PEEK of them, a tap opens the list (`openList`). */
  members?: (id: string) => string[]
  openList?: (title: string, names: string[]) => void
  /** Extra block under the Also row (the Share page's saved profiles); `apply` replaces the scope and redraws. */
  includeExtra?: (scope: Scope, apply: (next: Scope) => void) => HTMLElement
}

/** '@name', '#tag', or the event's tag label with the event mark; unknown ids show as they are. */
export const labelFor = (cands: readonly Candidate[]) => (id: string): string => chipLabel(id, cands.find((c) => c.id === id)?.label ?? id, S.scopeEventMark)

export function scopeEditor(o: ScopeEditorOpts): HTMLElement {
  const root = el('div', { class: 'scope-editor' })
  let scope = o.scope
  const set = (next: Scope, focus?: ChipRow): void => { scope = next; o.onChange(scope); draw(focus) }

  const chipRow = (row: ChipRow): HTMLElement => {
    const input = el('input', { class: 'field', placeholder: S.shareChipPh, 'aria-label': row === 'include' ? S.shareAlso : S.shareExcept, autocomplete: 'off', 'data-share-input': row }) as HTMLInputElement
    const hits = el('div', { class: 'share-hits' })
    input.addEventListener('input', () => hits.replaceChildren(...suggest(input.value, o.candidates, [...scope.include, ...scope.exclude]).map((c) => el('button', {
      class: 'chip', 'data-share-suggest': c.id, onclick: () => set(withChip(scope, row, c.id), row),
    }, [o.label(c.id)]))))
    return el('div', { class: 'share-row', 'data-share-row': row }, [
      el('h4', { class: 'eyebrow' }, [row === 'include' ? S.shareAlso : S.shareExcept]),
      el('p', { class: 'meta' }, [row === 'include' ? S.shareAlsoHint : S.shareExceptHint]),
      el('div', { class: 'chips' }, scope[row].map(chip(row))),
      input, hits,
      ...(row === 'include' && o.includeExtra ? [o.includeExtra(scope, (next) => set(next))] : []),
    ])
  }

  /** A chip: the label (a tag's or event's opens its people list, hover or long press shows 3 of them), and a × that removes it. */
  const chip = (row: ChipRow) => (id: string): HTMLElement => {
    const names = o.members && (id.startsWith('tag:') || id.startsWith('event:')) ? o.members(id) : null
    const peek = el('div', { class: 'share-peek', hidden: '' })
    const text = el(names ? 'button' : 'span', {
      class: 'share-chip-label', 'data-share-chip': id,
      ...(names && o.openList ? { onclick: () => o.openList!(o.label(id), names) } : {}),
    }, [o.label(id)])
    const wrap = el('span', { class: 'chip on share-chip', 'data-share-chip-wrap': id }, [text, el('button', {
      class: 'share-chip-x', 'data-share-remove': id, 'aria-label': S.shareChipRemove(o.label(id)), onclick: () => set(withoutChip(scope, row, id)),
    }, ['×']), peek])
    if (names) {
      const fill = (all: boolean): void => {
        const more = el('button', { class: 'share-more', 'data-share-more': id, onclick: () => fill(true) }, [S.shareMore])
        onHoverOrLongPress(more, () => fill(true), () => undefined)
        peek.replaceChildren(...(all ? names : names.slice(0, MEMBERS_PEEK)).map((n) => el('div', {}, [n])), ...(!all && names.length > MEMBERS_PEEK ? [more] : []))
        peek.hidden = false
      }
      onHoverOrLongPress(wrap, () => fill(false), () => { peek.hidden = true })
      document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target as Node)) peek.hidden = true })
    }
    return wrap
  }

  function draw(focus?: ChipRow): void {
    const seen = o.preview(scope)
    root.replaceChildren(
      el('h4', { class: 'eyebrow' }, [S.shareZoneTitle]),
      ...o.zones.map((z) => el('button', {
        class: 'radio' + (scope.zone === z ? ' on' : ''), 'aria-pressed': String(scope.zone === z), 'data-share-zone': z, onclick: () => set({ ...scope, zone: z }),
      }, [el('b', {}, [S.shareZones[z][0]]), el('small', {}, [S.shareZones[z][1]])])),
      chipRow('include'),
      chipRow('exclude'),
      el('h3', { class: 'share-count' }, [S.sharePreview(seen.count)]),
      el('details', { class: 'share-preview', 'data-share-preview': String(seen.count) }, [
        el('summary', {}, ['(i)']),
        el('p', { class: 'meta' }, [S.sharePreviewInfo]),
        el('p', { class: 'meta', 'data-share-names': '' }, [seen.names.join(', ') || S.shareNobody]),
      ]),
    )
    if (focus) (root.querySelector(`[data-share-input="${focus}"]`) as HTMLInputElement | null)?.focus()
  }
  draw()
  return root
}
