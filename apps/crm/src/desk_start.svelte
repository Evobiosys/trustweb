<script lang="ts">
  import type { Step } from './desk'
  import { prefs, savePrefs } from './prefs.svelte'
  import { S } from './strings'

  interface Props {
    steps: Step[]
  }
  const { steps }: Props = $props()
  const done = $derived(steps.filter((s) => s.done).length)
</script>

<section class="desk-card desk-start" data-part="desk-start">
  <button class="desk-icon-btn desk-dismiss" data-action="dismiss-start" aria-label={S.desk.start.dismiss} title={S.desk.start.dismiss} onclick={(): void => { prefs.startDismissed = true; savePrefs() }}>×</button>
  <h2 class="desk-card-title">{S.desk.start.title}</h2>
  <p class="desk-sub">{S.desk.start.count(done, steps.length)}</p>
  <ul class="desk-steps">
    {#each steps as step (step.key)}
      <li class:desk-done={step.done}><span class="desk-circle-box" aria-hidden="true">{step.done ? '✓' : ''}</span>{S.desk.start[step.key]}</li>
    {/each}
  </ul>
</section>
