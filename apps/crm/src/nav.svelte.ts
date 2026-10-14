import { Tab } from './nav'

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
}

export const nav: Nav = $state({ tab: Tab.People, personId: null, environmentId: null, contactId: null, importing: false })

/** A tab press always lands on that tab's own screen, closing any open person. */
export function showTab(tab: Tab): void {
  nav.tab = tab
  nav.personId = null
  nav.environmentId = null
  nav.contactId = null
  nav.importing = false
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
