<script lang="ts">
  import { Ring } from '../../trustweb/src/model'
  import { closePerson } from './nav.svelte'
  import RingAdvanced from './ring_advanced.svelte'
  import RingChips from './ring_chips.svelte'
  import { FAMILY_KEY, RING_COLORS, ringColor } from './rings'
  import { fileUnder, intendingNotice, setFamily, valuesOf } from './sorting.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'
  import { hideFromTrustweb, saveField, untagPerson } from './sync.svelte'
  import { tanaOn } from './prefs.svelte'

  interface Props {
    personId: string
    ring: string
  }
  const { personId, ring }: Props = $props()

  let open = $state(false)
  let more = $state(false)
  /** The reminder after picking intending to connect (the chooser stays open until it is read). */
  let reminder = $state<string[]>([])
  /** The action waiting for its confirm sheet. */
  let asking = $state<'delete' | 'untag' | null>(null)
  /** The ring came from a suggestion and has not been tapped yet: a first tap confirms it (a ring edit is the confirmation). */
  const suggested = $derived((store.app.people.find((x) => x.id === personId) as { ringSuggested?: boolean } | undefined)?.ringSuggested === true
    && store.crm.personFields?.[personId]?.['tw-ring'] === undefined)
  const family = $derived(valuesOf(personId)[FAMILY_KEY] === true)
  const name = $derived(store.app.people.find((x) => x.id === personId)?.name ?? '')

  function gone(): void {
    open = false
    closePerson()
  }

  function confirm(): void {
    if (asking === 'delete') hideFromTrustweb(personId)
    else untagPerson(personId)
    asking = null
    gone()
  }
</script>

<button class="ring-label" class:suggested data-action="ring-label" style:--rc={ringColor(ring)} aria-expanded={open}
  title={suggested ? S.ringSuggestedTip : S.ringOpen(S.ringLabel[ring] ?? ring)} onclick={(): void => { if (suggested) saveField(personId, 'tw-ring', ring); open = !open }}>{S.ringLabel[ring] ?? ring}</button>
{#if family}<span class="family-dot" data-part="family" style:background={RING_COLORS.family} title={S.familyTag} role="img" aria-label={S.familyTag}></span>{/if}
{#if open}
  <div class="ring-pop" data-part="ring-pop">
    <button class="icon-btn ring-x" data-action="ring-close" aria-label={S.ringClose} title={S.ringClose} onclick={(): void => { open = false; more = false; asking = null; reminder = [] }}>✕</button>
    <RingChips current={ring} {family} onchoose={(c): void => { fileUnder(personId, c); reminder = c === Ring.Intending ? intendingNotice(personId) : []; open = reminder.length > 0 }} onfamily={(on): void => { setFamily(personId, on) }} />
    {#each reminder as line (line)}<p class="reminder" data-part="reminder">{line}</p>{/each}
    <button class="link" data-action="ring-advanced" aria-expanded={more} onclick={(): void => { more = !more }}>{more ? S.ringAdvancedHide : S.ringAdvanced}</button>
    {#if more}<RingAdvanced {personId} ongone={gone} />{/if}
    <div class="add-actions">
      <button class="btn small ghost" data-action="ring-delete" onclick={(): void => { asking = 'delete' }}>{S.ringDelete}</button>
      {#if tanaOn()}<button class="btn small ghost" data-action="ring-untag" onclick={(): void => { asking = 'untag' }}>{S.ringUntag}</button>{/if}
    </div>
    {#if asking}
      <div class="ring-sheet" role="alertdialog" data-part="ring-sheet">
        <p>{asking === 'delete' ? S.ringDeleteAsk(name) : S.ringUntagAsk(name)}</p>
        <div class="add-actions">
          <button class="btn small" data-action="ring-confirm" onclick={confirm}>{S.ringConfirm}</button>
          <button class="btn small ghost" data-action="ring-cancel" onclick={(): void => { asking = null }}>{S.ringCancel}</button>
        </div>
      </div>
    {/if}
  </div>
{/if}
