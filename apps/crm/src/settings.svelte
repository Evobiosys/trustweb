<script lang="ts">
  import { PERSON_FIELDS } from './person_fields'
  import { PKMS, Pkm, prefs, savePrefs } from './prefs.svelte'
  import { S } from './strings'

  const FIELDS = PERSON_FIELDS.filter((f) => f.id !== 'tw-ring')

  function setMandatory(id: string, on: boolean): void {
    prefs.mandatory = on ? [...prefs.mandatory, id] : prefs.mandatory.filter((x) => x !== id)
    savePrefs()
  }
</script>

<section data-screen="settings">
  <h2 class="screen-title">{S.settingsTitle}</h2>
  <label class="fld">
    <span>{S.pkmQuestion}</span>
    <select class="field" data-field="pkm" bind:value={prefs.pkm} onchange={savePrefs}>
      {#each PKMS as p (p)}<option value={p}>{S.pkmLabel[p]}</option>{/each}
    </select>
  </label>
  {#if prefs.pkm === Pkm.AppleNotes}
    <p class="muted">{S.pkmAppleLater}</p>
  {:else if prefs.pkm === Pkm.Tana}
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
  {/if}

  <h3 class="screen-title">{S.mandatoryTitle}</h3>
  <p class="muted">{S.mandatoryHint}</p>
  {#each FIELDS as f (f.id)}
    <label class="fld check">
      <input type="checkbox" checked={prefs.mandatory.includes(f.id)} onchange={(e): void => setMandatory(f.id, e.currentTarget.checked)} />
      <span>{f.label}</span>
    </label>
  {/each}
</section>
