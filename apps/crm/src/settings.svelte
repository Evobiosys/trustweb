<script lang="ts">
  import Curate from './curate.svelte'
  import FieldsEditor from './fields_editor.svelte'
  import { PKMS, Pkm, prefs, savePrefs } from './prefs.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { flush, sync } from './sync.svelte'
  import { manualItems } from './tana_sync'

  const manual = $derived(manualItems(store.app.people, store.crm.personFields))

  function togglePkm(p: Pkm, on: boolean): void {
    prefs.pkms = on ? [...prefs.pkms, p] : prefs.pkms.filter((x) => x !== p)
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

  <h3 class="screen-title">{S.activityTitle}</h3>
  <p class="muted">{S.activityHint}</p>
  <label class="fld"><span>{S.activityDays}</span>
    <input class="field" type="number" min="1" data-field="activity-days" value={prefs.activityDays} onchange={setDays} /></label>

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
