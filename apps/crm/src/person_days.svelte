<!-- SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later -->
<script lang="ts">
  // Wave 25: "Days" right under the person's header on the TrustWeb page (the phone card draws its own, card_pages_view.ts).
  import { foldKey, foldOpen, foldStored } from '../../trustweb/src/fold'
  import { DAYS_PAGE, personDays } from '../../trustweb/src/person_days'
  import { S as TW } from '../../trustweb/src/strings'
  import type { Person } from '../../trustweb/src/model'
  import { store } from './state.svelte'

  const { person }: { person: Person } = $props()
  const read = (): boolean => { try { return foldOpen(window.localStorage.getItem(foldKey('days')), true) } catch { return true } }
  let open = $state(read())
  let limit = $state(DAYS_PAGE)
  const shown = $derived(personDays(store.app, person, limit))

  function toggle(): void {
    open = !open
    try { window.localStorage.setItem(foldKey('days'), foldStored(open)) } catch { /* not remembered */ }
  }
</script>

<div class="days" data-part="days">
  <h3 class="fold-head"><button class="link fold-btn" data-action="toggle-days" aria-expanded={open} onclick={toggle}>{open ? '▾' : '▸'} {TW.pdTitle} ({shown.days.length}{shown.more ? '+' : ''})</button></h3>
  {#if open}
    {#each shown.days as d (d.day)}
      <div class="days-day">
        <h4 class="muted">{new Date(d.day).toLocaleDateString([], { dateStyle: 'medium' })}</h4>
        {#each d.entries as e}<p>{e.summary}</p>{/each}
      </div>
    {:else}
      <p class="muted">{TW.tlNone}</p>
    {/each}
    {#if shown.more}<button class="btn small ghost" data-action="days-more" onclick={(): void => { limit += DAYS_PAGE }}>{TW.pdMore}</button>{/if}
  {/if}
</div>
