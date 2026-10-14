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
    /** Why this field does not sync to Tana, and where to finish it by hand. */
    nosync?: { reason: string; href?: string }
  }
  const { field, label, value, onchange, nosync }: Props = $props()

  let why = $state(false)

  const text = $derived(valueText(value))
  const options = $derived(field?.options ?? [])
  /** TrustWeb-only option fields keep the option id; Tana's keep the label (what Tana shows). */
  const byId = $derived(field !== undefined && field.tanaAttributeId === null)
  const selected = $derived(byId ? (options.find((o) => o.id === text)?.id ?? '') : text)

  function str(e: Event): string {
    return (e.currentTarget as HTMLInputElement | HTMLSelectElement).value
  }
</script>

<div class="fld-wrap">
  {#if field?.type === 'checkbox' || typeof value === 'boolean'}
    <label class="fld check" data-field={field?.id ?? label}>
      <input type="checkbox" checked={value === true} onchange={(e): void => onchange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  {:else}
    <label class="fld" data-field={field?.id ?? label}>
      <span>{label}{#if !field} <em>({S.adhocBadge})</em>{/if}</span>
      {#if field?.description && field.tanaAttributeId}<small>{field.description}</small>{/if}
      {#if options.length}
        <select class="field" value={selected} onchange={(e): void => onchange(str(e))}>
          <option value="">{S.optionNone}</option>
          {#each options as o (o.id)}<option value={byId ? o.id : o.label}>{o.label}</option>{/each}
          {#if !byId && text && !options.some((o) => o.label === text)}<option value={text}>{text}</option>{/if}
        </select>
      {:else}
        <input class="field" type={field?.type === 'url' ? 'url' : 'text'} value={text} onchange={(e): void => onchange(str(e))} />
      {/if}
    </label>
  {/if}
  {#if nosync}
    <button class="nosync" data-action="nosync" aria-label={S.noSync} aria-expanded={why} onclick={(): void => { why = !why }}>⊘</button>
  {/if}
</div>
{#if nosync && why}
  <p class="nosync-why" data-part="nosync-why">
    {nosync.reason}{#if nosync.href} <a href={nosync.href}>{S.openInTana}</a>{/if}
  </p>
{/if}
