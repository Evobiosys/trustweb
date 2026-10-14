<script lang="ts">
  import { lastMerge } from './merge.svelte'
  import { S } from './strings'
</script>

{#if lastMerge.undo}
  <div class="toast" role="status" data-part="merge-toast">
    <span>{S.mergeToast(lastMerge.name)}</span>
    <button class="quiet" data-action="merge-undo" onclick={lastMerge.undo}>{S.mergeUndo}</button>
  </div>
{/if}
