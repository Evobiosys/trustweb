<script lang="ts">
  import { fieldLabelOf } from './fields'
  import { PERSON_FIELDS } from './person_fields'
  import { prefs, savePrefs } from './prefs.svelte'
  import { S } from './strings'

  let ruleKey = $state('')
  let ruleText = $state('')

  function toggleVisible(id: string, on: boolean): void {
    prefs.filters.visible = on ? [...prefs.filters.visible, id] : prefs.filters.visible.filter((x) => x !== id)
    savePrefs()
  }

  function addRule(): void {
    const text = ruleText.trim()
    if (!ruleKey || !text) return
    prefs.filters.rules = [...prefs.filters.rules, { key: ruleKey, text }]
    ruleText = ''
    savePrefs()
  }

  function removeRule(i: number): void {
    prefs.filters.rules = prefs.filters.rules.filter((_, n) => n !== i)
    savePrefs()
  }
</script>

<div class="filters" data-part="filters">
  <label class="fld check"><input type="checkbox" data-filter="deceased" bind:checked={prefs.filters.hideDeceased} onchange={savePrefs} /><span>{S.hideDeceased}</span></label>
  <label class="fld check"><input type="checkbox" data-filter="famous" bind:checked={prefs.filters.hideFamous} onchange={savePrefs} /><span>{S.hideFamous}</span></label>
  <label class="fld check"><input type="checkbox" data-filter="connection" bind:checked={prefs.filters.onlyConnection} onchange={savePrefs} /><span>{S.onlyConnection}</span></label>
  <details class="fields-pop">
    <summary>{S.fieldsPopover}</summary>
    {#each PERSON_FIELDS as f (f.id)}
      <label class="fld check">
        <input type="checkbox" checked={prefs.filters.visible.includes(f.id)} onchange={(e): void => toggleVisible(f.id, e.currentTarget.checked)} />
        <span>{f.label}</span>
      </label>
    {/each}
  </details>
  <div class="row-filter">
    <select class="field" aria-label={S.filterBy} bind:value={ruleKey}>
      <option value="">{S.filterBy}</option>
      {#each PERSON_FIELDS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
    </select>
    <input class="field" type="text" aria-label={S.filterContains} placeholder={S.filterContains} bind:value={ruleText} />
    <button class="btn small" data-action="add-rule" onclick={addRule}>{S.filterAdd}</button>
  </div>
  {#each prefs.filters.rules as r, i (i)}
    <button class="quiet" aria-label={S.filterRemove(fieldLabelOf(r.key))} onclick={(): void => removeRule(i)}>
      {fieldLabelOf(r.key)} {S.filterContains} "{r.text}" ✕
    </button>
  {/each}
</div>
