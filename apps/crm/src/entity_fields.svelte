<script lang="ts">
  import { drag, grip } from './drag.svelte'
  import FieldInput from './field_input.svelte'
  import { INTENDING_KEY, fieldLabelOf, isSet, valueText } from './fields'
  import type { FieldValue, FieldValues } from './fields'
  import { Kind, Section, labelOf } from './placement'
  import { layoutFor, placeField } from './placement.svelte'
  import { prefs, savePrefs, tanaOn } from './prefs.svelte'
  import { setIntending } from './sorting.svelte'
  import { S } from './strings'
  import { saveField } from './sync.svelte'
  import { planFieldSync } from './tana_sync'

  interface Props {
    kind: Kind
    /** The person or environment id; `tana-<node>` ids carry their Tana node. */
    id: string
    values: FieldValues
  }
  const { kind, id, values }: Props = $props()

  let advancedOpen = $state(false)
  let hiddenOpen = $state(false)

  const lay = $derived(layoutFor(kind, values))
  const node = $derived(id.startsWith('tana-') ? id.slice(5) : prefs.nodeIds[id])

  function nosync(key: string): { reason: string; href?: string } | undefined {
    if (!tanaOn()) return undefined
    const op = planFieldSync(key, values[key])
    return 'manual' in op ? { reason: op.manual, ...(node ? { href: `tana://nodes/${node}` } : {}) } : undefined
  }

  function drop(key: string, section: Section, before: string | null): void {
    placeField(kind, values, key, section, before)
    if (section === Section.Advanced) advancedOpen = true
  }

  /** Ticking "hide" files the field under Hidden; unticking returns it to simple (filled) or advanced (empty). */
  function hide(key: string, on: boolean): void {
    placeField(kind, values, key, on ? Section.Hidden : isSet(values[key]) ? Section.Simple : Section.Advanced, null)
  }

  function save(key: string, v: FieldValue): void {
    if (key === INTENDING_KEY) setIntending(id, Number(valueText(v)))
    else saveField(id, key, v)
  }
</script>

{#snippet zone(section: Section)}
  <div class="zone" class:over={drag.key !== null && drag.zone === section} data-zone={section} data-part={section}>
    {#each lay[section] as f (f.id)}
      <div class="slot" class:before={drag.key !== null && drag.before === f.id} class:lifted={drag.key === f.id} data-slot={f.id}>
        <span class="grip" role="presentation" data-key={f.id} aria-label={S.dragField} use:grip={drop}>⠿</span>
        <FieldInput field={f.id.startsWith('adhoc:') ? undefined : f} label={f.id.startsWith('adhoc:') ? fieldLabelOf(f.id) : labelOf(f, values)}
          value={values[f.id]} onchange={(v): void => save(f.id, v)} nosync={nosync(f.id)} />
        <label class="hide-box"><input type="checkbox" data-hide={f.id} checked={section === Section.Hidden}
          onchange={(e): void => hide(f.id, e.currentTarget.checked)} /><span>{S.hideField}</span></label>
      </div>
    {/each}
  </div>
{/snippet}

{#if prefs.scope.length}
  <p class="warn" data-part="scope-note">{S.scopeNote(prefs.scope.join(', '))}
    <button class="quiet" onclick={(): void => { prefs.scope = []; savePrefs() }}>{S.scopeBack}</button></p>
{/if}
<h3>{S.viewSimple}</h3>
{@render zone(Section.Simple)}

<button class="link" data-action="toggle-advanced" aria-expanded={advancedOpen || drag.key !== null} onclick={(): void => { advancedOpen = !advancedOpen }}>
  {advancedOpen ? S.viewAdvancedHide : S.viewAdvancedShow(lay.advanced.length)}
</button>
{#if advancedOpen || drag.key !== null}
  <h3>{S.viewAdvanced}</h3>
  {@render zone(Section.Advanced)}
{/if}

{#if drag.key !== null}
  <h3>{S.dropHere}</h3>
  {#each [Section.Collapsed, Section.Hidden] as s (s)}
    <div class="zone drop-only" class:over={drag.zone === s} data-zone={s}>{S.sectionLabel[s]}</div>
  {/each}
{/if}

{#if lay.hidden.length}
  <button class="link" data-action="toggle-hidden" aria-expanded={hiddenOpen} onclick={(): void => { hiddenOpen = !hiddenOpen }}>
    {hiddenOpen ? S.hiddenHide : S.hiddenShow(lay.hidden.length)}
  </button>
  {#if hiddenOpen}{@render zone(Section.Hidden)}{/if}
{/if}
