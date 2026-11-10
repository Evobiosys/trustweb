// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 small-ui-c: the Docs & chat view (a Google Docs frame beside a Telegram pane, links kept per community tag). Heavy: only this stub and
 * the small pure model (embeds_model.ts, for the device-sync merge) are in the main bundle; the panes, view and CSS load with the module.
 * community-mighty shares the panes (embeds_panes.ts).
 */
import { S } from '../../strings'
import { EXT_DATA_MERGERS } from '../ext_data'
import type { TwModule } from '../tw_registry'
import { MODULE_ID, mergeEmbeds } from './embeds_model'

// The slice merges between my devices even while the module is off.
EXT_DATA_MERGERS.set(MODULE_ID, mergeEmbeds)

export const module: TwModule = {
  id: MODULE_ID,
  title: S.embeds.title,
  description: S.embeds.desc,
  kind: 'view',
  enabledByDefault: false,
  heavy: true,
  load: () => import('./embeds_body').then((m) => m.body),
}
