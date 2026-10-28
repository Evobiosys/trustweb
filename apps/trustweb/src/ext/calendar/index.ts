// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { ICONS } from '../../icons'
import { S } from '../../strings'
import type { ExtModule } from '../registry'
import { calendarScreen } from './calendar_view'

export const calendarModule: ExtModule = { id: 'calendar', label: S.cal.title, icon: ICONS.calendar, screen: calendarScreen }
