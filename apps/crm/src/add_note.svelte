<script lang="ts">
  import { S } from './strings'
  import { addNote } from './sync.svelte'

  interface Props {
    personId: string
  }
  const { personId }: Props = $props()

  let text = $state('')

  function submit(e: SubmitEvent): void {
    e.preventDefault()
    addNote(personId, text)
    text = ''
  }
</script>

<form class="inline-form" onsubmit={submit}>
  <input class="field" data-field="add-note" placeholder={S.addNote} aria-label={S.addNote} bind:value={text} />
  <button class="btn small" type="submit" data-action="add-note" disabled={text.trim() === ''}>{S.save}</button>
</form>
