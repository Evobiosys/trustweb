// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Extension modules (wave 24): everything beyond contacts and what we share. Deleting a module's folder and its line here removes it. */
import type { AppState, InventoryItem, TwEvent } from '../model'
import { calendarModule } from './calendar'
import { signalLinkModule } from './signal-link'

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
  /** Wave 27: a page with a Back control (history.pushState), for setup steps; mark = its data-page attribute. */
  page: (title: string, body: Node[], mark: string) => void
  /** Wave 27: the existing encrypted TrustWeb backup, run now with the key this device already has (backup_view.ts). False: no backup set up, no server, or it failed. Needed so setup pages can ask for a backup first. */
  backupNow: () => Promise<boolean>
}

/** Wave 27: one conversation in an extended messenger, as the Chat screen lists it. */
export interface ThreadSummary {
  id: string
  title: string
  /** ms since epoch; 0 when unknown. */
  lastAt: number
  unread: number
  /** The TrustWeb person this thread is with, when known. */
  peerId?: string
}

/** Wave 27: a messenger the Chat screen can extend into (Geb, Signal/Molly, Matrix). live = reachable now, archive = imported read-only. */
export interface MessengerSource {
  id: string
  label: string
  icon: string
  status: () => 'live' | 'archive' | 'needs-setup'
  threads: () => ThreadSummary[] | Promise<ThreadSummary[]>
  open: (threadId: string) => void
  send?: (threadId: string, text: string) => Promise<boolean>
  /** Opens the module's setup page (needs-setup). */
  setup?: () => void
  /** The module's own extended view in place of the thread list (Geb's own UI). */
  view?: () => Node[]
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
  /** Wave 27: the messenger this module adds to the Chat screen's Extend. */
  messenger?: (h: ExtHooks) => MessengerSource
}

export const EXT_MODULES: ExtModule[] = [calendarModule, signalLinkModule]
