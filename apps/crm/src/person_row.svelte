<!--
  One person in the list: avatar with initials, name, context, a meta line.
  Adapted from 900CRM's ContactCard.svelte (https://github.com/900Labs/900CRM,
  apps/desktop/src/lib/components/ContactCard.svelte, Copyright 2026 900 Labs,
  Apache License 2.0: see third_party/900crm/LICENSE and NOTICE.txt). Changes:
  TrustWeb's Person instead of a first/last-name contact, the avatar colour
  comes from display.ts (same idea: a hash of the id picks the colour), the
  type badge became the notes count and last activity.
-->
<script lang="ts">
  import Avatar from './avatar.svelte'
  import { grip } from './drag.svelte'
  import type { Drop } from './drag.svelte'
  import { shownName } from './display'
  import RingLabel from './ring_label.svelte'
  import { Presence } from './person_view'
  import type { FavLink } from './person_view'
  import { S } from './strings'

  interface Props {
    id: string
    name: string
    context: string
    meta?: string
    /** Extra lines from the fields placed On the row. */
    extra?: string[]
    presence?: Presence
    fav?: FavLink | null
    ring?: string
    /** Drops the row's grip lands on: reorders it within its section. */
    ondrop?: Drop
    onopen: (id: string) => void
  }
  const { id, name, context, meta = '', extra = [], presence = Presence.None, fav = null, ring, ondrop, onopen }: Props = $props()
</script>

<div class="person-row" class:with-ring={ring}>
  {#if ondrop}<span class="grip" role="presentation" data-key={id} aria-label={S.dragRow} use:grip={ondrop}>⋮⋮</span>{/if}
  <button class="pr-open" onclick={(): void => onopen(id)}>
    <Avatar {id} name={shownName(name)} />
    <span class="pr-main">
      <strong>{shownName(name)}</strong>
      {#if context}<span class="ctx">{context}</span>{/if}
      {#if meta}<span class="meta">{meta}</span>{/if}
      {#each extra as line (line)}<span class="meta">{line}</span>{/each}
    </span>
  </button>
  {#if presence !== Presence.None}
    <span class="presence" data-presence={presence} role="img" aria-label={presence === Presence.Active ? S.presenceActive : S.presenceIdle}>{presence === Presence.Active ? '●' : '○'}</span>
  {/if}
  {#if ring}<div class="pr-ring"><RingLabel personId={id} {ring} /></div>{/if}
  {#if fav}<a class="fav" href={fav.href} aria-label={fav.label} title={fav.title} data-fav={fav.label}>{fav.symbol}</a>{/if}
</div>
