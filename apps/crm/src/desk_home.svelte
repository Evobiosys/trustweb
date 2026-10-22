<script lang="ts">
  import Avatar from './avatar.svelte'
  import { dateInputIn, endOfDay, parseDateInput } from './dates'
  import { birthdays, cadenceLabel, commandOptions, deskEvents, greeting, resurface, shortDate } from './desk'
  import type { CommandOption, DeskData } from './desk'
  import DeskIcon from './desk_icon.svelte'
  import { shownName } from './display'
  import { InteractionKind } from './model'
  import { nav, openContact, openPerson } from './nav.svelte'
  import { prefs } from './prefs.svelte'
  import { addFollowUp, addInteraction, markContacted, snoozeKeepInTouch, store } from './state.svelte'
  import { S } from './strings'
  import { noteToTana } from './sync.svelte'

  interface Props {
    data: DeskData
  }
  const { data }: Props = $props()

  const DAY = 86_400_000
  const REMINDERS_SHOWN = 5
  const people = $derived(data.view.app.people)
  const me = $derived(store.app.me.displayName.trim().split(/\s+/)[0] ?? '')
  const events = $derived(deskEvents(store.app.events, data.now))
  const resurfaced = $derived(resurface(data.view, data.past, data.now, prefs.activityDays))
  const bdays = $derived(birthdays(data.view, data.values, data.now))
  const kit = $derived(data.kit.filter((r) => r.due))
  const reminders = $derived(data.reminders.slice(0, REMINDERS_SHOWN))
  const nameOf = (id: string): string => people.find((p) => p.id === id)?.name ?? ''

  let text = $state('')
  let said = $state('')
  const options = $derived(commandOptions(text, people))
  const label = (o: CommandOption): string => {
    const who = nameOf(o.personId ?? '')
    return o.kind === 'remind' ? `${S.desk.remind(o.text)} (${who})` : o.kind === 'note' ? `${S.desk.note(o.text)} (${who})`
      : o.kind === 'open' ? S.desk.open(who) : S.desk.searchPeople(o.text)
  }

  function run(o: CommandOption | undefined): void {
    if (!o) return
    const id = o.personId ?? ''
    if (o.kind === 'remind') {
      addFollowUp(id, o.text, endOfDay(data.now + DAY))
      said = S.desk.reminderDone(nameOf(id))
    } else if (o.kind === 'note') {
      addInteraction(id, InteractionKind.Note, o.text)
      noteToTana(id, o.text)
      said = S.desk.noteDone(nameOf(id))
    } else if (o.kind === 'open') openPerson(id)
    else nav.deskQuery = o.text
    text = ''
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(options[0]) } else if (e.key === 'Escape') text = ''
  }

  function snooze(id: string, value: string): void {
    const day = parseDateInput(value)
    if (day !== null) snoozeKeepInTouch(id, endOfDay(day))
  }
</script>

{#snippet who(id: string, display: string, sub: string, open: () => void)}
  <button class="desk-link" onclick={open}><Avatar {id} name={shownName(display)} /><strong>{shownName(display)}</strong>{#if sub}<span class="desk-dot">·</span><span class="desk-sub">{sub}</span>{/if}</button>
{/snippet}

<div class="desk-home" data-screen="desk-home">
  <h1 class="desk-greeting" data-part="desk-greeting">{greeting(new Date(data.now).getHours(), me)}</h1>

  <div class="desk-command">
    <textarea class="desk-command-input" data-field="desk-command" placeholder={S.desk.commandPh} aria-label={S.desk.commandPh} bind:value={text} onkeydown={key}></textarea>
    <button class="desk-send" data-action="desk-send" aria-label={S.desk.run} disabled={options.length === 0} onclick={(): void => run(options[0])}><DeskIcon name="up" size={18} /></button>
  </div>
  {#if options.length}
    <ul class="desk-options" data-part="desk-options">
      {#each options as o (o.kind)}<li><button class="desk-link" data-option={o.kind} onclick={(): void => run(o)}>{label(o)}</button></li>{/each}
    </ul>
  {/if}
  {#if said}<p class="desk-said" role="status" data-part="desk-said">{said}</p>{/if}

  {#if events.length}
    <section class="desk-section" data-section="events"><h2 class="desk-label">{S.desk.sections.events}</h2>
      {#each events as e (e.id)}
        <div class="desk-row"><span class="desk-row-icon"><DeskIcon name="calendar" size={16} /></span><span class="desk-grow">{e.name}</span><span class="desk-sub desk-when">{e.when}</span></div>
      {/each}
    </section>
  {/if}

  {#if resurfaced.length}
    <section class="desk-section" data-section="resurface"><h2 class="desk-label">{S.desk.sections.resurface}</h2>
      {#each resurfaced as r (r.person.id)}
        <div class="desk-row">{@render who(r.person.id, r.person.name, r.context, (): void => openPerson(r.person.id))}</div>
      {/each}
    </section>
  {/if}

  {#if bdays.length}
    <section class="desk-section" data-section="birthdays"><h2 class="desk-label">{S.desk.sections.birthdays}</h2>
      {#each bdays as b (b.personId ?? b.contactId)}
        <div class="desk-row">{@render who(b.personId ?? b.contactId ?? '', b.name, b.role, (): void => (b.personId ? openPerson(b.personId) : openContact(b.contactId ?? '')))}<span class="desk-sub desk-when">{shortDate(b.at)}</span></div>
      {/each}
    </section>
  {/if}

  {#if kit.length}
    <section class="desk-section" data-section="keep-in-touch"><h2 class="desk-label">{S.desk.sections.keepInTouch}</h2>
      {#each kit as r (r.person.id)}
        <div class="desk-row desk-kit" data-kit={r.person.id}>
          {@render who(r.person.id, r.person.name, r.person.context, (): void => openPerson(r.person.id))}
          <span class="desk-pill">{cadenceLabel(r.everyDays)}</span>
          <span class="desk-act">
            <button class="desk-icon-btn" data-action="mark-contacted" aria-label={S.desk.contacted} title={S.desk.contacted} onclick={(): void => markContacted(r.person.id)}><DeskIcon name="check" size={16} /></button>
            <input class="desk-snooze" type="date" aria-label={S.desk.snooze} title={S.desk.snooze} min={dateInputIn(1, data.now)} onchange={(e): void => snooze(r.person.id, e.currentTarget.value)} />
          </span>
          <span class="desk-sub desk-when desk-warn">{shortDate(r.dueAt)}</span>
        </div>
      {/each}
    </section>
  {/if}

  {#if reminders.length}
    <section class="desk-section" data-section="reminders"><h2 class="desk-label">{S.desk.sections.reminders}</h2>
      {#each reminders as f (f.id)}
        <div class="desk-row">
          <button class="desk-link" onclick={(): void => openPerson(f.personId)}><span class="desk-row-icon"><DeskIcon name="alarm" size={16} /></span><span class="desk-grow">{f.text}</span></button>
          <Avatar id={f.personId} name={shownName(nameOf(f.personId))} />
          <span class="desk-sub desk-when" class:desk-warn={f.dueAt <= data.now}>{f.dueAt <= data.now ? S.desk.overdue : S.desk.today}</span>
        </div>
      {/each}
    </section>
  {/if}
</div>
