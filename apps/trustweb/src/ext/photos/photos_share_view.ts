// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: "Share these photos with <zone / tag>". The page is the app's own share page: the same scope editor (zone ladder, Also / Except
 * chips, "n people would see this") over the same share model (share_page.ts). Share appends ONE share line for the item `photos:<id>`, keeps a bundle
 * entry (hashes, never pictures) and seals its manifest for each recipient the app can reach. STUB: nothing is sent and the pictures do not travel
 * yet (photo_share.ts says so; so does the page). Light DOM on purpose: the scope editor is the app's component and uses the app's CSS.
 */
import { randomId } from '../../../../demo/src/crypto'
import { deserializeIdentity } from '../../../../demo/src/did'
import { el } from '../../../../demo/src/ui/dom'
import type { AppState, Person } from '../../model'
import { labelFor, scopeEditor } from '../../scope_editor_view'
import { ZONE_CHOICES, candidates, initial, membersOf, previewOf, type PageState } from '../../share_page'
import { basisOf, defaultZone } from '../../share_page_view'
import { bundleItem, planShare, sealBundleFor } from './photo_share'
import type { PhotosService } from './photos_service'

/** The relay DID a person is reached by: the paired peer's, else the one an event link told me (the notes relay's rule). */
const didOf = (s: AppState, p: Person): string | undefined => s.peers.find((x) => x.id === p.peerId)?.did ?? p.did

export function openShare(svc: PhotosService, photoIds: string[]): void {
  const t = svc.ctx.strings.photos
  const s = (): AppState => svc.ctx.store()
  const basis = basisOf(s())
  const cands = candidates(basis)
  let scope: PageState = initial(defaultZone(s()))
  const note = el('p', { class: 'meta', 'data-photo-share-note': '' }, [t.shareStub])

  let busy = false   // review wave 40: a second tap while the first runs would write the bundle and its share line twice
  const share = async (): Promise<void> => {
    const metas = (await svc.store.list()).filter((m) => photoIds.includes(m.id))
    const plan = planShare(basisOf(s()), { photos: metas, scope, now: new Date(), newId: () => randomId(8) })
    if (!plan) return
    s().shares = plan.lines
    const d = svc.data()
    svc.setData({ ...d, bundles: [...(d.bundles ?? []), plan.bundle] })
    const identity = s().identity
    const me = identity ? deserializeIdentity(identity) : null
    const dids = s().people.filter((p) => plan.bundle.recipients.includes(p.id)).flatMap((p) => didOf(s(), p) ?? [])
    const sealed = me ? (await Promise.all(dids.map((did) => sealBundleFor(plan.bundle, me, did).then(() => 1, () => 0)))).reduce<number>((a, b) => a + b, 0) : 0
    svc.toast(t.shareDone(plan.bundle.recipients.length, sealed))
    svc.back()
  }
  const go = async (): Promise<void> => {
    if (busy) return
    busy = true
    try { await share() } finally { busy = false }
  }

  svc.page(t.shareTitle(photoIds.length), [
    el('div', { class: 'share-page', 'data-photo-share': photoIds.join(',') }, [
      scopeEditor({
        scope, zones: ZONE_CHOICES, candidates: cands, label: labelFor(cands),
        preview: (sc) => previewOf(basis, sc, bundleItem('new'), new Date()), onChange: (sc) => { scope = sc },
        members: (id) => membersOf(basis, id).map((m) => m.name),
        openList: (title, names) => svc.page(title, names.map((n) => el('p', { class: 'share-member' }, [n])), 'share-tag-list'),
      }),
      el('button', { class: 'btn btn-electric', 'data-photo-share-go': '', onclick: () => { void go() } }, [t.shareGo]),
      note,
    ]),
  ], 'photo-share')
}
