import { DeskPage, Tab } from './nav'

/** Where the person is in the app: one tab, and optionally one open person on top of the People tab. */
export interface Nav {
  tab: Tab
  personId: string | null
  /** An environment open on top of the People tab. */
  environmentId: string | null
  /** An imported contact open on top of the People tab. */
  contactId: string | null
  /** The Import contacts screen is open on top of the People tab. */
  importing: boolean
  /** The "Sort my people" cards are open on top of the People tab. */
  sorting: boolean
  /** The Desk's current page, under the overlays above. */
  deskPage: DeskPage
  /** Desk Contacts limited to one group (a colour tag's field id); in memory only. */
  deskGroup: string | null
  /** The Desk's top search box. */
  deskQuery: string
}

export const nav: Nav = $state({ tab: Tab.People, personId: null, environmentId: null, contactId: null, importing: false, sorting: false, deskPage: DeskPage.Home, deskGroup: null, deskQuery: '' })

/** A tab press always lands on that tab's own screen, closing any open person. */
export function showTab(tab: Tab): void {
  nav.tab = tab
  nav.personId = null
  nav.environmentId = null
  nav.contactId = null
  nav.importing = false
  nav.sorting = false
}

/** A Desk sidebar press: that page, every overlay closed. */
export function showDeskPage(page: DeskPage, group: string | null = null): void {
  showTab(Tab.People)
  nav.deskPage = page
  nav.deskGroup = group
}

export function openPerson(personId: string): void {
  nav.tab = Tab.People
  nav.personId = personId
}

export function closePerson(): void {
  nav.personId = null
}

export function openEnvironment(environmentId: string): void {
  nav.tab = Tab.People
  nav.environmentId = environmentId
}

export function closeEnvironment(): void {
  nav.environmentId = null
}

export function openContact(contactId: string): void {
  nav.tab = Tab.People
  nav.contactId = contactId
}

export function closeContact(): void {
  nav.contactId = null
}

export function openImport(): void {
  nav.tab = Tab.People
  nav.importing = true
}

export function closeImport(): void {
  nav.importing = false
}

export function openSort(): void {
  nav.tab = Tab.People
  nav.personId = null
  nav.sorting = true
}

export function closeSort(): void {
  nav.sorting = false
}
