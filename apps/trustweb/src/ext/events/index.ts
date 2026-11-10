// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 feed-events: the Events view (cards with going / maybe, the events-map slot, sharing an event to a tag). Heavy: this stub and the model
 * (for the device-sync merge) are in the main bundle; the view, its CSS and its settings load with the module (events_body.ts).
 * On in the full profile, off in IYG support.
 */
import { S } from '../../strings'
import { EXT_DATA_MERGERS } from '../ext_data'
import type { TwModule } from '../tw_registry'
import { MODULE_ID, mergeEvents } from './events_model'

EXT_DATA_MERGERS.set(MODULE_ID, mergeEvents)

export const module: TwModule = {
  id: MODULE_ID,
  title: S.eventsView.title,
  description: S.eventsView.desc,
  kind: 'view',
  enabledByDefault: true,
  heavy: true,
  load: () => import('./events_body').then((m) => m.body),
}
