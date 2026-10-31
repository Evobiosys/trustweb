// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { ICONS } from '../../icons'
import { S } from '../../strings'
import type { ExtModule } from '../registry'
import { createGeb } from './geb_view'

/** Geb as the default extended chat. No screen of its own: it lives under Chat > Extend. */
export const gebModule: ExtModule = { id: 'geb', label: S.geb.label, icon: ICONS.chat, screen: () => ({ body: () => [] }), messenger: createGeb }
