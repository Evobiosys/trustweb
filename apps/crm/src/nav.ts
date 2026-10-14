/** Fixed sets the screens switch on. Enums live here, not in .svelte files, so every component compiles without a TypeScript preprocessor. */

export enum Tab {
  People = 'people',
  Timeline = 'timeline',
  Pipeline = 'pipeline',
  FollowUps = 'followups',
  Settings = 'settings',
}

export const TABS: readonly Tab[] = [Tab.People, Tab.Timeline, Tab.Pipeline, Tab.FollowUps, Tab.Settings]

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
