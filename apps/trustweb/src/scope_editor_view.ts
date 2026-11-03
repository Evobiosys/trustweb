// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * E3: the scope editor both the Share page (share_page_view.ts) and a profile section (profile_view.ts) use: the zone ladder as a
 * vertical radio list, two chip rows (Also / Except) with a typeahead over people, tags and events, and the "n people would see this"
 * preview. Pure DOM: no state access; the caller passes the starting scope, the choices, the preview rule and gets every change back.
 * The data attributes are the Share page's (data-share-zone, -input, -suggest, -chip, -preview, -names) so its e2e proof stays valid.
 */
import { el } from '../../demo/src/ui/dom'
import { suggest, withChip, withoutChip, type Candidate, type ChipRow } from './share_page'
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
      el('div', { class: 'chips' }, scope[row].map((id) => el('button', {
        class: 'chip on', 'data-share-chip': id, 'aria-label': S.shareChipRemove(o.label(id)), onclick: () => set(withoutChip(scope, row, id)),
      }, [o.label(id) + ' ×']))),
      input, hits,
    ])
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
      el('details', { class: 'share-preview', 'data-share-preview': String(seen.count) }, [
        el('summary', {}, [S.sharePreview(seen.count) + ' (i)']),
        el('p', { class: 'meta' }, [S.sharePreviewInfo]),
        el('p', { class: 'meta', 'data-share-names': '' }, [seen.names.join(', ') || S.shareNobody]),
      ]),
    )
    if (focus) (root.querySelector(`[data-share-input="${focus}"]`) as HTMLInputElement | null)?.focus()
  }
  draw()
  return root
}
