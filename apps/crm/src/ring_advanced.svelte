<script lang="ts">
  import FieldInput from './field_input.svelte'
  import { DECEASED_KEY, FAMOUS_KEY, HIDE_KEY, INTENDING_KEY, OLD_INTENDING_KEY, fieldById, valueText } from './fields'
  import type { FieldValue } from './fields'
  import { PERSON_FIELDS } from './person_fields'
  import type { PersonField } from './person_fields'
  import { FAMILY_KEY, RING_KEY } from './rings'
  import { setIntending, valuesOf } from './sorting.svelte'
  import { hideFromTrustweb, saveField } from './sync.svelte'

  interface Props {
    personId: string
    /** The person left every list (hide in trustweb ticked). */
    ongone: () => void
  }
  const { personId, ongone }: Props = $props()

  const FIRST = [DECEASED_KEY, FAMOUS_KEY, HIDE_KEY, FAMILY_KEY, INTENDING_KEY]
  const fields: PersonField[] = [
    ...FIRST.flatMap((k) => fieldById(k) ?? []),
    ...PERSON_FIELDS.filter((f) => !FIRST.includes(f.id) && f.id !== RING_KEY && f.id !== OLD_INTENDING_KEY),
  ]
  const values = $derived(valuesOf(personId))

  function save(key: string, v: FieldValue): void {
    if (key === INTENDING_KEY) setIntending(personId, Number(valueText(v)))
    else if (key === HIDE_KEY && v === true) { hideFromTrustweb(personId); ongone() }
    else saveField(personId, key, v)
  }
</script>

<div class="ring-more" data-part="ring-advanced">
  {#each fields as f (f.id)}
    <FieldInput field={f} label={f.label} value={values[f.id]} onchange={(v): void => save(f.id, v)} />
  {/each}
</div>
