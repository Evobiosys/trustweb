/** Fixed sets the screens switch on. Enums live here, not in .svelte files, so every component compiles without a TypeScript preprocessor. */

export enum Tab {
  People = 'people',
  Timeline = 'timeline',
  Pipeline = 'pipeline',
  Settings = 'settings',
}

/** The bottom bar; Settings sits behind the gear at the top right. Pipeline only with Settings > Advanced on (app.svelte; Jakob 2026-10-16: "hide pipeline for now"). */
/** The bottom bar. Timeline is a header icon (Jakob 2026-10-19), still a Tab as a view. */
export const TABS: readonly Tab[] = [Tab.People, Tab.Pipeline]

export enum Section {
  Overdue = 'overdue',
  Upcoming = 'upcoming',
  Finished = 'finished',
}

export const SECTIONS: readonly Section[] = [Section.Overdue, Section.Upcoming, Section.Finished]

/** Which inline form the person screen shows. */
export enum PersonForm {
  None = 'none',
  Interaction = 'interaction',
  FollowUp = 'followup',
}

/** Which face of the Curator shows: the classic phone shell or the three-column Desk. */
export enum View {
  Desk = 'desk',
  Classic = 'classic',
}

/** The pages in the Desk's sidebar. */
export enum DeskPage {
  Web = 'web',
  Home = 'home',
  Reminders = 'reminders',
  Contacts = 'contacts',
  KeepInTouch = 'keepInTouch',
  Timeline = 'timeline',
  Map = 'map',
  Settings = 'settings',
  Help = 'help',
  /** My profile (the host's editor), from the profile button; not in the sidebar. */
  Profile = 'profile',
}
