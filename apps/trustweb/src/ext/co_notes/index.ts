// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { ICONS } from '../../icons'
import { S } from '../../strings'
import { SETTING_MERGERS } from '../../sync_core'
import type { ExtModule } from '../registry'
import { mergeCoNotes } from './co_sync'
import { coNotesScreen } from './co_view'

/** Co-created notes (wave 36): an outliner two or more people write together, merged by a CRDT and carried sealed over the notes relay. Off until switched on in Settings > Extensions. */
SETTING_MERGERS.set('coNotes', mergeCoNotes)

export const coNotesModule: ExtModule = { id: 'co-notes', label: S.coNotes.label, icon: ICONS.list, screen: coNotesScreen }
