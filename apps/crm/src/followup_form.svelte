<script lang="ts">
  import { dateInputIn, endOfDay, parseDateInput } from './dates'
  import { addFollowUp } from './state.svelte'
  import { S } from './strings'

  interface Props {
    personId: string
    onclose: () => void
  }
  const { personId, onclose }: Props = $props()

  const DEFAULT_DAYS = 7

  let text = $state('')
  let due = $state(dateInputIn(DEFAULT_DAYS))
  const ready = $derived(text.trim().length > 0 && parseDateInput(due) !== null)

  function submit(e: SubmitEvent): void {
    e.preventDefault()
    const day = parseDateInput(due)
    if (!ready || day === null) return
    addFollowUp(personId, text, endOfDay(day))
    onclose()
  }
</script>

<form class="inline-form" onsubmit={submit}>
  <input class="field" data-field="followup-text" placeholder={S.followUpPh} aria-label={S.followUpPh} bind:value={text} />
  <input class="field" type="date" aria-label={S.dueDateLabel} bind:value={due} />
  <div class="form-actions">
    <button class="btn small" type="submit" data-action="save-followup" disabled={!ready}>{S.save}</button>
    <button class="quiet" type="button" onclick={onclose}>{S.cancel}</button>
  </div>
</form>
