<script lang="ts">
  import { CHOICES, OUT_OF_WEB, ringColor, ringOf } from './rings'
  import type { Choice } from './rings'
  import { S } from './strings'

  interface Props {
    /** The ring the person is in now (marked pressed); absent on the sorting cards. */
    current?: string
    onchoose: (choice: Choice) => void
  }
  const { current, onchoose }: Props = $props()
</script>

<div class="ring-chips" role="group" aria-label={S.sortTitle}>
  {#each CHOICES as c (c)}
    <button class="rchip" data-choice={c} aria-pressed={current !== undefined && c !== OUT_OF_WEB && ringOf(current) === c}
      style:--rc={c === OUT_OF_WEB ? 'transparent' : ringColor(c)} onclick={(): void => onchoose(c)}>{S.ringChoice[c]}</button>
  {/each}
</div>
