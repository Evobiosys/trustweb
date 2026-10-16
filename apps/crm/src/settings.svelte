<script lang="ts">
  import ColourTags from './colour_tags.svelte'
  import Curate from './curate.svelte'
  import FieldsEditor from './fields_editor.svelte'
  import ImportExport from './import_export.svelte'
  import { PLACE_FIELDS } from './close'
  import { communitiesOf } from './fields'
  import { host } from './bridge'
  import { PKMS, PKM_SOURCE, Pkm, applyTheme, prefs, savePrefs } from './prefs.svelte'
  import { openSort } from './nav.svelte'
  import { unsortedIds } from './sorting.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { flush, sync, unhideInTrustweb } from './sync.svelte'
  import { notes, syncNotes } from './notes_sync.svelte'
  import { manualItems } from './tana_sync'

  const manual = $derived(manualItems(store.app.people, store.crm.personFields))

  function togglePkm(p: Pkm, on: boolean): void {
    prefs.pkms = on ? [...prefs.pkms, p] : prefs.pkms.filter((x) => x !== p)
    savePrefs()
  }

  const toSort = $derived(unsortedIds().length)

  let syncOpen = $state(false)
  const communities = $derived([...new Set(store.app.people.flatMap((p) => communitiesOf(p)))].sort())

  function toggleHideCommunity(c: string, on: boolean): void {
    prefs.filters.hideCommunities = on ? [...prefs.filters.hideCommunities, c] : prefs.filters.hideCommunities.filter((x) => x !== c)
    savePrefs()
  }

  function toggleHideSource(k: string, on: boolean): void {
    prefs.filters.hideSources = on ? [...prefs.filters.hideSources, k] : prefs.filters.hideSources.filter((x) => x !== k)
    savePrefs()
    host.setHiddenSources?.(prefs.filters.hideSources)   // the web view follows at once
  }

  let place = $state('')

  function addPlace(): void {
    const p = place.trim()
    if (p && !prefs.close.places.includes(p)) { prefs.close.places = [...prefs.close.places, p]; savePrefs() }
    place = ''
  }

  function togglePlaceField(id: string, on: boolean): void {
    prefs.close.fields = on ? [...prefs.close.fields, id] : prefs.close.fields.filter((x) => x !== id)
    savePrefs()
  }

  function setDays(e: Event): void {
    const n = Math.floor(Number((e.currentTarget as HTMLInputElement).value))
    if (n >= 1) { prefs.activityDays = n; savePrefs() }
  }
</script>

<section data-screen="settings">
  <div class="title-row">
    <h2 class="screen-title">{S.settingsTitle}</h2>
    <button class="gear" data-field="light-theme" aria-pressed={prefs.light} aria-label={prefs.light ? S.themeToDark : S.themeToLight} title={prefs.light ? S.themeToDark : S.themeToLight}
      onclick={(): void => { prefs.light = !prefs.light; applyTheme(); savePrefs() }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if prefs.light}<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />{:else}<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />{/if}
      </svg>
    </button>
  </div>
  <button class="link" data-action="toggle-sync" aria-expanded={syncOpen} onclick={(): void => { syncOpen = !syncOpen }}>{S.syncOpen(prefs.pkms.length)}</button>
  {#if syncOpen}
  <div data-part="sync">
    <p class="muted">{S.pkmQuestion}</p>
    {#each PKMS as p (p)}
      <label class="fld check">
        <input type="checkbox" data-pkm={p} checked={prefs.pkms.includes(p)} onchange={(e): void => togglePkm(p, e.currentTarget.checked)} />
        <span>{S.pkmLabel[p]}</span>
      </label>
      {#if PKM_SOURCE[p]}
        <label class="fld check sub">
          <input type="checkbox" data-hide-source={PKM_SOURCE[p]} checked={prefs.filters.hideSources.includes(PKM_SOURCE[p])} onchange={(e): void => toggleHideSource(PKM_SOURCE[p] ?? '', e.currentTarget.checked)} />
          <span>{S.hideOnlyFrom(S.pkmLabel[p])}</span>
        </label>
      {/if}
      {#if prefs.pkms.includes(p)}
        {#if p === Pkm.Tana}
          <p class="muted">{S.tanaMcp}</p>
          <label class="fld check">
            <input type="checkbox" data-field="auto-sync" bind:checked={prefs.autoSync} onchange={savePrefs} />
            <span>{S.tanaAutoSync}</span>
          </label>
          <label class="fld"><span>{S.tanaToken}</span>
            <input class="field" type="password" autocomplete="off" data-field="token" bind:value={prefs.token} onchange={savePrefs} /></label>
          <label class="fld"><span>{S.tanaWorkspace}</span>
            <input class="field" type="text" data-field="workspace" bind:value={prefs.workspaceId} onchange={savePrefs} /></label>
          <label class="fld"><span>{S.tanaParent}</span>
            <input class="field" type="text" data-field="parent" bind:value={prefs.parentNodeId} onchange={savePrefs} /></label>
          <button class="btn small" data-action="sync-now" disabled={sync.running} onclick={flush}>
            {sync.running ? S.syncing : S.syncNow(prefs.queue.length)}
          </button>
          <h3 class="screen-title">{S.syncLog}</h3>
          {#each prefs.log as line (line)}<p class="muted">{line}</p>{:else}<p class="muted">{S.syncLogEmpty}</p>{/each}
        {:else if p === Pkm.Obsidian}
          <p class="muted">{S.notesBridge}</p>
          <label class="fld"><span>{S.notesUrl}</span>
            <input class="field" type="text" data-field="notes-url" bind:value={prefs.notesUrl} onchange={savePrefs} /></label>
          <label class="fld"><span>{S.notesToken}</span>
            <input class="field" type="password" autocomplete="off" data-field="notes-token" bind:value={prefs.notesToken} onchange={savePrefs} /></label>
          <label class="fld check">
            <input type="checkbox" data-field="notes-auto-sync" bind:checked={prefs.notesAutoSync} onchange={savePrefs} />
            <span>{S.notesAutoSync}</span>
          </label>
          <button class="btn small" data-action="notes-sync-now" disabled={notes.running} onclick={(): void => { void syncNotes() }}>{notes.running ? S.notesSyncing : S.notesSyncNow}</button>
          {#if notes.last}<p class="muted" data-part="notes-last">{S.notesLast(notes.last)}</p>{/if}
        {:else}
          <p class="muted">{S.pkmLater}</p>
        {/if}
      {/if}
    {/each}
    {#if communities.length > 0}
      <h4 class="ring-heading">{S.hideCommunityTitle}</h4>
      <p class="muted">{S.hideCommunityHint}</p>
      {#each communities as c (c)}
        <label class="fld check sub">
          <input type="checkbox" data-hide-community={c} checked={prefs.filters.hideCommunities.includes(c)} onchange={(e): void => toggleHideCommunity(c, e.currentTarget.checked)} />
          <span>{S.hideOnlyIn(c)}</span>
        </label>
      {/each}
    {/if}
  </div>
  {/if}

  {#if toSort > 0}<button class="btn small sort-banner" data-action="sort-settings" onclick={openSort}>{S.sortBanner(toSort)}</button>{/if}

  {#if store.crm.hiddenPeople?.length}
    <h3 class="screen-title" data-part="hidden-title">{S.hiddenTitle(store.crm.hiddenPeople.length)}</h3>
    <p class="muted">{S.hiddenHint}</p>
    {#each store.crm.hiddenPeople as h (h.id)}
      <p class="line" data-part="hidden">{h.name.trim() || h.id} <button class="quiet" data-action="unhide" onclick={(): void => unhideInTrustweb(h.id)}>{S.unhide}</button></p>
    {/each}
  {/if}

  <h3 class="screen-title">{S.activityTitle}</h3>
  <p class="muted">{S.activityHint}</p>
  <label class="fld"><span>{S.activityDays}</span>
    <input class="field" type="number" min="1" data-field="activity-days" value={prefs.activityDays} onchange={setDays} /></label>

  <h3 class="screen-title">{S.closeTitle}</h3>
  <p class="muted">{S.closeHint}</p>
  <div class="row-filter">
    <input class="field" type="text" data-field="close-place" aria-label={S.closePlace} placeholder={S.closePlace} bind:value={place}
      onkeydown={(e): void => { if (e.key === 'Enter') addPlace() }} />
    <button class="btn small" data-action="add-place" onclick={addPlace}>{S.closeAdd}</button>
  </div>
  {#each prefs.close.places as p (p)}
    <button class="quiet" aria-label={S.closeRemove(p)} onclick={(): void => { prefs.close.places = prefs.close.places.filter((x) => x !== p); savePrefs() }}>{p} ✕</button>
  {/each}
  <p class="muted">{S.closeFields}</p>
  {#each PLACE_FIELDS as f (f.id)}
    <label class="fld check"><input type="checkbox" data-close-field={f.id} checked={prefs.close.fields.includes(f.id)}
      onchange={(e): void => togglePlaceField(f.id, e.currentTarget.checked)} /><span>{f.label}</span></label>
  {/each}

  <ColourTags />

  <ImportExport />

  <h3 class="screen-title">{S.advancedTitle}</h3>
  <label class="fld check">
    <input type="checkbox" data-field="advanced" bind:checked={prefs.advanced} onchange={savePrefs} />
    <span>{S.advancedOn}</span>
  </label>
  <p class="muted">{S.advancedHint}</p>
  {#if prefs.advanced}
    {#if prefs.pkms.length > 0}
      <p class="muted">{S.truthTitle}: {S.truthHint}</p>
      <div class="seg" role="group" aria-label={S.truthTitle}>
        {#each prefs.pkms as p (p)}
          <button data-truth={p} aria-pressed={prefs.truth === p} onclick={(): void => { prefs.truth = prefs.truth === p ? '' : p; savePrefs() }}>{S.pkmLabel[p]}</button>
        {/each}
        {#if !prefs.truth}<span class="muted">{S.truthNone}</span>{/if}
      </div>
    {/if}
    {#if prefs.pkms.includes(Pkm.Obsidian)}
      <button class="btn small" data-action="notes-everyone" disabled={notes.running} onclick={(): void => { if (confirm(S.notesEveryoneConfirm(store.app.people.length))) void syncNotes(true) }}>{S.notesEveryone}</button>
    {/if}
  {/if}

  <FieldsEditor />
  {#if prefs.advanced}<Curate />{/if}

  <h3 class="screen-title">{S.manualTitle}</h3>
  <p class="muted">{S.manualPlacement}</p>
  {#if manual.length}
    <p class="muted">{S.manualHint}</p>
    {#each manual as m (m.personId + m.key)}
      <p class="line" data-part="manual">{m.name}: {m.label} <em>{m.reason}</em></p>
    {/each}
  {:else}
    <p class="muted">{S.manualNone}</p>
  {/if}
</section>
