<!--
  One timeline event: an icon circle for its kind, the text, a meta line.
  The row shape and the icon paths are adapted from 900CRM's ActivityFeed.svelte
  (https://github.com/900Labs/900CRM, apps/desktop/src/lib/components/ActivityFeed.svelte,
  Copyright 2026 900 Labs, Apache License 2.0: see third_party/900crm/LICENSE and
  NOTICE.txt). Changes: TrustWeb's derived event kinds instead of 900CRM's
  activities, no relationship breadcrumbs, a Done/Reopen control on follow-ups.
-->
<script lang="ts">
  import { fmtDate } from './dates'
  import { dueText } from './display'
  import { InteractionKind } from './model'
  import { openPerson } from './nav.svelte'
  import { setFollowUpDone } from './state.svelte'
  import { S } from './strings'
  import TagChip from './tag_chip.svelte'
  import type { TimelineEvent } from './timeline'
  import { EventKind } from './timeline'

  interface Props {
    event: TimelineEvent
    /** Show the date in the row (a per-person list); a day-grouped list has its own heading. */
    showDate: boolean
    /** When set, the row names the person as a button that opens them. */
    name?: string
  }
  const { event, showDate, name }: Props = $props()

  /** SVG paths (24x24 stroke icons) per event or interaction kind; from 900CRM, with "met" and "note" added. */
  const ICONS: Record<string, string> = {
    task: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    call: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.5 2 2 0 0 1 3.6 2.32h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l.76-.76a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
    meeting: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm4 2v-2a4 4 0 0 0-3-3.87',
    message: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
    visit: 'M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11zM12 11a2 2 0 110-4 2 2 0 010 4z',
    note: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
    link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    check: 'M20 6L9 17l-5-5',
  }

  function iconFor(e: TimelineEvent): string {
    if (e.interaction) {
      switch (e.interaction.kind) {
        case InteractionKind.Met: return ICONS.meeting
        case InteractionKind.Call: return ICONS.call
        case InteractionKind.Message: return ICONS.message
        case InteractionKind.Event: return ICONS.visit
        case InteractionKind.Note: return ICONS.note
      }
    }
    switch (e.kind) {
      case EventKind.Met: case EventKind.Planned: return ICONS.meeting
      case EventKind.Connected: return ICONS.link
      case EventKind.Ask: return ICONS.message
      case EventKind.Reviewed: return ICONS.check
      case EventKind.FollowUp: return ICONS.task
      default: return ICONS.note
    }
  }

  const now = Date.now()
  const label = $derived(event.interaction ? S.interactionKind[event.interaction.kind] : S.eventKind[event.kind])
  const followUp = $derived(event.kind === EventKind.FollowUp ? event.followUp : undefined)
  const isDone = $derived(followUp?.doneAt !== undefined)
  const icon = $derived(iconFor(event))

  function open(): void {
    openPerson(event.personId)
  }

  function toggleDone(): void {
    if (followUp) setFollowUpDone(followUp.id, !isDone)
  }
</script>

<div class="event kind-{event.kind}" class:is-done={isDone} data-at={event.at}>
  <div class="event-icon" aria-hidden="true">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={icon} /></svg>
  </div>
  <div class="event-body">
    <div class="event-head">
      {#if showDate}<span>{fmtDate(event.at)}</span>{/if}
      <span class="event-kind">{label}</span>
      {#if name !== undefined}<button class="link" onclick={open}>{name}</button>{/if}
    </div>
    <p class="event-text">{event.text}</p>
    {#if event.interaction?.place}<small>{event.interaction.place}</small>{/if}
    {#if event.line || followUp}
      <div class="event-foot">
        {#if event.line}<TagChip line={event.line} />{/if}
        {#if followUp}
          <small>{dueText(followUp, now)}</small>
          <button class="btn small ghost" onclick={toggleDone}>{isDone ? S.reopen : S.done}</button>
        {/if}
      </div>
    {/if}
  </div>
</div>
