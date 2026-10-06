<!--
  Empty-state placeholder: a title, an optional line under it. Adapted from
  900CRM's EmptyState.svelte (https://github.com/900Labs/900CRM,
  apps/desktop/src/lib/components/EmptyState.svelte, Copyright 2026 900 Labs,
  Apache License 2.0: see third_party/900crm/LICENSE and NOTICE.txt). Changes:
  no icon set, no action button, TrustWeb tokens.
-->
<script lang="ts">
  interface Props {
    title: string
    description?: string
    compact?: boolean
  }
  const { title, description = '', compact = false }: Props = $props()
</script>

<div class="empty" class:compact role="status">
  <p class="empty-title">{title}</p>
  {#if description}<p class="empty-desc">{description}</p>{/if}
</div>
