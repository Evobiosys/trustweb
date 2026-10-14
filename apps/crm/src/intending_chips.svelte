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
    onchoose: (n: number) => void
  }
  const { value, since = '', suggested, onchoose }: Props = $props()
  const scale = Array.from({ length: MAX_INTENDING + 1 }, (_, i) => i)
</script>

<div class="intending" data-part="intending">
  <p class="muted">{S.intendingTitle}{#if since && value > 0} · {S.intendingSince(since)}{/if}</p>
  <div class="ring-chips" role="group" aria-label={S.intendingTitle}>
    {#each scale as n (n)}
      <button class="rchip num" class:suggested={n === suggested} data-intending={n} aria-pressed={value === n} style:--rc={RING_COLORS.intending} onclick={(): void => onchoose(n)}>{n}</button>
    {/each}
  </div>
</div>
