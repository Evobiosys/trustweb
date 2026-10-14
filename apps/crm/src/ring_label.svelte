<script lang="ts">
  import RingChips from './ring_chips.svelte'
  import { FAMILY_KEY, RING_COLORS, SUGGESTED_NOTE, ringColor } from './rings'
  import { fileUnder, setFamily, valuesOf } from './sorting.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { saveField } from './sync.svelte'

  interface Props {
    personId: string
    ring: string
  }
  const { personId, ring }: Props = $props()

  let open = $state(false)
  /** The ring came from a suggestion and has not been tapped yet: a first tap confirms it (a ring edit is the confirmation). */
  const suggested = $derived(store.app.people.find((x) => x.id === personId)?.lines.some((l) => l.text === SUGGESTED_NOTE) === true
    && store.crm.personFields?.[personId]?.['tw-ring'] === undefined)
  const family = $derived(valuesOf(personId)[FAMILY_KEY] === true)
</script>

<button class="ring-label" class:suggested data-action="ring-label" style:--rc={ringColor(ring)} aria-expanded={open}
  title={suggested ? S.ringSuggestedTip : S.ringOpen(S.ringLabel[ring] ?? ring)} onclick={(): void => { if (suggested) saveField(personId, 'tw-ring', ring); open = !open }}>{S.ringLabel[ring] ?? ring}</button>
{#if family}<span class="family-dot" data-part="family" style:background={RING_COLORS.family} title={S.familyTag} role="img" aria-label={S.familyTag}></span>{/if}
{#if open}<RingChips current={ring} {family} onchoose={(c): void => { fileUnder(personId, c); open = false }} onfamily={(on): void => { setFamily(personId, on) }} />{/if}
