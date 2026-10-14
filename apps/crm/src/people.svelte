<script lang="ts">
  import { SortOrder, contactRows, groupByRing, inCustomOrder, moveInOrder, visibleContacts } from './contacts'
  import { lastActivityText, lastPastByPerson } from './display'
  import Avatar from './avatar.svelte'
  import EmptyState from './empty_state.svelte'
  import { baseFields, fieldLabelOf, passesFilters, valueText } from './fields'
  import type { FieldValues } from './fields'
  import { matches } from './contacts'
  import { unsortedIds } from './sorting.svelte'
  import { openContact, openSort, openEnvironment, openImport, openPerson } from './nav.svelte'
  import { isClose } from './close'
  import { Kind, layout } from './placement'
  import { placementFor } from './placement.svelte'
  import { effectivePerson, entityValues, favLink, presence } from './person_view'
  import PeopleFilter from './people_filter.svelte'
  import PersonRow from './person_row.svelte'
  import { drag } from './drag.svelte'
  import { prefs, savePrefs } from './prefs.svelte'
  import { ringColor } from './rings'
  import { store, undoLastImport } from './state.svelte'
  import { S } from './strings'
  import { timeline } from './timeline'

  const SORTS: readonly SortOrder[] = [SortOrder.Recent, SortOrder.Name]
  const now = Date.now()

  type EnvEntity = { id: string; name: string; context: string; fields?: FieldValues }

  let query = $state('')
  let order = $state<SortOrder>(SortOrder.Recent)

  let list = $state<Kind>(Kind.Person)

  const edits = (id: string): FieldValues | undefined => store.crm.personFields?.[id]
  const people = $derived(store.app.people.map((p) => effectivePerson(p, edits(p.id))))
  const view = $derived({ app: { ...store.app, people }, crm: store.crm })
  const valuesOf = (id: string): FieldValues => {
    const p = store.app.people.find((x) => x.id === id)
    return p ? entityValues(p, baseFields(p), edits(id)) : {}
  }
  const hasCustom = $derived(Object.keys(prefs.customOrder).length > 0)
  const groups = $derived(groupByRing(contactRows(view, query, order).filter((r) => passesFilters(valuesOf(r.person.id), prefs.filters) && (!prefs.filters.onlyClose || isClose(valuesOf(r.person.id), prefs.close)))).map((g) =>
    order === SortOrder.Recent && hasCustom ? { ...g, rows: inCustomOrder(g.rows, (r) => r.person.id, prefs.customOrder[g.ring]) } : g))
  const environments = $derived(((store.app as { environments?: EnvEntity[] }).environments ?? [])
    .map((e) => effectivePerson(e, edits(e.id))).filter((e) => matches(e as never, query)))
  const onRow = $derived((kind: Kind) => layout(kind, placementFor(kind), {}).collapsed)
  const imported = $derived(visibleContacts(store.crm.contacts ?? [], query))
  const toSort = $derived(unsortedIds().length)
  const lastPast = $derived(lastPastByPerson(timeline(view), now))

  function pick(next: SortOrder): void {
    order = next
  }

  /** A row dropped before another in its ring section: that section keeps the order from now on, on this device. */
  function reorder(ring: string, ids: string[]): (id: string, _s: unknown, before: string | null) => void {
    return (id, _s, before) => {
      prefs.customOrder[ring] = moveInOrder(ids, id, before)
      order = SortOrder.Recent
      savePrefs()
    }
  }

  function extraFor(kind: Kind, values: FieldValues): string[] {
    return onRow(kind).map((f) => [f, valueText(values[f.id])] as const).filter(([, t]) => t).map(([f, t]) => `${f.id.startsWith('adhoc:') ? fieldLabelOf(f.id) : f.label}: ${t}`)
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
  <div class="seg" role="group" aria-label={S.peopleTab}>
    <button aria-pressed={list === Kind.Person} data-list="people" onclick={(): void => { list = Kind.Person }}>{S.peopleTab}</button>
    <button aria-pressed={list === Kind.Environment} data-list="environments" onclick={(): void => { list = Kind.Environment }}>{S.environments}</button>
  </div>
  {#if list === Kind.Environment}
    {#each environments as e (e.id)}
      <PersonRow id={e.id} name={e.name} context={e.context} extra={extraFor(Kind.Environment, entityValues(e, e.fields, edits(e.id)))} onopen={openEnvironment} />
    {:else}
      <p class="empty">{S.noEnvironments}</p>
    {/each}
  {:else}
  {#if toSort > 0}<button class="btn small sort-banner" data-action="sort-banner" onclick={openSort}>{S.sortBanner(toSort)}</button>{/if}
  <PeopleFilter />
  <div class="seg" role="group" aria-label={S.sortLabel}>
    {#each SORTS as s (s)}
      <button aria-pressed={order === s} onclick={(): void => pick(s)}>{s === SortOrder.Recent && hasCustom ? S.sortCustom : S.sort[s]}</button>
    {/each}
  </div>
  {#each groups as g (g.ring)}
    <h3 class="ring-heading"><span class="ring-dot" style:background={ringColor(g.ring)}></span>{S.ringLabel[g.ring]} ({g.rows.length})</h3>
    <div class="zone" class:over={drag.key !== null && drag.zone === g.ring} data-zone={g.ring}>
    {#each g.rows as row (row.person.id)}
      {@const values = valuesOf(row.person.id)}
      <div class="slot" class:before={drag.key !== null && drag.before === row.person.id} class:lifted={drag.key === row.person.id} data-slot={row.person.id}>
      <PersonRow id={row.person.id} name={row.person.name} context={row.person.context} meta={metaFor(row.person.id, row.lastAt, row.openLines)}
        extra={extraFor(Kind.Person, values)} presence={presence(row.person, lastPast.get(row.person.id), prefs.activityDays, now)}
        ring={row.person.ring} fav={favLink(row.person, values, store.crm.contactPoints[row.person.id])} ondrop={reorder(g.ring, g.rows.map((r) => r.person.id))} onopen={openPerson} />
      </div>
    {/each}
    </div>
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
  {/if}
</section>
