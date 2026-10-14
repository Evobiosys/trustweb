<script lang="ts">
  import RingChips from './ring_chips.svelte'
  import { ringColor } from './rings'
  import { fileUnder, valuesOf } from './sorting.svelte'
  import { S } from './strings'

  interface Props {
    personId: string
    ring: string
  }
  const { personId, ring }: Props = $props()

  let open = $state(false)
</script>

<button class="ring-label" data-action="ring-label" style:--rc={ringColor(ring, valuesOf(personId))} aria-expanded={open}
  title={S.ringOpen(S.ringLabel[ring] ?? ring)} onclick={(): void => { open = !open }}>{S.ringLabel[ring] ?? ring}</button>
{#if open}<RingChips current={ring} onchoose={(c): void => { fileUnder(personId, c); open = false }} />{/if}
