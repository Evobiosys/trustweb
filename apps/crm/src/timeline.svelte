<script lang="ts">
  import { fmtDate } from './dates'
  import { groupByDay, nameMap } from './display'
  import EmptyState from './empty_state.svelte'
  import EventRow from './event_row.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { timeline } from './timeline'

  const names = $derived(nameMap(store.app.people))
  const days = $derived(groupByDay(timeline({ app: store.app, crm: store.crm }).filter((e) => names.has(e.personId))))
</script>

<section data-screen="timeline">
  {#each days as day (day.key)}
    <h3 class="day">{fmtDate(day.at)}</h3>
    {#each day.events as event (event.id)}
      <EventRow {event} showDate={false} name={names.get(event.personId)} />
    {/each}
  {:else}
    <EmptyState title={S.nothingYet} description={S.timelineHint} />
  {/each}
</section>
