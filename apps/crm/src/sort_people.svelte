<script lang="ts">
  import { Ring } from '../../trustweb/src/model'
  import Avatar from './avatar.svelte'
  import { shownName } from './display'
  import { fieldLabelOf, intendingOf, valueText } from './fields'
  import { closeSort } from './nav.svelte'
  import IntendingChips from './intending_chips.svelte'
  import RingChips from './ring_chips.svelte'
  import { FAMILY_KEY, UNSORTED } from './rings'
  import type { Choice } from './rings'
  import { applySuggestion, fileUnder, restore, setFamily, setIntending, unsortedIds, valuesOf } from './sorting.svelte'
  import type { Undo } from './sorting.svelte'
  import { inContact } from './person_view'
  import { store } from './state.svelte'
  import { parseSuggestions } from './suggestions'
  import { S } from './strings'
  import { hideFromTrustweb } from './sync.svelte'

  const ids = unsortedIds()
  const suggestions = parseSuggestions(__TW_SUGGESTIONS__)
  const suggestable = ids.filter((id) => suggestions[id])
  const history: { index: number; undo: Undo }[] = $state([])
  let index = $state(0)

  const suggestion = $derived(suggestions[ids[index] ?? ''])
  const person = $derived(store.app.people.find((p) => p.id === ids[index]))
  const details = $derived(Object.entries(valuesOf(ids[index] ?? '')).filter(([k, v]) => !k.startsWith('tw-') && valueText(v)).slice(0, 8)
    .map(([k, v]) => `${fieldLabelOf(k)}: ${valueText(v)}`))

  function choose(c: Choice): void {
    const whole = suggestion && c === (suggestion.ring === Ring.Intending ? UNSORTED : suggestion.ring)
    history.push({ index, undo: whole ? applySuggestion(ids[index], suggestion) : c === UNSORTED ? [] : fileUnder(ids[index], c) })
    index++
  }

  function confirmAll(): void {
    for (; index < ids.length; index++) if (suggestions[ids[index]]) history.push({ index, undo: applySuggestion(ids[index], suggestions[ids[index]]) })
  }

  function desire(n: number): void {
    if (n === 0) return
    history.push({ index, undo: suggestion && n === suggestion.intending && suggestion.ring === Ring.Intending ? applySuggestion(ids[index], suggestion) : setIntending(ids[index], n) })
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
  {#if suggestable.length > 0 && index < ids.length}<button class="btn small" data-action="confirm-all" onclick={confirmAll}>{S.confirmAll(suggestable.length)}</button>{/if}
  {#if person}
    <p class="muted" data-part="progress">{S.sortProgress(index + 1, ids.length)}</p>
    <div class="sort-card">
      <Avatar id={person.id} name={shownName(person.name)} />
      <h3>{shownName(person.name)}</h3>
      {#if person.context}<p class="ctx">{person.context}</p>{/if}
      {#each details as d (d)}<p class="meta">{d}</p>{:else}<p class="muted">{S.sortNoField}</p>{/each}
      <RingChips suggested={suggestion?.ring === Ring.Intending ? undefined : suggestion?.ring} family={valuesOf(person.id)[FAMILY_KEY] === true} onchoose={choose} onfamily={(on): void => { setFamily(person.id, on) }} />
      {#if suggestion}<p class="muted" data-part="suggested">{S.suggestedBecause(suggestion.reason)}{suggestion.family ? ` · ${S.familyTag}` : ''}</p>{/if}
      <IntendingChips locked={inContact(person, valuesOf(person.id), store.crm.interactions)} suggested={suggestion?.intending || undefined} value={intendingOf(valuesOf(person.id))} onchoose={desire} />
      <button class="quiet" data-action="hide-person" onclick={hide}>🗑 {S.hideFromTrustweb}</button>
    </div>
  {:else}
    <p class="empty" data-part="done">{S.sortDone}</p>
  {/if}
  <button class="quiet" data-action="sort-undo" disabled={history.length === 0} onclick={undo}>{S.sortUndo}</button>
</section>
