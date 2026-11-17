// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (Jakob ι): Bridgy Fed and Threads follows as an extension. Light (no code of its own beyond bridges_model.ts): the switch is
 * read where the follow kinds are drawn and read (feed_ext_view.ts). On by default: it reads nothing until the person follows an account.
 */
import { S } from '../../strings'
import type { TwModule } from '../tw_registry'
import { BRIDGES_MODULE_ID } from './bridges_model'

export const module: TwModule = { id: BRIDGES_MODULE_ID, title: S.feedExt.bridgesName, description: S.feedExt.bridgesHint, kind: 'service', enabledByDefault: true }
