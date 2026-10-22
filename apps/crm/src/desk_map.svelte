<script lang="ts">
  import Avatar from './avatar.svelte'
  import { placesOf } from './desk'
  import type { DeskData } from './desk'
  import { shownName } from './display'
  import EmptyState from './empty_state.svelte'
  import { openPerson } from './nav.svelte'
  import { prefs } from './prefs.svelte'
  import { S } from './strings'

  interface Props {
    data: DeskData
  }
  const { data }: Props = $props()

  const AVATARS_SHOWN = 8
  const places = $derived(placesOf(data.view, data.values, prefs.close))
</script>

<div class="desk-page" data-screen="desk-map">
  <h1 class="desk-title">{S.desk.mapTitle}</h1>
  <p class="desk-sub">{S.desk.mapNote}</p>
  {#each places as g (g.place)}
    <section class="desk-place" data-place={g.place}>
      <h2 class="desk-card-title">{g.place} <span class="desk-count">{g.people.length}</span></h2>
      <div class="desk-faces">
        {#each g.people.slice(0, AVATARS_SHOWN) as p (p.id)}
          <button class="desk-link" title={shownName(p.name)} onclick={(): void => openPerson(p.id)}><Avatar id={p.id} name={shownName(p.name)} /><span class="desk-sub">{shownName(p.name)}</span></button>
        {/each}
      </div>
    </section>
  {:else}
    <EmptyState title={S.desk.mapEmpty} compact />
  {/each}
</div>
