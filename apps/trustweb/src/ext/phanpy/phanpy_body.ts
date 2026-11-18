// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob θ): what the dynamic import yields: the Phanpy view. A note that this is a third-party page, a link to open it in a
 * new tab (some instances refuse their login page inside a frame), and the user's Phanpy address in a sandboxed frame on its own origin,
 * with no referrer. TrustWeb passes nothing into the frame and reads nothing out of it.
 */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { TwCtx, TwModuleBody } from '../tw_registry'
import { MODULE_ID, PHANPY_DEFAULT_URL, PHANPY_SANDBOX, parsePhanpyUrl, phanpyUrl } from './phanpy_model'

export function mountPhanpy(host: HTMLElement, ctx: TwCtx): () => void {
  const t = ctx.strings.feedExt
  // A stored address is checked again here: never this app's own origin (that frame would share TrustWeb's storage).
  const url = parsePhanpyUrl(phanpyUrl(ctx.store()), location.origin) ?? PHANPY_DEFAULT_URL
  const site = new URL(url).host
  host.replaceChildren(el('div', { class: 'phanpy-view', 'data-phanpy-view': '1' }, [
    el('p', { class: 'meta phanpy-note', 'data-phanpy-note': '1' }, [t.thirdParty(site), ' ', el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', 'data-phanpy-newtab': '1' }, [t.newTab])]),
    el('iframe', { class: 'phanpy-frame', src: url, title: t.frameTitle, sandbox: PHANPY_SANDBOX, referrerpolicy: 'no-referrer', allow: '', 'data-phanpy-frame': '1' }),
    el('p', { class: 'meta src-opt' }, [t.loginHint, ' ', t.licence]),
  ]))
  return () => host.replaceChildren()
}

export const body: TwModuleBody = {
  views: [{ id: MODULE_ID, title: S.feedExt.viewTitle, icon: 'feed', mount: mountPhanpy }],
}
