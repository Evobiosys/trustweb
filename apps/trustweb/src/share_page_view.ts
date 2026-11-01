// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (share page): the page that shares one item (opened with page_view.ts, so Back closes it, no overlay): the zone ladder as a
 * vertical radio list, two chip rows (Also / Except) with a typeahead over people and tags, the preview line, then Share. The rules
 * live in share_page.ts; this file only draws them. DOM only.
 */
import { el } from '../../demo/src/ui/dom'
import { loadColourTags } from './colour_tags'
import { AGENT_SHARE_CEILING } from './share_sink/ceiling'
import { isZone } from './share_sink/zones'
import type { AppState } from './model'
import { DEFAULT_ZONE, ZONE_CHOICES, candidates, initial, previewOf, seenBy, shareItem, suggest, withChip, withoutChip, type Basis, type ChipRow, type PageState } from './share_page'
import { seeInActionFoot } from './page_foot'
import { S } from './strings'

export interface SharePageHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  /** Leave the page (history.back()). */
  close: () => void
}

/** The zone the Share page starts on: the Settings choice, else Acquaintance. */
export const defaultZone = (s: AppState) => (s.shareDefaultZone && isZone(s.shareDefaultZone) ? s.shareDefaultZone : DEFAULT_ZONE)

export const basisOf = (s: AppState): Basis => ({ people: s.people, tags: loadColourTags(), shares: s.shares })

export function sharePageBody(h: SharePageHooks, itemId: string): HTMLElement {
  const root = el('div', { class: 'share-page', 'data-share-page': itemId })
  const basis = basisOf(h.state())
  const cands = candidates(basis)
  const label = (id: string): string => (id.startsWith('person:') ? '@' : '#') + (cands.find((c) => c.id === id)?.label ?? id)
  let page: PageState = initial(defaultZone(h.state()))

  const chipRow = (row: ChipRow): HTMLElement => {
    const input = el('input', { class: 'field', placeholder: S.shareChipPh, 'aria-label': row === 'include' ? S.shareAlso : S.shareExcept, autocomplete: 'off', 'data-share-input': row }) as HTMLInputElement
    const hits = el('div', { class: 'share-hits' })
    input.addEventListener('input', () => hits.replaceChildren(...suggest(input.value, cands, [...page.include, ...page.exclude]).map((c) => el('button', {
      class: 'chip', 'data-share-suggest': c.id, onclick: () => { page = withChip(page, row, c.id); draw(row) },
    }, [label(c.id)]))))
    return el('div', { class: 'share-row', 'data-share-row': row }, [
      el('h4', { class: 'eyebrow' }, [row === 'include' ? S.shareAlso : S.shareExcept]),
      el('p', { class: 'meta' }, [row === 'include' ? S.shareAlsoHint : S.shareExceptHint]),
      el('div', { class: 'chips' }, page[row].map((id) => el('button', {
        class: 'chip on', 'data-share-chip': id, 'aria-label': S.shareChipRemove(label(id)), onclick: () => { page = withoutChip(page, row, id); draw() },
      }, [label(id) + ' ×']))),
      input, hits,
    ])
  }

  function draw(focus?: ChipRow): void {
    const seen = previewOf(basis, page, itemId, new Date())
    root.replaceChildren(
      el('h4', { class: 'eyebrow' }, [S.shareZoneTitle]),
      ...ZONE_CHOICES.map((z) => el('button', {
        class: 'radio' + (page.zone === z ? ' on' : ''), 'aria-pressed': String(page.zone === z), 'data-share-zone': z, onclick: () => { page = { ...page, zone: z }; draw() },
      }, [el('b', {}, [S.shareZones[z][0]]), el('small', {}, [S.shareZones[z][1]])])),
      chipRow('include'),
      chipRow('exclude'),
      el('details', { class: 'share-preview', 'data-share-preview': String(seen.count) }, [
        el('summary', {}, [S.sharePreview(seen.count) + ' (i)']),
        el('p', { class: 'meta' }, [S.sharePreviewInfo]),
        el('p', { class: 'meta', 'data-share-names': '' }, [seen.names.join(', ') || S.shareNobody]),
      ]),
      el('button', {
        class: 'btn btn-electric', 'data-share-go': '1',
        onclick: () => { const s = h.state(); s.shares = shareItem(basisOf(s), itemId, page, new Date()); h.save(); h.toast(S.shareDone); h.close() },
      }, [S.shareGoBtn]),
      seeInActionFoot(),
    )
    if (focus) (root.querySelector(`[data-share-input="${focus}"]`) as HTMLInputElement | null)?.focus()
  }
  draw()
  return root
}

/** Settings > Web > Sharing: the default zone, whether agents may propose shares (off), and the ceiling, read-only. Stored only when it differs from the default. */
export function sharingSettings(s: AppState, save: () => void, redraw: () => void): Node[] {
  const zone = defaultZone(s)
  return [
    el('label', { class: 'radio', 'data-share-default-zone': '1' }, [
      el('b', {}, [S.setShareZone]),
      el('select', {
        'aria-label': S.setShareZone,
        onchange: (e: Event) => { const z = (e.target as HTMLSelectElement).value; if (z === DEFAULT_ZONE) delete s.shareDefaultZone; else s.shareDefaultZone = z; save() },
      }, ZONE_CHOICES.map((z) => el('option', { value: z, ...(z === zone ? { selected: '' } : {}) }, [S.shareZones[z][0]]))),
      el('small', {}, [S.setShareZoneHint]),
    ]),
    el('button', {
      class: 'radio' + (s.agentsMayPropose ? ' on' : ''), 'aria-pressed': String(s.agentsMayPropose === true), 'data-agents-propose': '1',
      onclick: () => { if (s.agentsMayPropose) delete s.agentsMayPropose; else s.agentsMayPropose = true; save(); redraw() },
    }, [el('b', {}, [S.setAgentPropose]), el('small', {}, [S.setAgentProposeHint])]),
    el('details', { class: 'share-ceiling', 'data-share-ceiling': AGENT_SHARE_CEILING }, [
      el('summary', {}, [S.setShareCeiling(S.shareZones[AGENT_SHARE_CEILING][0]) + ' (i)']),
      el('p', { class: 'meta' }, [S.setShareCeilingInfo]),
    ]),
  ]
}

/** Person card: "Can see n of your shared things" (names under the (i)), by the same check as enforcement. Nothing when nothing is shared. */
export function seenLine(s: AppState, personId: string): HTMLElement | null {
  const ids = seenBy(basisOf(s), personId, new Date())
  if (!s.shares?.length) return null
  const text = (id: string): string => s.inventory.find((i) => i.id === id)?.text ?? id
  return el('details', { class: 'meta card-seen', 'data-card-seen': personId }, [
    el('summary', {}, [S.cardSeen(ids.length) + ' (i)']),
    el('p', { class: 'meta' }, [S.cardSeenInfo]),
    ...ids.map((id) => el('p', { class: 'meta' }, [text(id)])),
  ])
}
