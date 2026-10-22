<script lang="ts">
  import ContactPage from './contact_page.svelte'
  import Desk from './desk.svelte'
  import Environment from './environment.svelte'
  import ImportContacts from './import_contacts.svelte'
  import { Tab, TABS, View } from './nav'
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
  import ViewMenu from './view_menu.svelte'

  const TAB_LABEL: Partial<Record<Tab, string>> = {
    [Tab.People]: S.tabs.people,
    [Tab.Timeline]: S.tabs.timeline,
    [Tab.Pipeline]: S.tabs.pipeline,
  }
</script>

{#if prefs.view === View.Desk}<Desk />{:else}
<div class="shell">
  <header class="top">
    <div>
      <h1>{S.appName}</h1>
      <p class="source">{S.source[store.source]}{store.source === Source.Record ? ` (${store.app.people.length})` : ''}</p>
    </div>
    <div class="top-btns">
      <ViewMenu cls="hdr-icon" />
      <button class="hdr-icon" data-tab={Tab.Timeline} aria-label={S.tabs.timeline} title={S.tabs.timeline} aria-current={nav.tab === Tab.Timeline ? 'page' : undefined} onclick={(): void => showTab(Tab.Timeline)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12h2.6M8.4 12h1.2M14.4 12h1.2M20.4 12H23" /><circle cx="6" cy="12" r="2.4" /><circle cx="12" cy="12" r="2.4" /><circle cx="18" cy="12" r="2.4" /></svg>
      </button>
      <button class="hdr-icon gear" data-tab={Tab.Settings} aria-label={S.tabs.settings} title={S.tabs.settings} aria-current={nav.tab === Tab.Settings ? 'page' : undefined} onclick={(): void => showTab(Tab.Settings)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
      </button>
    </div>
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
{/if}
