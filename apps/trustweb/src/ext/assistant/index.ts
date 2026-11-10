// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: the assistant behind the sparkle (chat with your own AI that proposes changes as cards you approve).
 * Heavy: only this stub is in the main bundle; the panel loads with the module (assistant_body.ts).
 */
import { S } from '../../strings'
import type { TwModule } from '../tw_registry'

export const MODULE_ID = 'assistant'

export const module: TwModule = {
  id: MODULE_ID,
  title: S.assistant.title,
  description: S.assistant.desc,
  kind: 'service',
  enabledByDefault: true,
  heavy: true,
  load: () => import('./assistant_body').then((m) => m.body),
}
