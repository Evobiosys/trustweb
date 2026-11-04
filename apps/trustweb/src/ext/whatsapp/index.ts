// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { ICONS } from '../../icons'
import { S } from '../../strings'
import type { ExtModule } from '../registry'
import { createWhatsApp, openExternal } from './whatsapp_view'

/** WhatsApp Web as a tab of this window (wave 31). No screen of its own: an entry under Chat > Extend, and "Chat" on a card with a WhatsApp link. */
export const whatsappModule: ExtModule = { id: 'whatsapp', label: S.whatsapp.label, icon: ICONS.whatsapp, screen: () => ({ body: () => [] }), messenger: createWhatsApp, openExternal }
