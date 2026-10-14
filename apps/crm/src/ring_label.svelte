<script lang="ts">
  import RingChips from './ring_chips.svelte'
  import { FAMILY_KEY, RING_COLORS, ringColor } from './rings'
  import { fileUnder, setFamily, valuesOf } from './sorting.svelte'
  import { S } from './strings'

  interface Props {
    personId: string
    ring: string
  }
  const { personId, ring }: Props = $props()

  let open = $state(false)
  const family = $derived(valuesOf(personId)[FAMILY_KEY] === true)
</script>

<button class="ring-label" data-action="ring-label" style:--rc={ringColor(ring)} aria-expanded={open}
  title={S.ringOpen(S.ringLabel[ring] ?? ring)} onclick={(): void => { open = !open }}>{S.ringLabel[ring] ?? ring}</button>
{#if family}<span class="family-dot" data-part="family" style:background={RING_COLORS.family} title={S.familyTag} role="img" aria-label={S.familyTag}></span>{/if}
{#if open}<RingChips current={ring} {family} onchoose={(c): void => { fileUnder(personId, c); open = false }} onfamily={(on): void => { setFamily(personId, on) }} />{/if}
