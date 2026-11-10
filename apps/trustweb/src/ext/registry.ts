// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Extension modules (wave 24): everything beyond contacts and what we share. Deleting a module's folder and its line here removes it. */
import type { Identity } from '../../../demo/src/did'
import type { AppState, InventoryItem, TwEvent } from '../model'
import type { BarId } from '../bottom_bar'
import type { RelayDeps } from '../notes_relay'
import { calendarModule } from './calendar'
import { signalLinkModule } from './signal-link'
import { matrixModule } from './matrix'
import { gebModule } from './geb'
import { whatsappModule } from './whatsapp'
import { coNotesModule } from './co_notes'
import { module as communityMighty } from './community-mighty'
import { module as communityMode } from './community_mode'
import { S } from '../strings'
import { createRegistry, type TwCtx, type TwModule } from './tw_registry'
import type { TwSettings } from './profiles'

export * from './tw_registry'
export * from './profiles'

/** What the host app hands a module; modules never import main.ts. */
export interface ExtHooks {
  state: () => AppState
  /** The address as the page was opened, before the startup clean removed the one-time parameters (pairing links, SSO return). */
  boot: { hash: string; search: string }
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
  /** Wave 36: opens that person's card. */
  openPerson: (personId: string) => void
  /** Wave 36: the DID a person is reached by on the notes relay (paired peer, else from an event link). */
  didOf: (personId: string) => string | undefined
  /** Wave 36: the relay and my key, or null when there is no relay, no identity or the relay is switched off. */
  relay: () => { deps: RelayDeps; identity: Identity } | null
  /** Wave 37: the relay without my key (the invite mailboxes need none), or null when there is no relay or it is switched off. */
  relayDeps: () => RelayDeps | null
  /** Wave 37: the existing connect flow to the person a note invite names, ring Intending to connect; the new person's id, or null when it failed. */
  connectTo: (who: { did: string; id: string; name: string }) => Promise<string | null>
  /** Wave 37: joins the event an event link carries; its id, or null. */
  joinEventLink: (link: string) => string | null
  /** Wave 37: opens my 1:1 chat with that person. */
  openChat: (personId: string) => void
  /** Wave 37: the guest shell changed (entered or left): redraws the bottom row and shows the Chat screen when `show`. */
  guestChanged: (show: boolean) => void
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
  /** Wave 28: more under the thread list when this source is shown alone (Matrix account). */
  extra?: () => Node[]
  /** Wave 28: is the app in this browser? (Geb: bridge answers, or its page marker.) live = reachable, installed = found but not paired, absent. */
  probe?: () => Promise<'live' | 'installed' | 'absent'>
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
    /** Wave 36: rows for Settings > Extensions (empty when the module has none). */
    settingsRows?: () => Node[]
    /** Wave 36: below the Notes page under Resources. */
    notesSection?: () => Node[]
    /** Wave 36: fetch what others left for me on the relay; true when something changed. */
    poll?: () => Promise<boolean>
    /** Wave 37: the guest of a co-note link: the nested shell's bottom row, the note + group chat as the Chat screen, the start screen line for a new visitor. Null / absent when this device is no guest. */
    guest?: () => { tabs: BarId[]; primary: BarId; eventId?: string; body: () => Node[] } | null
    startLine?: () => Node | null
  }
  /** Wave 28: a link the host is about to open in a new tab; true = the module opened it itself (WhatsApp Web beside TrustWeb). */
  openExternal?: (url: string) => boolean
  /** Wave 27: the messenger this module adds to the Chat screen's Extend. */
  messenger?: (h: ExtHooks) => MessengerSource
}

export const EXT_MODULES: ExtModule[] = [calendarModule, gebModule, matrixModule, signalLinkModule, whatsappModule, coNotesModule]

/**
 * Wave 39: the module registry (tw_registry.ts). main.ts binds the store once with bindTw; the six messenger and calendar modules above are
 * registered as they are (read once at load, so a switch needs one reload), plus the app's own parts a profile can switch off.
 */
const bound: { settings: () => TwSettings | undefined; save: (t: TwSettings) => void; ctx: () => TwCtx } = {
  settings: () => undefined, save: () => {}, ctx: () => { throw new Error('twRegistry used before bindTw') },
}
export const twRegistry = createRegistry({ settings: () => bound.settings(), save: (t) => bound.save(t), ctx: () => bound.ctx() })
export const bindTw = (io: typeof bound): void => { Object.assign(bound, io) }
export const registerModule = (m: TwModule): void => twRegistry.registerModule(m)
export const listModules = (): readonly TwModule[] => twRegistry.listModules()
export const isEnabled = (id: string): boolean => twRegistry.isEnabled(id)
export const setEnabled = (id: string, on: boolean): Promise<void> => twRegistry.setEnabled(id, on)

const wrap = (m: ExtModule, kind: TwModule['kind']): TwModule => ({ id: m.id, title: m.label, description: S.ext.desc[m.id], kind, enabledByDefault: true, reload: true })
/** An app part with no code of its own: the switch is read where the part is drawn (featureOn, bar flags, ask modes). */
const part = (id: string, kind: TwModule['kind']): TwModule => ({ id, title: S.ext.names[id], description: S.ext.desc[id], kind, enabledByDefault: true })

;[
  wrap(calendarModule, 'view'), wrap(coNotesModule, 'view'), wrap(gebModule, 'service'), wrap(matrixModule, 'service'), wrap(signalLinkModule, 'service'), wrap(whatsappModule, 'service'),
  part('events', 'view'), part('resources', 'view'), part('feed', 'view'), part('matches', 'view'), part('support-ask', 'service'), part('ai-button', 'service'),
  communityMighty, communityMode,
].forEach(registerModule)
