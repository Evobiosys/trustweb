<script lang="ts">
  // The classic face's content (everything under its header, without the tabbar): the phone's Contacts sheet and the Desk's Contacts page.
  import ContactPage from './contact_page.svelte'
  import Environment from './environment.svelte'
  import ImportContacts from './import_contacts.svelte'
  import { Tab } from './nav'
  import { nav } from './nav.svelte'
  import People from './people.svelte'
  import Person from './person.svelte'
  import Pipeline from './pipeline.svelte'
  import Settings from './settings.svelte'
  import SortPeople from './sort_people.svelte'
  import Timeline from './timeline.svelte'
</script>

{#if nav.sorting}
  <SortPeople />
{:else if nav.importing}
  <ImportContacts />
{:else if nav.contactId !== null}
  <ContactPage contactId={nav.contactId} />
{:else if nav.environmentId !== null}
  <Environment environmentId={nav.environmentId} />
{:else if nav.personId !== null}
  <Person personId={nav.personId} />
{:else if nav.tab === Tab.People}
  <People />
{:else if nav.tab === Tab.Timeline}
  <Timeline />
{:else if nav.tab === Tab.Pipeline}
  <Pipeline />
{:else}
  <Settings />
{/if}
