<script lang="ts">
  import { CHOICES, OUT_OF_WEB, RING_COLORS, ringColor, ringOf } from './rings'
  import type { Choice } from './rings'
  import { S } from './strings'

  interface Props {
    /** The ring the person is in now (marked pressed); absent on the sorting cards. */
    current?: string
    /** The family tag; the chip shows only when `onfamily` is given. */
    family?: boolean
    onchoose: (choice: Choice) => void
    onfamily?: (on: boolean) => void
  }
  const { current, family = false, onchoose, onfamily }: Props = $props()
</script>

<div class="ring-chips" role="group" aria-label={S.sortTitle}>
  {#each CHOICES as c (c)}
    <button class="rchip" data-choice={c} aria-pressed={current !== undefined && c !== OUT_OF_WEB && ringOf(current) === c}
      style:--rc={c === OUT_OF_WEB ? 'transparent' : ringColor(c)} onclick={(): void => onchoose(c)}>{S.ringChoice[c]}</button>
  {/each}
  {#if onfamily}
    <button class="rchip" data-choice="family" aria-pressed={family} style:--rc={RING_COLORS.family} onclick={(): void => onfamily(!family)}>{S.familyTag}</button>
  {/if}
</div>
