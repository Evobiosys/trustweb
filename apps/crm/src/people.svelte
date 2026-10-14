<script lang="ts">
  import { SortOrder, contactRows, groupByRing, visibleContacts } from './contacts'
  import { lastActivityText, lastPastByPerson } from './display'
  import Avatar from './avatar.svelte'
  import EmptyState from './empty_state.svelte'
  import { baseFields, fieldLabelOf, mergedFields, passesFilters, valueText } from './fields'
  import type { FieldValues } from './fields'
  import { openContact, openImport, openPerson } from './nav.svelte'
  import PeopleFilter from './people_filter.svelte'
  import PersonRow from './person_row.svelte'
  import { prefs } from './prefs.svelte'
  import { store, undoLastImport } from './state.svelte'
  import { S } from './strings'
  import { timeline } from './timeline'

  const SORTS: readonly SortOrder[] = [SortOrder.Recent, SortOrder.Name]
  const now = Date.now()

  let query = $state('')
  let order = $state<SortOrder>(SortOrder.Recent)

  const view = $derived({ app: store.app, crm: store.crm })
  const valuesOf = (id: string): FieldValues => {
    const p = store.app.people.find((x) => x.id === id)
    return mergedFields(p ? baseFields(p) : undefined, store.crm.personFields?.[id])
  }
  const groups = $derived(groupByRing(contactRows(view, query, order).filter((r) => passesFilters(valuesOf(r.person.id), prefs.filters))))
  const imported = $derived(visibleContacts(store.crm.contacts ?? [], query))
  const lastPast = $derived(lastPastByPerson(timeline(view), now))

  function pick(next: SortOrder): void {
    order = next
  }

  function extraFor(personId: string): string[] {
    const values = valuesOf(personId)
    return prefs.filters.visible.map((k) => [k, valueText(values[k])] as const).filter(([, t]) => t).map(([k, t]) => `${fieldLabelOf(k)}: ${t}`)
  }

  function metaFor(personId: string, lastAt: number, openLines: number): string {
    return `${S.openLines(openLines)} · ${lastActivityText(lastPast.get(personId), lastAt > now, now)}`
  }
</script>

<section data-screen="people">
  <button class="btn small ghost" data-action="import-contacts" onclick={openImport}>{S.importContacts}</button>
  {#if store.crm.lastImport}
    <button class="quiet" data-action="undo-import" onclick={undoLastImport}>{S.undoImport(store.crm.lastImport.added)}</button>
  {/if}
  <input class="field" type="search" placeholder={S.search} aria-label={S.search} bind:value={query} />
  <PeopleFilter />
  <div class="seg" role="group" aria-label={S.sortLabel}>
    {#each SORTS as s (s)}
      <button aria-pressed={order === s} onclick={(): void => pick(s)}>{S.sort[s]}</button>
    {/each}
  </div>
  {#each groups as g (g.ring)}
    <h3 class="ring-heading">{S.ringLabel[g.ring]}</h3>
    {#each g.rows as row (row.person.id)}
      <PersonRow person={row.person} meta={metaFor(row.person.id, row.lastAt, row.openLines)} extra={extraFor(row.person.id)} onopen={openPerson} />
    {/each}
  {/each}
  {#if imported.length}
    <h3 class="ring-heading" data-part="contacts-heading">{S.contactsHeading(imported.length)}</h3>
    {#each imported as c (c.id)}
      <button class="person-row" data-contact={c.id} onclick={(): void => openContact(c.id)}>
        <Avatar id={c.id} name={c.name} />
        <span class="pr-main">
          <strong>{c.name}</strong>
          {#if c.org}<span class="ctx">{c.org}</span>{/if}
        </span>
      </button>
    {/each}
  {:else if groups.length === 0}
    <EmptyState title={S.noPeople} description={query ? S.noPeopleHint : ''} />
    <button class="btn" data-action="import-contacts-empty" onclick={openImport}>{S.importContacts}</button>
  {/if}
</section>
