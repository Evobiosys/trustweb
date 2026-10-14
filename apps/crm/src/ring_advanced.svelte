<script lang="ts">
  import FieldInput from './field_input.svelte'
  import { DECEASED_KEY, FAMOUS_KEY, HIDE_KEY, INTENDING_KEY, OLD_INTENDING_KEY, fieldById, valueText } from './fields'
  import type { FieldValue } from './fields'
  import { PERSON_FIELDS } from './person_fields'
  import type { PersonField } from './person_fields'
  import { drag, grip } from './drag.svelte'
  import { prefs, savePrefs } from './prefs.svelte'
  import { FAMILY_KEY, RING_KEY } from './rings'
  import { S } from './strings'
  import { setIntending, valuesOf } from './sorting.svelte'
  import { hideFromTrustweb, saveField } from './sync.svelte'

  interface Props {
    personId: string
    /** The person left every list (hide in trustweb ticked). */
    ongone: () => void
  }
  const { personId, ongone }: Props = $props()

  const FIRST = [DECEASED_KEY, FAMOUS_KEY, HIDE_KEY, INTENDING_KEY]
  const schema: PersonField[] = [
    ...FIRST.flatMap((k) => fieldById(k) ?? []),
    ...PERSON_FIELDS.filter((f) => !FIRST.includes(f.id) && f.id !== RING_KEY && f.id !== FAMILY_KEY && f.id !== OLD_INTENDING_KEY),
  ]
  const rank = (id: string): number => { const i = prefs.advancedOrder.indexOf(id); return i < 0 ? prefs.advancedOrder.length : i }
  const fields = $derived([...schema].sort((a, b) => rank(a.id) - rank(b.id)))
  const values = $derived(valuesOf(personId))

  /** Long-press drop: the field moves before another (end when null); the order is kept per device. */
  function reorder(key: string, _section: unknown, before: string | null): void {
    const ids = fields.map((f) => f.id).filter((id) => id !== key)
    ids.splice(before === null ? ids.length : Math.max(ids.indexOf(before), 0), 0, key)
    prefs.advancedOrder = ids
    savePrefs()
  }

  function save(key: string, v: FieldValue): void {
    if (key === INTENDING_KEY) setIntending(personId, Number(valueText(v)))
    else if (key === HIDE_KEY && v === true) { hideFromTrustweb(personId); ongone() }
    else saveField(personId, key, v)
  }
</script>

<div class="ring-more zone" class:over={drag.key !== null && drag.zone === 'ring-advanced'} data-zone="ring-advanced" data-part="ring-advanced">
  {#each fields as f (f.id)}
    <div class="slot" class:before={drag.key !== null && drag.before === f.id} class:lifted={drag.key === f.id} data-slot={f.id}>
      <span class="grip" role="presentation" data-key={f.id} aria-label={S.dragField} use:grip={reorder}>⋮⋮</span>
      <FieldInput field={f} label={f.label} value={values[f.id]} onchange={(v): void => save(f.id, v)} />
    </div>
  {/each}
</div>
