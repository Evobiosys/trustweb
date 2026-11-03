// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (share page): the page that shares one item (opened with page_view.ts, so Back closes it, no overlay): the scope editor
 * (scope_editor_view.ts: the zone ladder, Also / Except chips, the preview line), then Share. The rules live in share_page.ts; this
 * file only draws them. DOM only.
 */
import { el } from '../../demo/src/ui/dom'
import { loadColourTags } from './colour_tags'
import { AGENT_SHARE_CEILING } from './share_sink/ceiling'
import { isZone } from './share_sink/zones'
import type { AppState } from './model'
import { DEFAULT_ZONE, ZONE_CHOICES, candidates, initial, membersOf, previewOf, seenBy, shareItem, type Basis, type PageState } from './share_page'
import { labelFor, scopeEditor } from './scope_editor_view'
import { applyProfile, removeProfile, saveProfile } from './share_profiles'
import { curatorHiddenIds } from './curator'
import { shown } from './sources'
import { seeInActionFoot } from './page_foot'
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

/** The people are the ones shown: the Curator's archived contacts never count or list (G5). E3: the events too, so a person's event tags count (share_page.ts storeOf). */
export const basisOf = (s: AppState): Basis => ({ people: shown(s, curatorHiddenIds()).people, tags: loadColourTags(), shares: s.shares, events: s.events })

export function sharePageBody(h: SharePageHooks, itemId: string): HTMLElement {
  const basis = basisOf(h.state())
  const cands = candidates(basis)
  let page: PageState = initial(defaultZone(h.state()))

  /** Profiles: saved groups for the in-addition list (share_profiles.ts); picking one adds its members, saving keeps the current list. */
  const profilesBlock = (scope: PageState, apply: (next: PageState) => void): HTMLElement => {
    const s = h.state()
    const name = el('input', { class: 'field', placeholder: S.shareProfileName, 'aria-label': S.shareProfileName, 'data-share-profile-name': '' }) as HTMLInputElement
    return el('div', { class: 'share-profiles', 'data-share-profiles': '' }, [
      el('details', {}, [el('summary', {}, [S.shareProfiles + ' (i)']), el('p', { class: 'meta' }, [S.shareProfilesInfo])]),
      el('div', { class: 'chips' }, (s.shareProfiles ?? []).length ? (s.shareProfiles ?? []).map((p) => el('span', { class: 'chip share-chip' }, [
        el('button', { class: 'share-chip-label', 'data-share-profile': p.id, onclick: () => apply(applyProfile(scope, p, s.shareProfilesWin === true)) }, [p.name]),
        el('button', { class: 'share-chip-x', 'data-share-profile-remove': p.id, 'aria-label': S.shareProfileRemove(p.name), onclick: () => { s.shareProfiles = removeProfile(s.shareProfiles ?? [], p.id); if (!s.shareProfiles.length) delete s.shareProfiles; h.save(); apply(scope) } }, ['×']),
      ])) : [el('span', { class: 'meta' }, [S.shareProfilesNone])]),
      name,
      el('button', { class: 'btn btn-sm', 'data-share-profile-save': '', onclick: () => {
        if (!name.value.trim() || !scope.include.length) return
        s.shareProfiles = saveProfile(s.shareProfiles ?? [], name.value, scope.include); h.save(); apply(scope)
      } }, [S.shareProfileSave]),
    ])
  }

  const editor = scopeEditor({
    scope: page, zones: ZONE_CHOICES, candidates: cands, label: labelFor(cands),
    preview: (scope) => previewOf(basis, scope, itemId, new Date()), onChange: (scope) => { page = scope },
    members: (id) => membersOf(basis, id).map((m) => m.name),
    openList: (title, names) => h.page(title, [el('p', { class: 'meta' }, [S.shareTagPeople(names.length)]), ...names.map((n) => el('p', { class: 'share-member' }, [n]))], 'share-tag-list'),
    includeExtra: profilesBlock,
  })
  return el('div', { class: 'share-page', 'data-share-page': itemId }, [
    editor,
    el('button', {
      class: 'btn btn-electric', 'data-share-go': '1',
      onclick: () => { const s = h.state(); s.shares = shareItem(basisOf(s), itemId, page, new Date()); h.save(); h.toast(S.shareDone); h.close() },
    }, [S.shareGoBtn]),
    seeInActionFoot(),
  ])
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
