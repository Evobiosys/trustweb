<script lang="ts">
  import { norm } from './contacts'
  import { shownName } from './display'
  import { fieldById, fieldLabelOf, valueText } from './fields'
  import { Pick, clearedCount, dismiss, linesToAdd, mergeRows, neitherAllowed } from './merge'
  import { mergePeople } from './merge.svelte'
  import { openPerson } from './nav.svelte'
  import { effectivePerson, entityValues } from './person_view'
  import { baseFields } from './fields'
  import { store } from './state.svelte'
  import { S } from './strings'

  interface Props {
    /** The person whose card is open; the default survivor. */
    personId: string
  }
  const { personId }: Props = $props()

  let searching = $state(false)
  let query = $state('')
  /** The person picked in the search: the sheet shows when set. */
  let otherId = $state<string | null>(null)
  let keepOther = $state(false)
  let picks = $state<Record<string, Pick>>({})

  const hits = $derived(query.trim()
    ? store.app.people.filter((p) => p.id !== personId && norm(p.name).includes(norm(query.trim()))).slice(0, 30)
    : [])
  const keepId = $derived(keepOther && otherId ? otherId : personId)
  const dropId = $derived(keepOther ? personId : otherId)
  const keep = $derived(store.app.people.find((p) => p.id === keepId))
  const drop = $derived(store.app.people.find((p) => p.id === dropId))
  const valuesFor = (id: string): ReturnType<typeof entityValues> => {
    const p = store.app.people.find((x) => x.id === id)
    return p ? entityValues(p, baseFields(p), store.crm.personFields?.[id]) : {}
  }
  const rows = $derived(keep && drop ? mergeRows(valuesFor(keepId), valuesFor(drop.id), drop.metAt > keep.metAt) : [])
  const cleared = $derived(clearedCount(rows, picks))
  const added = $derived(keep && drop ? linesToAdd(keep.lines, drop.lines).length : 0)
  const events = $derived(dropId ? store.crm.interactions.filter((i) => i.personId === dropId).length + store.crm.followUps.filter((f) => f.personId === dropId).length : 0)
  const label = (key: string): string => fieldById(key)?.label ?? fieldLabelOf(key)
  const nameOf = (id: string): string => { const p = store.app.people.find((x) => x.id === id); return p ? shownName(effectivePerson(p, store.crm.personFields?.[id]).name) : id }

  function reset(): void {
    searching = false
    query = ''
    otherId = null
    keepOther = false
    picks = {}
  }

  function go(): void {
    if (!dropId) return
    const survivor = keepId
    mergePeople(survivor, dropId, rows, picks)
    reset()
    openPerson(survivor)
  }
</script>

{#if !searching}
  <button class="btn small ghost" data-action="merge-open" onclick={(): void => { searching = true }}>{S.mergeOpen}</button>
{:else if otherId === null}
  <div data-part="merge-search">
    <!-- svelte-ignore a11y_autofocus -->
    <input class="field" type="search" data-field="merge-search" autofocus placeholder={S.mergeSearchPh} aria-label={S.mergeOpen} bind:value={query} />
    {#each hits as p (p.id)}
      <button class="merge-hit" data-action="merge-pick" onclick={(): void => { otherId = p.id }}>{shownName(p.name)}</button>
    {:else}
      {#if query.trim()}<p class="muted">{S.mergeNone}</p>{/if}
    {/each}
    <button class="quiet" data-action="merge-cancel" onclick={reset}>{S.ringCancel}</button>
  </div>
{:else}
  <div class="ring-sheet" data-part="merge-sheet">
    <div class="ring-chips" role="radiogroup">
      <button class="rchip" data-action="merge-keep" data-keep="this" aria-pressed={!keepOther} onclick={(): void => { keepOther = false; picks = {} }}>{S.mergeKeep(nameOf(personId))}</button>
      <button class="rchip" data-action="merge-keep" data-keep="other" aria-pressed={keepOther} onclick={(): void => { keepOther = true; picks = {} }}>{S.mergeKeep(nameOf(otherId))}</button>
    </div>
    {#each rows as r (r.key)}
      <div class="merge-row" data-merge-row={r.key}>
        <strong>{label(r.key)}</strong>
        {#each [[Pick.Keep, r.keep], [Pick.Other, r.other]] as [side, v] (side)}
          {@const pick = picks[r.key] ?? r.pick}
          {@const taken = pick === side || pick === Pick.Both}
          <span class="merge-side" data-side={side}>
            <label><input type="radio" name={`merge-${r.key}`} checked={pick === side} onchange={(): void => { picks[r.key] = side as Pick }} /><span class="merge-val" class:dropped={!taken} title={valueText(v)}>{valueText(v) || '—'}</span></label>
            {#if neitherAllowed(r.key, rows, picks, valuesFor(keepId))}
              <button class="quiet" data-action="merge-dismiss" aria-label={S.mergeDismiss} onclick={(): void => { picks[r.key] = dismiss(pick, side as Pick.Keep | Pick.Other) }}>×</button>
            {/if}
          </span>
        {/each}
        <label class="merge-both"><input type="radio" name={`merge-${r.key}`} checked={(picks[r.key] ?? r.pick) === Pick.Both} onchange={(): void => { picks[r.key] = Pick.Both }} />{S.mergeBoth}</label>
        {#if neitherAllowed(r.key, rows, picks, valuesFor(keepId))}
          <label class="merge-neither"><input type="radio" name={`merge-${r.key}`} checked={(picks[r.key] ?? r.pick) === Pick.Neither} onchange={(): void => { picks[r.key] = Pick.Neither }} />{S.mergeNeither}</label>
        {/if}
      </div>
    {/each}
    <p>{S.mergeAdds(added, events, cleared)}</p>
    <div class="add-actions">
      <button class="btn small" data-action="merge-go" onclick={go}>{S.mergeGo}</button>
      <button class="btn small ghost" data-action="merge-cancel" onclick={reset}>{S.ringCancel}</button>
    </div>
  </div>
{/if}
