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
  import type { Person } from '../../trustweb/src/model'
  import Avatar from './avatar.svelte'

  interface Props {
    person: Person
    meta: string
    onopen: (personId: string) => void
  }
  const { person, meta, onopen }: Props = $props()
</script>

<button class="person-row" onclick={(): void => onopen(person.id)}>
  <Avatar id={person.id} name={person.name} />
  <span class="pr-main">
    <strong>{person.name}</strong>
    {#if person.context}<span class="ctx">{person.context}</span>{/if}
    <span class="meta">{meta}</span>
  </span>
</button>
