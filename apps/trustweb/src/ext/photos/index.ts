// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails: photos of people, kept on this phone only (IndexedDB), shown on the person card, imported from a folder, shared by trust zone.
 * Heavy: only this stub and the small data file (photos_data.ts, for the device-sync merge) are in the main bundle; the store, the views and their CSS
 * load with the module (photos_body.ts). Off by default: it uses the phone's storage.
 */
import { S } from '../../strings'
import { EXT_DATA_MERGERS } from '../ext_data'
import type { TwModule } from '../tw_registry'
import { MODULE_ID, mergePhotos } from './photos_data'

// The slice merges between my devices even while the module is off (its share bundles must not be lost to newest-wins).
EXT_DATA_MERGERS.set(MODULE_ID, mergePhotos)

export const module: TwModule = {
  id: MODULE_ID,
  title: S.photos.title,
  description: S.photos.desc,
  kind: 'view',
  enabledByDefault: false,
  heavy: true,
  load: () => import('./photos_body').then((m) => m.body),
}
