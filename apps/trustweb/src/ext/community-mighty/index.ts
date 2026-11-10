// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 community-mighty: the Community view (left menu Home, Spaces, Events, Members, Docs, Chat) over TrustWeb's own data.
 * Heavy: only this stub is in the main bundle; the view, its CSS and its settings load with the module (community_body.ts).
 */
import { S } from '../../strings'
import type { TwModule } from '../tw_registry'

export const module: TwModule = {
  id: 'community-mighty',
  title: S.community.title,
  description: S.community.desc,
  kind: 'view',
  enabledByDefault: false,
  heavy: true,
  load: () => import('./community_body').then((m) => m.body),
}
