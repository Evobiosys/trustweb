// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (zone-share-link): Settings > Sharing links: one button per zone to make a named link, the list with Copy / Share and Revoke. DOM only; rules in zone_share_link.ts. */
import { el } from '../../demo/src/ui/dom'
import { randomId } from '../../demo/src/crypto'
import type { AppState } from './model'
import { Zone } from './share_sink/zones'
import { newZoneLink, revokeZoneLink, zoneLinkLive, type ZoneLink } from './zone_share_link'
import { S } from './strings'

/** The zones a link can be made for; the key is the plural the buttons carry. */
const KINDS: readonly { key: string; zone: Zone }[] = [{ key: 'friends', zone: Zone.Friend }, { key: 'close', zone: Zone.Close }, { key: 'community', zone: Zone.Community }, { key: 'acquaintances', zone: Zone.Acquaintance }]

export interface ZoneLinkHooks {
  /** The link's URL, built from the record now (connect link, ticked contact, what the zones see). */
  build: (l: ZoneLink) => Promise<string>
  toast: (msg: string) => void
}

let open = false

export function zoneLinksSettings(s: AppState, save: () => void, redraw: () => void, h: ZoneLinkHooks): Node[] {
  const label = (z: Zone): string => S.shareZones[z][0]
  const copy = (l: ZoneLink): void => {
    void h.build(l).then(async (url) => {
      if (typeof navigator.share === 'function') await navigator.share({ text: url }).catch(() => undefined)
      else await navigator.clipboard.writeText(url).then(() => h.toast(S.zoneLinkCopied))
    })
  }
  const row = (l: ZoneLink): HTMLElement => {
    const live = zoneLinkLive(l, Date.now())
    const state = l.revoked !== undefined ? S.zoneLinkRevoked : live ? '' : S.zoneLinkExpired
    return el('div', { class: 'zone-link', 'data-sharelink': l.id }, [
      el('b', {}, [l.name]),
      el('span', { class: 'meta' }, [S.zoneLinkMeta(l.zones.map(label).join(', '), new Date(l.created).toLocaleDateString()) + (state ? ` · ${state}` : '')]),
      live ? el('button', { class: 'btn btn-ghost btn-sm', 'data-sharelink-copy': l.id, onclick: () => copy(l) }, [typeof navigator.share === 'function' ? S.zoneLinkShare : S.zoneLinkCopy]) : null,
      live ? el('button', { class: 'btn btn-ghost btn-sm', 'data-sharelink-revoke': l.id, onclick: () => { s.zoneLinks = revokeZoneLink(s.zoneLinks ?? [], l.id, Date.now()); save(); redraw() } }, [S.zoneLinkRevoke]) : null,
    ])
  }
  return [
    el('button', { class: 'btn btn-ghost', 'data-settings-sharelinks': '', 'aria-expanded': String(open), onclick: () => { open = !open; redraw() } }, [S.zoneLinksTitle]),
    ...(open ? [
      el('p', { class: 'meta' }, [S.zoneLinksInfo]),
      el('div', { class: 'zone-link-new' }, KINDS.map((k) => el('button', {
        class: 'btn btn-sm', 'data-sharelink-new': k.key,
        onclick: () => { s.zoneLinks = [...(s.zoneLinks ?? []), newZoneLink(S.zoneLinkDefaultName(label(k.zone)), [k.zone], Date.now(), randomId(8))]; save(); redraw() },
      }, [S.zoneLinkCreate(label(k.zone))]))),
      ...((s.zoneLinks ?? []).length ? (s.zoneLinks ?? []).map(row) : [el('p', { class: 'meta' }, [S.zoneLinksNone])]),
      el('p', { class: 'meta' }, [S.zoneLinkRevokeInfo]),
    ] : []),
  ]
}
