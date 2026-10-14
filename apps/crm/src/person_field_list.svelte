<script lang="ts">
  import type { Person } from '../../trustweb/src/model'
  import FieldInput from './field_input.svelte'
  import { ADHOC, baseFields, fieldLabelOf, isSet, mergedFields } from './fields'
  import type { FieldValue } from './fields'
  import { PERSON_FIELDS } from './person_fields'
  import { prefs, savePrefs } from './prefs.svelte'
  import { setField, store } from './state.svelte'
  import { S } from './strings'

  interface Props {
    person: Person
  }
  const { person }: Props = $props()

  /** The ring is edited in the header, not here. */
  const EDITABLE = PERSON_FIELDS.filter((f) => f.id !== 'tw-ring')

  let added = $state<string[]>([])

  const values = $derived(mergedFields(baseFields(person), store.crm.personFields?.[person.id]))
  const mandatory = $derived(EDITABLE.filter((f) => prefs.mandatory.includes(f.id)))
  const optional = $derived(EDITABLE.filter((f) => !prefs.mandatory.includes(f.id)))
  const optionalShown = $derived(optional.filter((f) => isSet(values[f.id]) || added.includes(f.id)))
  const addable = $derived(optional.filter((f) => !optionalShown.includes(f)))
  const adhoc = $derived(Object.keys(values).filter((k) => k.startsWith(ADHOC) && isSet(values[k])))
  const count = $derived(optionalShown.length + adhoc.length)

  function toggle(): void {
    prefs.optionalOpen = !prefs.optionalOpen
    savePrefs()
  }

  function pick(e: Event): void {
    const sel = e.currentTarget as HTMLSelectElement
    if (sel.value) added = [...added, sel.value]
    sel.value = ''
  }

  function save(key: string, v: FieldValue): void {
    setField(person.id, key, v)
  }
</script>

<h3>{S.fieldsMandatory}</h3>
<div class="fields" data-part="mandatory">
  {#each mandatory as f (f.id)}
    <FieldInput field={f} label={f.label} value={values[f.id]} onchange={(v): void => save(f.id, v)} />
  {/each}
</div>

<h3>{S.fieldsOptional}</h3>
<button class="link" data-action="toggle-optional" aria-expanded={prefs.optionalOpen} onclick={toggle}>
  {prefs.optionalOpen ? S.fieldsOptionalHide : S.fieldsOptionalShow(count)}
</button>
{#if prefs.optionalOpen}
  <div class="fields" data-part="optional">
    {#each optionalShown as f (f.id)}
      <FieldInput field={f} label={f.label} value={values[f.id]} onchange={(v): void => save(f.id, v)} />
    {/each}
    {#each adhoc as k (k)}
      <FieldInput label={fieldLabelOf(k)} value={values[k]} onchange={(v): void => save(k, v)} />
    {/each}
    {#if addable.length}
      <select class="field" aria-label={S.addField} data-action="add-field" onchange={pick}>
        <option value="">{S.addField}</option>
        {#each addable as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
      </select>
    {/if}
  </div>
{/if}
