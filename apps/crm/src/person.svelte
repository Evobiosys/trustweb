<script lang="ts">
  import { LineStatus, Ring } from '../../trustweb/src/model'
  import Avatar from './avatar.svelte'
  import ContactInfo from './contact_info.svelte'
  import { fmtDate } from './dates'
  import { shownName } from './display'
  import EventRow from './event_row.svelte'
  import FollowUpForm from './followup_form.svelte'
  import InteractionForm from './interaction_form.svelte'
  import RingLabel from './ring_label.svelte'
  import LogNow from './log_now.svelte'
  import EntityFields from './entity_fields.svelte'
  import { baseFields } from './fields'
  import { Kind } from './placement'
  import { effectivePerson, entityValues } from './person_view'
  import { PersonForm } from './nav'
  import { closePerson } from './nav.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import TagChip from './tag_chip.svelte'
  import { personTimeline } from './timeline'

  interface Props {
    personId: string
  }
  const { personId }: Props = $props()

  let form = $state<PersonForm>(PersonForm.None)

  const raw = $derived(store.app.people.find((p) => p.id === personId))
  const edits = $derived(store.crm.personFields?.[personId])
  const person = $derived(raw && effectivePerson(raw, edits))
  const values = $derived(raw ? entityValues(raw, baseFields(raw), edits) : {})
  const lines = $derived((person?.lines ?? []).filter((l) => l.status === LineStatus.Current))
  const events = $derived(person ? personTimeline({ app: store.app, crm: store.crm }, person.id) : [])
  const meta = $derived(
    person === undefined ? '' : person.ring === Ring.Intending
      ? S.sheetPlanned(person.context)
      : S.sheetMet(person.context, fmtDate(person.metAt)),
  )

  function show(next: PersonForm): void {
    form = form === next ? PersonForm.None : next
  }

  function closeForm(): void {
    form = PersonForm.None
  }
</script>

<section class="person" data-screen="person">
  <button class="back" onclick={closePerson}>&larr; {S.back}</button>
  {#if person}
    <div class="person-head">
      <Avatar id={person.id} name={shownName(person.name)} />
      <div>
        <h2>{shownName(person.name)}</h2>
        <p class="meta-line"><RingLabel personId={person.id} ring={person.ring} /> · {meta}</p>
        <p class="meta-line">{person.peerId ? S.sheetConnected : S.sheetNotesOnly}</p>
      </div>
    </div>

    <ContactInfo {person} />

    <EntityFields kind={Kind.Person} id={person.id} {values} />

    <h3>{S.notes}</h3>
    {#each lines as line (line.id)}
      <div class="line">
        <p>{line.text}</p>
        <TagChip {line} /><em>{S.audienceLabel[line.audience]}</em>
      </div>
    {:else}
      <p class="muted">{S.sheetNoNotes}</p>
    {/each}

    <h3>{S.personTimeline}</h3>
    <LogNow personId={person.id} />
    <div class="add-actions">
      <button class="btn small" data-action="add-interaction" onclick={(): void => show(PersonForm.Interaction)}>{S.addInteraction}</button>
      <button class="btn small ghost" data-action="add-followup" onclick={(): void => show(PersonForm.FollowUp)}>{S.addFollowUp}</button>
    </div>
    {#if form === PersonForm.Interaction}
      <InteractionForm personId={person.id} onclose={closeForm} />
    {:else if form === PersonForm.FollowUp}
      <FollowUpForm personId={person.id} onclose={closeForm} />
    {/if}
    {#each events as event (event.id)}
      <EventRow {event} showDate={true} />
    {:else}
      <p class="muted">{S.nothingYet}</p>
    {/each}
  {:else}
    <p class="empty">{S.noPeople}</p>
  {/if}
</section>
