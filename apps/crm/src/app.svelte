<script lang="ts">
  import ContactPage from './contact_page.svelte'
  import Environment from './environment.svelte'
  import ImportContacts from './import_contacts.svelte'
  import { Tab, TABS } from './nav'
  import { nav, showTab } from './nav.svelte'
  import { prefs } from './prefs.svelte'
  import People from './people.svelte'
  import MergeToast from './merge_toast.svelte'
  import Person from './person.svelte'
  import SortPeople from './sort_people.svelte'
  import Pipeline from './pipeline.svelte'
  import Settings from './settings.svelte'
  import { store } from './state.svelte'
  import { Source } from './storage'
  import { S } from './strings'
  import Timeline from './timeline.svelte'

  const TAB_LABEL: Partial<Record<Tab, string>> = {
    [Tab.People]: S.tabs.people,
    [Tab.Timeline]: S.tabs.timeline,
    [Tab.Pipeline]: S.tabs.pipeline,
  }
</script>

<div class="shell">
  <header class="top">
    <div>
      <h1>{S.appName}</h1>
      <p class="source">{S.source[store.source]}{store.source === Source.Record ? ` (${store.app.people.length})` : ''}</p>
    </div>
    <button class="gear" data-tab={Tab.Settings} aria-label={S.tabs.settings} title={S.tabs.settings} aria-current={nav.tab === Tab.Settings ? 'page' : undefined} onclick={(): void => showTab(Tab.Settings)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
    </button>
  </header>

  <main>
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
  </main>

  <MergeToast />

  <p class="privacy">{S.privacy}</p>

  <nav class="tabbar" aria-label={S.navLabel}>
    {#each TABS.filter((t) => t !== Tab.Pipeline || prefs.advanced) as tab (tab)}
      <button class="tab" data-tab={tab} aria-current={nav.tab === tab ? 'page' : undefined} onclick={(): void => showTab(tab)}>
        {TAB_LABEL[tab]}
      </button>
    {/each}
  </nav>
</div>
