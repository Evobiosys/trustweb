// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36b: the owner's own profile page, read-only: what each trust zone sees (own_profile.ts), with links to edit. */
import { el } from '../../demo/src/ui/dom'
import { VIEWER_ZONES } from './scope_summary'
import { sectionsByZone } from './own_profile'
import type { MyProfile } from './profile'
import type { Basis } from './share_page'
import { S } from './strings'

export interface OwnProfileDeps {
  profile: () => MyProfile | undefined
  basis: () => Basis
  now: () => Date
  face: () => HTMLElement
  name: () => string
  editProfile: () => void
  editName: () => void
}

export function ownProfilePage(d: OwnProfileDeps): HTMLElement {
  const by = sectionsByZone(d.profile(), d.basis(), d.now())
  return el('div', { class: 'scroll pad own-profile', 'data-own-profile': '' }, [
    el('div', { class: 'own-profile-head' }, [d.face(), el('h2', {}, [d.name()])]),
    el('p', { class: 'meta' }, [S.ownProfileLead]),
    ...VIEWER_ZONES.map((zone) => el('section', { class: 'own-profile-zone', 'data-own-zone': zone }, [
      el('h4', { class: 'eyebrow' }, [S.profViewerZone[zone]]),
      by[zone].length ? el('ul', {}, by[zone].map((k) => el('li', {}, [S.profSection[k]]))) : el('p', { class: 'meta' }, [S.ownProfileNothing]),
    ])),
    el('div', { class: 'own-profile-edit' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', 'data-own-profile-edit': '', onclick: d.editProfile }, [S.ownProfileEdit]),
      el('button', { class: 'btn btn-ghost', type: 'button', 'data-own-profile-name': '', onclick: d.editName }, [S.ownProfileName]),
    ]),
  ])
}
