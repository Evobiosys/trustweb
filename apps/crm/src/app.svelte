<script lang="ts">
  import { onDestroy } from 'svelte'
  import ContactPage from './contact_page.svelte'
  import Desk from './desk.svelte'
  import Environment from './environment.svelte'
  import ImportContacts from './import_contacts.svelte'
  import { Tab, TABS, View } from './nav'
  import { host } from './bridge'
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
  import { TabbarMode } from './tabbar'
  import Timeline from './timeline.svelte'
  import ViewMenu from './view_menu.svelte'
  import { viewNotifier } from './view_notify'

  const TAB_LABEL: Partial<Record<Tab, string>> = {
    [Tab.People]: S.tabs.people,
    [Tab.Timeline]: S.tabs.timeline,
    [Tab.Pipeline]: S.tabs.pipeline,
  }

  // Hover mode: the bar rides in while the pointer (or a finger, or keyboard focus) is at the bottom edge, and leaves 600 ms after.
  // Only keyboard focus keeps it: a clicked or tapped tab keeps focus too (Chromium), and the bar must still leave.
  let bar: HTMLElement | undefined = $state()
  let shown = $state(false)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  function reveal(): void { clearTimeout(hideTimer); shown = true }
  function hideSoon(): void {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { if (!bar?.querySelector(':focus-visible')) shown = false }, 600)
  }
  onDestroy(() => clearTimeout(hideTimer))

  // The host (apps/trustweb) gives the Desk the whole browser window; it needs to know which face shows.
  const notifyView = viewNotifier((face) => host.viewChanged?.(face))
  $effect(() => notifyView(prefs.view))

  // Hidden mode has no bar to come back with: a header icon already showing its page leads to People.
  const headerTab = (tab: Tab): void => showTab(prefs.tabbar === TabbarMode.Hidden && nav.tab === tab ? Tab.People : tab)
</script>

{#if prefs.view === View.Desk}<Desk />{:else}
<div class="shell" data-tabbar={prefs.tabbar}>
  <header class="top">
    <div>
      <h1>{S.appName}</h1>
      <p class="source">{S.source[store.source]}{store.source === Source.Record ? ` (${store.app.people.length})` : ''}</p>
    </div>
    <div class="top-btns">
      <ViewMenu cls="hdr-icon" />
      <button class="hdr-icon" data-tab={Tab.Timeline} aria-label={S.tabs.timeline} title={S.tabs.timeline} aria-current={nav.tab === Tab.Timeline ? 'page' : undefined} onclick={(): void => headerTab(Tab.Timeline)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M1 12h2.6M8.4 12h1.2M14.4 12h1.2M20.4 12H23" /><circle cx="6" cy="12" r="2.4" /><circle cx="12" cy="12" r="2.4" /><circle cx="18" cy="12" r="2.4" /></svg>
      </button>
      <button class="hdr-icon gear" data-tab={Tab.Settings} aria-label={S.tabs.settings} title={S.tabs.settings} aria-current={nav.tab === Tab.Settings ? 'page' : undefined} onclick={(): void => headerTab(Tab.Settings)}>
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

  {#if prefs.tabbar === TabbarMode.Hover}<div class="tabbar-hotzone" data-part="tabbar-hotzone" role="presentation" onpointerenter={(e): void => { if (e.pointerType === 'mouse') reveal() }} onpointerleave={(e): void => { if (e.pointerType === 'mouse') hideSoon() }} onpointerdown={(e): void => { if (e.pointerType !== 'mouse') { clearTimeout(hideTimer); shown = !shown } }}></div>{/if}
  {#if prefs.tabbar !== TabbarMode.Hidden}
  <nav class="tabbar" class:shown data-mode={prefs.tabbar} bind:this={bar} aria-label={S.navLabel} onpointerenter={reveal} onpointerleave={hideSoon} onfocusin={reveal} onfocusout={hideSoon}>
    {#each TABS.filter((t) => t !== Tab.Pipeline || prefs.advanced) as tab (tab)}
      <button class="tab" data-tab={tab} aria-current={nav.tab === tab ? 'page' : undefined} onclick={(): void => showTab(tab)}>
        {TAB_LABEL[tab]}
      </button>
    {/each}
  </nav>
  {/if}
</div>
{/if}
