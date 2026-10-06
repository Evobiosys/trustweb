<script lang="ts">
  import { SortOrder, contactRows, groupByRing } from './contacts'
  import { lastActivityText, lastPastByPerson } from './display'
  import EmptyState from './empty_state.svelte'
  import { openPerson } from './nav.svelte'
  import PersonRow from './person_row.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { timeline } from './timeline'

  const SORTS: readonly SortOrder[] = [SortOrder.Recent, SortOrder.Name]
  const now = Date.now()

  let query = $state('')
  let order = $state<SortOrder>(SortOrder.Recent)

  const view = $derived({ app: store.app, crm: store.crm })
  const groups = $derived(groupByRing(contactRows(view, query, order)))
  const lastPast = $derived(lastPastByPerson(timeline(view), now))

  function pick(next: SortOrder): void {
    order = next
  }

  function metaFor(personId: string, lastAt: number, openLines: number): string {
    return `${S.openLines(openLines)} · ${lastActivityText(lastPast.get(personId), lastAt > now, now)}`
  }
</script>

<section data-screen="people">
  <input class="field" type="search" placeholder={S.search} aria-label={S.search} bind:value={query} />
  <div class="seg" role="group" aria-label={S.sortLabel}>
    {#each SORTS as s (s)}
      <button aria-pressed={order === s} onclick={(): void => pick(s)}>{S.sort[s]}</button>
    {/each}
  </div>
  {#each groups as g (g.ring)}
    <h3 class="ring-heading">{S.ringLabel[g.ring]}</h3>
    {#each g.rows as row (row.person.id)}
      <PersonRow person={row.person} meta={metaFor(row.person.id, row.lastAt, row.openLines)} onopen={openPerson} />
    {/each}
  {:else}
    <EmptyState title={S.noPeople} description={query ? S.noPeopleHint : ''} />
  {/each}
</section>
