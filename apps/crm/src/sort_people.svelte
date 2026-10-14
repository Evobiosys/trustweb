<script lang="ts">
  import Avatar from './avatar.svelte'
  import { shownName } from './display'
  import { fieldLabelOf, intendingOf, valueText } from './fields'
  import { closeSort } from './nav.svelte'
  import IntendingChips from './intending_chips.svelte'
  import RingChips from './ring_chips.svelte'
  import { FAMILY_KEY, UNSORTED } from './rings'
  import type { Choice } from './rings'
  import { fileUnder, restore, setFamily, setIntending, unsortedIds, valuesOf } from './sorting.svelte'
  import type { Undo } from './sorting.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { hideFromTrustweb } from './sync.svelte'

  const ids = unsortedIds()
  const history: { index: number; undo: Undo }[] = $state([])
  let index = $state(0)

  const person = $derived(store.app.people.find((p) => p.id === ids[index]))
  const details = $derived(Object.entries(valuesOf(ids[index] ?? '')).filter(([k, v]) => !k.startsWith('tw-') && valueText(v)).slice(0, 8)
    .map(([k, v]) => `${fieldLabelOf(k)}: ${valueText(v)}`))

  function choose(c: Choice): void {
    history.push({ index, undo: c === UNSORTED ? [] : fileUnder(ids[index], c) })
    index++
  }

  function desire(n: number): void {
    if (n === 0) return
    history.push({ index, undo: setIntending(ids[index], n) })
    index++
  }

  function hide(): void {
    hideFromTrustweb(ids[index])
    index++
  }

  function undo(): void {
    const last = history.pop()
    if (!last) return
    restore(ids[last.index], last.undo)
    index = last.index
  }
</script>

<section data-screen="sort">
  <button class="back" onclick={closeSort}>&larr; {S.back}</button>
  <h2 class="screen-title">{S.sortTitle}</h2>
  {#if person}
    <p class="muted" data-part="progress">{S.sortProgress(index + 1, ids.length)}</p>
    <div class="sort-card">
      <Avatar id={person.id} name={shownName(person.name)} />
      <h3>{shownName(person.name)}</h3>
      {#if person.context}<p class="ctx">{person.context}</p>{/if}
      {#each details as d (d)}<p class="meta">{d}</p>{:else}<p class="muted">{S.sortNoField}</p>{/each}
      <RingChips family={valuesOf(person.id)[FAMILY_KEY] === true} onchoose={choose} onfamily={(on): void => { setFamily(person.id, on) }} />
      <IntendingChips value={intendingOf(valuesOf(person.id))} onchoose={desire} />
      <button class="quiet" data-action="hide-person" onclick={hide}>🗑 {S.hideFromTrustweb}</button>
    </div>
  {:else}
    <p class="empty" data-part="done">{S.sortDone}</p>
  {/if}
  <button class="quiet" data-action="sort-undo" disabled={history.length === 0} onclick={undo}>{S.sortUndo}</button>
</section>
