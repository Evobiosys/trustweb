<script lang="ts">
  import ContactPage from './contact_page.svelte'
  import Environment from './environment.svelte'
  import Followups from './followups.svelte'
  import ImportContacts from './import_contacts.svelte'
  import { Tab, TABS } from './nav'
  import { nav, showTab } from './nav.svelte'
  import People from './people.svelte'
  import Person from './person.svelte'
  import SortPeople from './sort_people.svelte'
  import Pipeline from './pipeline.svelte'
  import Settings from './settings.svelte'
  import { forgetImport, importText, store } from './state.svelte'
  import { Source } from './storage'
  import { S } from './strings'
  import Timeline from './timeline.svelte'

  const TAB_LABEL: Record<Tab, string> = {
    [Tab.People]: S.tabs.people,
    [Tab.Timeline]: S.tabs.timeline,
    [Tab.Pipeline]: S.tabs.pipeline,
    [Tab.FollowUps]: S.tabs.followUps,
    [Tab.Settings]: S.tabs.settings,
  }

  let importFailed = $state(false)

  async function onFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      importFailed = !importText(await file.text())
    } catch {
      importFailed = true
    }
  }

  function forget(): void {
    importFailed = false
    forgetImport()
  }
</script>

<div class="shell">
  <header class="top">
    <h1>{S.appName}</h1>
    <p class="source">{S.source[store.source]}{store.source === Source.Record ? ` (${store.app.people.length})` : ''}</p>
    <div class="import-row">
      <label class="file-btn">
        {S.importFile}
        <input type="file" accept="application/json" onchange={onFile} />
      </label>
      {#if store.source === Source.Imported}
        <button class="quiet" onclick={forget}>{S.forgetImport}</button>
      {/if}
    </div>
    {#if importFailed}<p class="warn" role="alert">{S.importBad}</p>{/if}
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
    {:else if nav.tab === Tab.Settings}
      <Settings />
    {:else}
      <Followups />
    {/if}
  </main>

  <p class="privacy">{S.privacy}</p>

  <nav class="tabbar" aria-label={S.navLabel}>
    {#each TABS as tab (tab)}
      <button class="tab" data-tab={tab} aria-current={nav.tab === tab ? 'page' : undefined} onclick={(): void => showTab(tab)}>
        {TAB_LABEL[tab]}
      </button>
    {/each}
  </nav>
</div>
