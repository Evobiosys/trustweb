<script lang="ts">
  import { CADENCES, cadenceLabel } from './desk'
  import { setKeepInTouch, store } from './state.svelte'
  import { S } from './strings'

  interface Props {
    personId: string
  }
  const { personId }: Props = $props()

  const current = $derived(store.crm.keepInTouch?.[personId]?.everyDays ?? 0)
</script>

<select class="field desk-select" data-field="keep-in-touch" aria-label={S.desk.keepLabel} value={current}
  onchange={(e): void => setKeepInTouch(personId, Number(e.currentTarget.value) || null)}>
  <option value={0}>{S.desk.cadenceNone}</option>
  {#each CADENCES as n (n)}<option value={n}>{cadenceLabel(n)}</option>{/each}
</select>
