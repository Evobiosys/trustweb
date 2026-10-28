// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Extension modules (wave 24): everything beyond contacts and what we share. Deleting a module's folder and its line here removes it. */
import type { AppState } from '../model'
import { calendarModule } from './calendar'

/** What the host app hands a module; modules never import main.ts. */
export interface ExtHooks {
  state: () => AppState
  save: () => void
  redraw: () => void
  header: (title: string, opts: { back: () => void }) => HTMLElement
  leave: () => void
  openEvent: (id: string) => void
  /** The add form, From preset to that day (default today). */
  addEvent: (fromIso?: string) => void
  /** The plain events list (search, filter, paste a link). */
  showList: () => void
  newId: () => string
}

export interface ExtModule {
  id: string
  label: string
  icon: string
  screen: (h: ExtHooks) => { body: () => Node[] }
}

export const EXT_MODULES: ExtModule[] = [calendarModule]
