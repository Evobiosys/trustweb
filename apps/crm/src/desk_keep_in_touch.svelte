<script lang="ts">
  import Avatar from './avatar.svelte'
  import { shortDate } from './desk'
  import type { DeskData } from './desk'
  import { shownName } from './display'
  import EmptyState from './empty_state.svelte'
  import KeepSelect from './keep_select.svelte'
  import { openPerson } from './nav.svelte'
  import { S } from './strings'

  interface Props {
    data: DeskData
  }
  const { data }: Props = $props()

  const overdue = $derived(data.kit.filter((r) => r.due))
  const upcoming = $derived(data.kit.filter((r) => !r.due))
  const without = $derived(data.view.app.people.filter((p) => !data.view.crm.keepInTouch?.[p.id]))
</script>

{#snippet who(id: string, name: string, context: string)}
  <button class="desk-link" onclick={(): void => openPerson(id)}><Avatar {id} name={shownName(name)} /><strong>{shownName(name)}</strong>{#if context}<span class="desk-dot">·</span><span class="desk-sub">{context}</span>{/if}</button>
{/snippet}

<div class="desk-page" data-screen="desk-keep-in-touch">
  <h1 class="desk-title">{S.desk.nav.keepInTouch}</h1>
  {#if data.kit.length === 0}<EmptyState title={S.desk.keepEmpty} compact />{/if}
  {#each [[S.desk.keepOverdue, overdue, 'overdue'], [S.desk.keepUpcoming, upcoming, 'upcoming']] as const as [title, rows, part] (part)}
    {#if rows.length}
      <section class="desk-section" data-section={part}><h2 class="desk-label">{title}</h2>
        {#each rows as r (r.person.id)}
          <div class="desk-row">{@render who(r.person.id, r.person.name, r.person.context)}<KeepSelect personId={r.person.id} /><span class="desk-sub desk-when" class:desk-warn={r.due}>{shortDate(r.dueAt)}</span></div>
        {/each}
      </section>
    {/if}
  {/each}
  {#if without.length}
    <section class="desk-section" data-section="none"><h2 class="desk-label">{S.desk.keepNone}</h2>
      {#each without as p (p.id)}
        <div class="desk-row">{@render who(p.id, p.name, p.context)}<KeepSelect personId={p.id} /></div>
      {/each}
    </section>
  {/if}
</div>
