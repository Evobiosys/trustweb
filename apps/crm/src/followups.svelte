<script lang="ts">
  import { dueText, nameMap } from './display'
  import EmptyState from './empty_state.svelte'
  import { SECTIONS, Section } from './nav'
  import { openPerson } from './nav.svelte'
  import { removeFollowUp, setFollowUpDone, store } from './state.svelte'
  import { S } from './strings'
  import { dueFollowUps, upcomingFollowUps } from './timeline'

  const now = Date.now()

  const names = $derived(nameMap(store.app.people))
  const known = $derived(store.crm.followUps.filter((f) => names.has(f.personId)))
  const lists = $derived({
    [Section.Overdue]: dueFollowUps({ ...store.crm, followUps: known }, now),
    [Section.Upcoming]: upcomingFollowUps({ ...store.crm, followUps: known }, now),
    [Section.Finished]: known.filter((f) => f.doneAt !== undefined).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
  })
  const titles: Record<Section, string> = {
    [Section.Overdue]: S.overdue,
    [Section.Upcoming]: S.upcoming,
    [Section.Finished]: S.finished,
  }
  const total = $derived(known.length)
</script>

<section class="followups" data-screen="followups">
  {#if total === 0}
    <EmptyState title={S.noFollowUps} />
  {:else}
    {#each SECTIONS as section (section)}
      <section data-section={section}>
        <h3>{titles[section]} <span class="count">{lists[section].length}</span></h3>
        {#each lists[section] as f (f.id)}
          <div class="followup">
            <button class="link" onclick={(): void => openPerson(f.personId)}>{names.get(f.personId)}</button>
            <p>{f.text}</p>
            <span class="due">{dueText(f, now)}</span>
            <div class="actions">
              <button class="btn small ghost" onclick={(): void => setFollowUpDone(f.id, f.doneAt === undefined)}>
                {f.doneAt === undefined ? S.done : S.reopen}
              </button>
              <button class="quiet" onclick={(): void => removeFollowUp(f.id)}>{S.remove}</button>
            </div>
          </div>
        {:else}
          <p class="muted">{S.noneHere}</p>
        {/each}
      </section>
    {/each}
  {/if}
</section>
