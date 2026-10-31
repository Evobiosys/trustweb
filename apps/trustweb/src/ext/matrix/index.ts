// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { ICONS } from '../../icons'
import { S } from '../../strings'
import type { ExtModule } from '../registry'
import { matrixMessenger } from './matrix_view'

/** Matrix (wave 27): rooms in the Chat screen's Extend; Element X stays the place to write. No screen of its own. */
export const matrixModule: ExtModule = {
  id: 'matrix', label: S.matrix.label, icon: ICONS.chat,
  screen: () => ({ body: () => [] }),
  messenger: matrixMessenger,
}
