// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 feed-events: the Feed view (a Mastodon-style timeline over TrustWeb's own data). Heavy: this stub and the model (for the device-sync
 * merge) are in the main bundle; the view, its CSS and its settings load with the module (feed_body.ts). On in the full profile, off in IYG support.
 */
import { S } from '../../strings'
import { EXT_DATA_MERGERS } from '../ext_data'
import type { TwModule } from '../tw_registry'
import { MODULE_ID, mergeFeed } from './feed_model'

// The slice merges between my devices even while the module is off.
EXT_DATA_MERGERS.set(MODULE_ID, mergeFeed)

export const module: TwModule = {
  id: MODULE_ID,
  title: S.feedView.title,
  description: S.feedView.desc,
  kind: 'view',
  enabledByDefault: true,
  heavy: true,
  load: () => import('./feed_body').then((m) => m.body),
}
