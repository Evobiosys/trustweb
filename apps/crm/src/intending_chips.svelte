<script lang="ts">
  import { MAX_INTENDING } from './fields'
  import { RING_COLORS } from './rings'
  import { S } from './strings'

  interface Props {
    value: number
    /** The date the desire was set, as text; absent when unknown. */
    since?: string
    /** The suggested desire: shown outlined. */
    suggested?: number
    /** The person is already in contact: no new desire to connect can be set (it can still be lowered). */
    locked?: boolean
    onchoose: (n: number) => void
  }
  const { value, since = '', suggested, locked = false, onchoose }: Props = $props()
  const scale = Array.from({ length: MAX_INTENDING + 1 }, (_, i) => i)
</script>

{#if locked && value === 0}
  <p class="muted" data-part="intending-locked" title={S.alreadyInContact}>{S.intendingTitle.split(' (')[0]}: {S.alreadyInContact}</p>
{:else}
<div class="intending" data-part="intending">
  <p class="muted">{S.intendingTitle}{#if since && value > 0} · {S.intendingSince(since)}{/if}</p>
  <div class="ring-chips" role="group" aria-label={S.intendingTitle}>
    {#each scale as n (n)}
      <button class="rchip num" class:suggested={n === suggested} data-intending={n} aria-pressed={value === n} style:--rc={RING_COLORS.intending} onclick={(): void => onchoose(n)}>{n}</button>
    {/each}
  </div>
</div>
{/if}
