// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The foot of the connect and share pages: "See TrustWeb in action", bottom right, linking the side-by-side demo build (<app>/demo/). */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'

/** The demo build of an app url (the same target main.ts links as "Add a device"). */
export const demoUrl = (appUrl: string): string => appUrl + 'demo/'

export function seeInActionFoot(): HTMLElement {
  return el('p', { class: 'page-foot', 'data-see-in-action': '' }, [
    el('a', { href: demoUrl(location.origin + import.meta.env.BASE_URL) }, [S.seeInAction]),
  ])
}
