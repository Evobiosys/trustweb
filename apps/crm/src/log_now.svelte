<!--
  One-tap log for something that just happened with this person: met, a call,
  a message. Adapted from 900CRM's LogJustHappened.svelte
  (https://github.com/900Labs/900CRM, apps/desktop/src/lib/components/LogJustHappened.svelte,
  Copyright 2026 900 Labs, Apache License 2.0: see third_party/900crm/LICENSE and
  NOTICE.txt). Changes: synchronous local store instead of an async Tauri call,
  TrustWeb's interaction kinds and strings, no deal link.
-->
<script lang="ts">
  import { InteractionKind } from './model'
  import { addInteraction } from './state.svelte'
  import { S } from './strings'

  interface Props {
    personId: string
  }
  const { personId }: Props = $props()

  const QUICK: readonly InteractionKind[] = [InteractionKind.Met, InteractionKind.Call, InteractionKind.Message]

  function log(kind: InteractionKind): void {
    addInteraction(personId, kind, S.logNowText[kind])
  }
</script>

<div class="log-now" role="group" aria-label={S.logNow}>
  <span class="log-now-label">{S.logNow}</span>
  <div class="log-now-actions">
    {#each QUICK as kind (kind)}
      <button class="btn small ghost" data-action="log-now-{kind}" onclick={(): void => log(kind)}>{S.interactionKind[kind]}</button>
    {/each}
  </div>
</div>
