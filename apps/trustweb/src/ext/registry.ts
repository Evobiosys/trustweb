// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Extension modules (wave 24): everything beyond contacts and what we share. Deleting a module's folder and its line here removes it. */
import type { AppState, InventoryItem, TwEvent } from '../model'
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
  avatar: (name: string, id: string) => HTMLElement
  /** Sends text into my chat with that person; only ever called from a tap. False when it could not go out. */
  sendInvite: (personId: string, text: string) => Promise<boolean>
  /** Remove-with-undo notice (30 s). */
  undo: (title: string, onUndo: () => void) => void
  /** A reminder came due: the host shows it (system notification while hidden, else a notice) when the reminder kind is on; onOpen is its tap. False = not shown (try again later). */
  notify: (title: string, body: string, onOpen: () => void) => boolean
  /** Opens a My Resources item. */
  openItem: (id: string) => void
  /** Shows the calendar screen. */
  openCalendar: () => void
  /** My event link as a peer (event_link.ts); never carries invitees. */
  eventLink: (ev: TwEvent) => string
}

export interface ExtModule {
  id: string
  label: string
  icon: string
  screen: (h: ExtHooks) => {
    body: () => Node[]
    eventSection?: (ev: TwEvent) => Node[]
    /** Extra rows on a My Resources item's sheet; removing the module removes them. */
    itemSection?: (item: InventoryItem) => Node[]
    /** Called once the record is loaded: starts the module's timers. */
    start?: () => void
  }
}

export const EXT_MODULES: ExtModule[] = [calendarModule]
