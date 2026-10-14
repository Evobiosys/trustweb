<script lang="ts">
  import { INTERACTION_KINDS, InteractionKind } from './model'
  import { inputToAt, todayInputValue } from './dates'
  import { addInteraction } from './state.svelte'
  import { noteToTana } from './sync.svelte'
  import { S } from './strings'

  interface Props {
    personId: string
    onclose: () => void
  }
  const { personId, onclose }: Props = $props()

  let kind = $state<InteractionKind>(InteractionKind.Met)
  let text = $state('')
  let place = $state('')
  let date = $state(todayInputValue())
  const ready = $derived(text.trim().length > 0)

  function submit(e: SubmitEvent): void {
    e.preventDefault()
    if (!ready) return
    const at = inputToAt(date, Date.now())
    addInteraction(personId, kind, text, place, at)
    if (kind === InteractionKind.Note) noteToTana(personId, text, at)
    onclose()
  }
</script>

<form class="inline-form" onsubmit={submit}>
  <select class="field" aria-label={S.kindLabel} bind:value={kind}>
    {#each INTERACTION_KINDS as k (k)}
      <option value={k}>{S.interactionKind[k]}</option>
    {/each}
  </select>
  <input class="field" data-field="interaction-text" placeholder={S.interactionPh} aria-label={S.interactionPh} bind:value={text} />
  <input class="field" data-field="interaction-place" placeholder={S.placePh} aria-label={S.placePh} bind:value={place} />
  <input class="field" type="date" aria-label={S.dateLabel} bind:value={date} />
  <div class="form-actions">
    <button class="btn small" type="submit" data-action="save-interaction" disabled={!ready}>{S.save}</button>
    <button class="quiet" type="button" onclick={onclose}>{S.cancel}</button>
  </div>
</form>
