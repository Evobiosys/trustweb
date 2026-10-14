<script lang="ts">
  import Curate from './curate.svelte'
  import FieldsEditor from './fields_editor.svelte'
  import { PLACE_FIELDS } from './close'
  import { PKMS, Pkm, prefs, savePrefs } from './prefs.svelte'
  import { openSort } from './nav.svelte'
  import { unsortedIds } from './sorting.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { flush, sync, unhideInTrustweb } from './sync.svelte'
  import { manualItems } from './tana_sync'

  const manual = $derived(manualItems(store.app.people, store.crm.personFields))

  function togglePkm(p: Pkm, on: boolean): void {
    prefs.pkms = on ? [...prefs.pkms, p] : prefs.pkms.filter((x) => x !== p)
    savePrefs()
  }

  const toSort = $derived(unsortedIds().length)

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
  <h2 class="screen-title">{S.settingsTitle}</h2>
  <p class="muted">{S.pkmQuestion}</p>
  {#each PKMS as p (p)}
    <label class="fld check">
      <input type="checkbox" data-pkm={p} checked={prefs.pkms.includes(p)} onchange={(e): void => togglePkm(p, e.currentTarget.checked)} />
      <span>{S.pkmLabel[p]}</span>
    </label>
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
      {:else}
        <p class="muted">{S.pkmLater}</p>
      {/if}
    {/if}
  {/each}

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

  <FieldsEditor />
  <Curate />

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
