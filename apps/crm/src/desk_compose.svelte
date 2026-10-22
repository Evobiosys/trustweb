<script lang="ts">
  import type { Person } from '../../trustweb/src/model'
  import DeskPick from './desk_pick.svelte'
  import FollowUpForm from './followup_form.svelte'
  import InteractionForm from './interaction_form.svelte'
  import { shownName } from './display'
  import { S } from './strings'

  interface Props {
    kind: 'reminder' | 'note'
    people: readonly Person[]
    onclose: () => void
  }
  const { kind, people, onclose }: Props = $props()

  let query = $state('')
  let picked = $state<Person | null>(null)
</script>

<section class="desk-card desk-compose" data-part="desk-compose">
  <h2 class="desk-card-title">{kind === 'reminder' ? S.desk.addReminder : S.desk.addNote}{#if picked}: {shownName(picked.name)}{/if}</h2>
  {#if picked}
    {#if kind === 'reminder'}<FollowUpForm personId={picked.id} {onclose} />{:else}<InteractionForm personId={picked.id} {onclose} />{/if}
  {:else}
    <DeskPick {people} bind:query placeholder={S.desk.pickPerson} field="desk-compose-person" onpick={(id): void => { picked = people.find((p) => p.id === id) ?? null }} />
    <button class="quiet" onclick={onclose}>{S.cancel}</button>
  {/if}
</section>
