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
  /** Something came due: the host shows it (system notification while hidden, else a notice) when that kind's switch is on; onOpen is its tap. False = not shown (try again later). */
  notify: (kind: 'reminder' | 'event', title: string, body: string, onOpen: () => void) => boolean
  /** AtEvent was set or cleared: the host tags a fresh recording draft (or not) to match. */
  atEventChanged: () => void
  /** Opens a Resources item. */
  openItem: (id: string) => void
  /** Shows the calendar screen. */
  openCalendar: () => void
  /** My event link as a peer (event_link.ts); never carries invitees. */
  eventLink: (ev: TwEvent) => string
  /** Scheduling (cal5): a sheet over the app, its close, a short notice, the origin links carry, and who I am to others. */
  sheet: (children: (Node | null)[]) => void
  closeSheet: () => void
  toast: (msg: string) => void
  origin: string
  me: () => { name: string; did?: string }
}

export interface ExtModule {
  id: string
  label: string
  icon: string
  screen: (h: ExtHooks) => {
    body: () => Node[]
    eventSection?: (ev: TwEvent) => Node[]
    /** Extra rows on a Resources item's sheet; removing the module removes them. */
    itemSection?: (item: InventoryItem) => Node[]
    /** Events and tasks as outliner rows, folded, below the Resources list; removing the module removes them. */
    resourcesSection?: () => Node[]
    /** The "I'm at an event" frame for the top of every screen; null when not at an event. */
    frame?: () => HTMLElement | null
    /** The chip on Record and Review: this draft is for the people at that event; drop removes the tag from the draft. Null when the id is unknown. */
    recordChip?: (eventId: string, drop: () => void) => HTMLElement | null
    /** A #book= or #booked= link opened (calendar scheduling): shows its sheet; false when the hash is not one of the module's. */
    openLink?: (hash: string) => boolean
    /** Called once the record is loaded: starts the module's timers. */
    start?: () => void
  }
}

export const EXT_MODULES: ExtModule[] = [calendarModule]
