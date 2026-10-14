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
  import { norm } from './contacts'
  import { baseFields } from './fields'
  import { Kind } from './placement'
  import { effectivePerson, entityValues } from './person_view'
  import { PersonForm } from './nav'
  import { closePerson } from './nav.svelte'
  import { editLine, store } from './state.svelte'
  import { S } from './strings'
  import TagChip from './tag_chip.svelte'
  import { personTimeline } from './timeline'

  interface Props {
    personId: string
  }
  const { personId }: Props = $props()

  let form = $state<PersonForm>(PersonForm.None)
  let editing = $state<string | null>(null)
  let searching = $state(false)
  let find = $state('')

  const raw = $derived(store.app.people.find((p) => p.id === personId))
  const edits = $derived(store.crm.personFields?.[personId])
  const person = $derived(raw && effectivePerson(raw, edits))
  const values = $derived(raw ? entityValues(raw, baseFields(raw), edits) : {})
  const textOf = (l: { id: string; text: string }): string => store.crm.lineEdits?.[l.id]?.text ?? l.text
  const lines = $derived((person?.lines ?? []).filter((l) => l.status === LineStatus.Current && norm(textOf(l)).includes(norm(find.trim()))))
  const events = $derived(person ? personTimeline({ app: store.app, crm: store.crm }, person.id) : [])
  const meta = $derived(
    person === undefined ? '' : person.ring === Ring.Intending
      ? S.sheetPlanned(person.context)
      : S.sheetMet(person.context, fmtDate(person.metAt)),
  )

  function show(next: PersonForm): void {
    form = form === next ? PersonForm.None : next
  }

  const tanaId = (l: object): string | undefined => (l as { tanaId?: string }).tanaId

  /** First press edits the line here; the glyph pressed again (already editing) opens the node in Tana. */
  function glyph(l: { id: string }): void {
    if (editing !== l.id) editing = l.id
    else window.location.href = `tana://?nodeid=${tanaId(l)}`
  }

  function save(l: { id: string; text: string }, text: string): void {
    const t = text.trim()
    if (t && t !== textOf(l)) editLine(l.id, { text: t })
    editing = null
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

    <h3>{S.notes}
      <button class="icon-btn" data-action="note-search" aria-label={S.noteSearch} title={S.noteSearch} aria-expanded={searching}
        onclick={(): void => { searching = !searching; find = '' }}>🔍</button></h3>
    {#if searching}<input class="field" type="search" data-field="note-search" placeholder={S.noteSearchPh} aria-label={S.noteSearch} bind:value={find} />{/if}
    {#each lines as line (line.id)}
      {@const checked = store.crm.lineEdits?.[line.id]?.checkedAt}
      <div class="line">
        {#if tanaId(line)}
          <button class="icon-btn tana-glyph" data-action="tana-glyph" title={editing === line.id ? S.tanaOpen : tanaId(line)} onclick={(): void => glyph(line)}>{S.tanaGlyph}<small>tana-{tanaId(line)?.slice(0, 4)}</small></button>
        {/if}
        {#if editing === line.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="field" data-field="line-edit" autofocus value={textOf(line)} onblur={(e): void => save(line, e.currentTarget.value)}
            onkeydown={(e): void => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') editing = null }} />
        {:else}
          <button class="line-text" data-action="line-edit" onclick={(): void => { editing = line.id }}>{textOf(line)}</button>
        {/if}
        <TagChip {line} /><em>{S.audienceLabel[line.audience]}</em>
        <button class="icon-btn still" data-action="still-true" aria-label={S.stillTrueTip}
          title={checked ? S.stillTrueOn(fmtDate(checked)) : S.stillTrueTip} onclick={(): void => editLine(line.id, { checkedAt: Date.now() })}>{checked ? '✔' : '✓'}</button>
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
