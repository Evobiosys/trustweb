// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40: Settings > Sharing: a connection link that carries a Variation (profile_link.ts): the same as mine, or one picked. DOM only. */
import { el } from '../../demo/src/ui/dom'
import { TW_PROFILES, type ProfileId } from './ext/profiles'
import { withProfile } from './profile_link'
import { S } from './strings'

export interface ProfileLinkHooks {
  /** My plain connection link. */
  connectLink: () => Promise<string>
  current: () => ProfileId
  toast: (msg: string) => void
}

export function profileLinkSettings(h: ProfileLinkHooks): Node[] {
  const pick = el('select', { 'data-profile-link-pick': '', 'aria-label': S.w40.linkVarPick }, [
    el('option', { value: '' }, [`${S.w40.linkVarSame} (${S.var.names[h.current()]})`]),
    ...TW_PROFILES.map((p) => el('option', { value: p.id }, [S.var.names[p.id]])),
  ]) as HTMLSelectElement
  const send = (): void => {
    void h.connectLink().then(async (link) => {
      const url = withProfile(link, (pick.value || h.current()) as ProfileId)
      if (typeof navigator.share === 'function') await navigator.share({ text: url }).catch(() => undefined)
      else await navigator.clipboard.writeText(url).then(() => h.toast(S.zoneLinkCopied))
    })
  }
  return [
    el('div', { class: 'profile-link', 'data-profile-link': '' }, [
      el('b', {}, [S.w40.linkVarTitle]),
      el('p', { class: 'meta' }, [S.w40.linkVarHint]),
      pick,
      el('button', { class: 'btn btn-ghost btn-sm', 'data-profile-link-copy': '', onclick: send }, [typeof navigator.share === 'function' ? S.w40.linkVarShare : S.w40.linkVarCopy]),
    ]),
  ]
}
