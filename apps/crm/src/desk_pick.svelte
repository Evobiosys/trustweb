<script lang="ts">
  import type { Person } from '../../trustweb/src/model'
  import Avatar from './avatar.svelte'
  import { matches } from './contacts'
  import { shownName } from './display'
  import DeskIcon from './desk_icon.svelte'

  interface Props {
    people: readonly Person[]
    query: string
    placeholder: string
    field: string
    onpick: (id: string) => void
    icon?: boolean
  }
  let { people, query = $bindable(), placeholder, field, onpick, icon = false }: Props = $props()

  const MAX_SHOWN = 8
  const hits = $derived(query.trim() ? people.filter((p) => matches(p, query)).slice(0, MAX_SHOWN) : [])

  function pick(id: string): void {
    query = ''
    onpick(id)
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Enter' && hits[0]) pick(hits[0].id)
    else if (e.key === 'Escape') query = ''
  }
</script>

<div class="desk-pick">
  {#if icon}<span class="desk-pick-icon"><DeskIcon name="search" size={18} /></span>{/if}
  <input class="desk-input" class:desk-has-icon={icon} type="search" data-field={field} placeholder={placeholder} aria-label={placeholder} bind:value={query} onkeydown={key} />
  {#if hits.length}
    <ul class="desk-hits" data-part="desk-hits">
      {#each hits as p (p.id)}
        <li><button class="desk-link" onclick={(): void => pick(p.id)}><Avatar id={p.id} name={shownName(p.name)} /><strong>{shownName(p.name)}</strong>{#if p.context}<span class="desk-sub">{p.context}</span>{/if}</button></li>
      {/each}
    </ul>
  {/if}
</div>
