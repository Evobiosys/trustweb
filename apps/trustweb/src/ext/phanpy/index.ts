// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob θ): Phanpy (MIT, a Mastodon client) as an optional view. Heavy and off by default: only this stub and the small
 * model (phanpy_model.ts: the address, no DOM) are in the main bundle; the framed view loads with the module (phanpy_body.ts). Off = no
 * view, no frame, no request to Phanpy. Reachable from Settings > Feed > Extensions, the Feed's "Open in Phanpy" and the bottom bar.
 */
import { S } from '../../strings'
import type { TwModule } from '../tw_registry'
import { MODULE_ID } from './phanpy_model'

export const module: TwModule = {
  id: MODULE_ID,
  title: S.feedExt.phanpyName,
  description: S.feedExt.phanpyHint,
  kind: 'view',
  enabledByDefault: false,
  heavy: true,
  load: () => import('./phanpy_body').then((m) => m.body),
}
