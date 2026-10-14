<script lang="ts">
  import { valueText } from './fields'
  import type { FieldValue } from './fields'
  import type { PersonField } from './person_fields'
  import { S } from './strings'

  interface Props {
    /** Absent for an ad hoc field. */
    field?: PersonField
    label: string
    value: FieldValue | undefined
    onchange: (v: FieldValue) => void
  }
  const { field, label, value, onchange }: Props = $props()

  const text = $derived(valueText(value))
  const options = $derived(field?.options ?? [])

  function str(e: Event): string {
    return (e.currentTarget as HTMLInputElement | HTMLSelectElement).value
  }
</script>

{#if field?.type === 'checkbox' || typeof value === 'boolean'}
  <label class="fld check" data-field={field?.id ?? label}>
    <input type="checkbox" checked={value === true} onchange={(e): void => onchange(e.currentTarget.checked)} />
    <span>{label}</span>
  </label>
{:else}
  <label class="fld" data-field={field?.id ?? label}>
    <span>{label}{#if !field} <em>({S.adhocBadge})</em>{/if}</span>
    {#if field?.description}<small>{field.description}</small>{/if}
    {#if options.length}
      <select class="field" value={text} onchange={(e): void => onchange(str(e))}>
        <option value="">{S.optionNone}</option>
        {#each options as o (o.id)}<option value={o.label}>{o.label}</option>{/each}
        {#if text && !options.some((o) => o.label === text)}<option value={text}>{text}</option>{/if}
      </select>
    {:else}
      <input class="field" type={field?.type === 'url' ? 'url' : 'text'} value={text} onchange={(e): void => onchange(str(e))} />
    {/if}
  </label>
{/if}
