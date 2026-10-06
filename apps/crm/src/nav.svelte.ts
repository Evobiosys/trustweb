import { Tab } from './nav'

/** Where the person is in the app: one tab, and optionally one open person on top of the People tab. */
export interface Nav {
  tab: Tab
  personId: string | null
}

export const nav: Nav = $state({ tab: Tab.People, personId: null })

/** A tab press always lands on that tab's own screen, closing any open person. */
export function showTab(tab: Tab): void {
  nav.tab = tab
  nav.personId = null
}

export function openPerson(personId: string): void {
  nav.tab = Tab.People
  nav.personId = personId
}

export function closePerson(): void {
  nav.personId = null
}
