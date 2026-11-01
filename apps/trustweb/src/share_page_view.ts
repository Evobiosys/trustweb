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
import { DEFAULT_ZONE, MEMBERS_PEEK, ZONE_CHOICES, candidates, initial, membersOf, previewOf, seenBy, shareItem, suggest, withChip, withoutChip, type Basis, type ChipRow, type PageState } from './share_page'
import { applyProfile, removeProfile, saveProfile } from './share_profiles'
import { curatorHiddenIds } from './curator'
import { onHoverOrLongPress } from './press'
import { shown } from './sources'
import { S } from './strings'

export interface SharePageHooks {
  state: () => AppState
  save: () => void
  toast: (msg: string) => void
  /** Opens a page with Back (pages.open): the community list of a tag. */
  page: (title: string, body: Node[], mark: string) => void
  /** Leave the page (history.back()). */
  close: () => void
}

/** The zone the Share page starts on: the Settings choice, else Acquaintance. */
export const defaultZone = (s: AppState) => (s.shareDefaultZone && isZone(s.shareDefaultZone) ? s.shareDefaultZone : DEFAULT_ZONE)

/** The people are the ones shown: the Curator's archived contacts never count or list (G5). */
export const basisOf = (s: AppState): Basis => ({ people: shown(s, curatorHiddenIds()).people, tags: loadColourTags(), shares: s.shares })

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
      el('div', { class: 'chips' }, page[row].map(chip(row))),
      input, hits,
      ...(row === 'include' ? [profilesBlock()] : []),
    ])
  }

  /** A chip: the label (a tag's opens its community list, hover or long press shows 3 of its people), and a × that removes it. */
  const chip = (row: ChipRow) => (id: string): HTMLElement => {
    const isTag = id.startsWith('tag:')
    const names = isTag ? membersOf(basis, id).map((m) => m.name) : []
    const peek = el('div', { class: 'share-peek', hidden: '' })
    const text = el(isTag ? 'button' : 'span', {
      class: 'share-chip-label', 'data-share-chip': id,
      ...(isTag ? { onclick: () => h.page(label(id), [el('p', { class: 'meta' }, [S.shareTagPeople(names.length)]), ...names.map((n) => el('p', { class: 'share-member' }, [n]))], 'share-tag-list') } : {}),
    }, [label(id)])
    const wrap = el('span', { class: 'chip on share-chip', 'data-share-chip-wrap': id }, [text, el('button', {
      class: 'share-chip-x', 'data-share-remove': id, 'aria-label': S.shareChipRemove(label(id)), onclick: () => { page = withoutChip(page, row, id); draw() },
    }, ['×']), peek])
    if (isTag) {
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

  /** Profiles: saved groups for the in-addition list (share_profiles.ts); picking one adds its members, saving keeps the current list. */
  const profilesBlock = (): HTMLElement => {
    const s = h.state()
    const name = el('input', { class: 'field', placeholder: S.shareProfileName, 'aria-label': S.shareProfileName, 'data-share-profile-name': '' }) as HTMLInputElement
    return el('div', { class: 'share-profiles', 'data-share-profiles': '' }, [
      el('details', {}, [el('summary', {}, [S.shareProfiles + ' (i)']), el('p', { class: 'meta' }, [S.shareProfilesInfo])]),
      el('div', { class: 'chips' }, (s.shareProfiles ?? []).length ? (s.shareProfiles ?? []).map((p) => el('span', { class: 'chip share-chip' }, [
        el('button', { class: 'share-chip-label', 'data-share-profile': p.id, onclick: () => { page = applyProfile(page, p, s.shareProfilesWin === true); draw() } }, [p.name]),
        el('button', { class: 'share-chip-x', 'data-share-profile-remove': p.id, 'aria-label': S.shareProfileRemove(p.name), onclick: () => { s.shareProfiles = removeProfile(s.shareProfiles ?? [], p.id); if (!s.shareProfiles.length) delete s.shareProfiles; h.save(); draw() } }, ['×']),
      ])) : [el('span', { class: 'meta' }, [S.shareProfilesNone])]),
      name,
      el('button', { class: 'btn btn-sm', 'data-share-profile-save': '', onclick: () => {
        if (!name.value.trim() || !page.include.length) return
        s.shareProfiles = saveProfile(s.shareProfiles ?? [], name.value, page.include); h.save(); draw()
      } }, [S.shareProfileSave]),
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
      el('h3', { class: 'share-count' }, [S.sharePreview(seen.count)]),
      el('details', { class: 'share-preview', 'data-share-preview': String(seen.count) }, [
        el('summary', {}, ['(i)']),
        el('p', { class: 'meta' }, [S.sharePreviewInfo]),
        el('p', { class: 'meta', 'data-share-names': '' }, [seen.names.join(', ') || S.shareNobody]),
      ]),
      el('button', {
        class: 'btn btn-electric', 'data-share-go': '1',
        onclick: () => { const s = h.state(); s.shares = shareItem(basisOf(s), itemId, page, new Date()); h.save(); h.toast(S.shareDone); h.close() },
      }, [S.shareGoBtn]),
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
      class: 'radio' + (s.shareProfilesWin ? ' on' : ''), 'aria-pressed': String(s.shareProfilesWin === true), 'data-share-profiles-win': '1',
      onclick: () => { if (s.shareProfilesWin) delete s.shareProfilesWin; else s.shareProfilesWin = true; save(); redraw() },
    }, [el('b', {}, [S.setShareProfilesWin]), el('small', {}, [S.setShareProfilesWinHint])]),
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
