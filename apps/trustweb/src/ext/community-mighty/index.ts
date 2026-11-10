// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 community-mighty: the Community view (left menu Home, Spaces, Events, Members, Docs, Chat) over TrustWeb's own data.
 * Heavy: only this stub and the small data file (community_data.ts, for the device-sync merge) are in the main bundle; the view, its CSS
 * and its settings load with the module (community_body.ts).
 */
import { S } from '../../strings'
import { EXT_DATA_MERGERS } from '../ext_data'
import type { TwModule } from '../tw_registry'
import { MODULE_ID, mergeCommunity } from './community_data'

// The slice merges between my devices even while the module is off (its data must not be lost to newest-wins).
EXT_DATA_MERGERS.set(MODULE_ID, mergeCommunity)

export const module: TwModule = {
  id: MODULE_ID,
  title: S.community.title,
  description: S.community.desc,
  kind: 'view',
  enabledByDefault: false,
  heavy: true,
  load: () => import('./community_body').then((m) => m.body),
}
