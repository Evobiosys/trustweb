<!--
  Generic kanban board: one column per stage, native HTML5 drag and drop, a
  card snippet per item. Adapted from 900CRM's KanbanBoard.svelte
  (https://github.com/900Labs/900CRM, apps/desktop/src/lib/components/KanbanBoard.svelte,
  Copyright 2026 900 Labs, Apache License 2.0: see third_party/900crm/LICENSE and
  NOTICE.txt). Changes: typed items instead of `unknown`, no add button, no
  totals, TrustWeb strings and tokens, columns that snap sideways on a phone.
  Drag and drop is mouse-only in browsers (the HTML5 drag API ignores touch),
  so every card also carries its own stage control (pipeline.svelte).
-->
<script module lang="ts">
  export interface KanbanColumn<Item> {
    id: string
    label: string
    items: Item[]
  }
</script>

<script lang="ts" generics="T extends { id: string }">
  import type { Snippet } from 'svelte'
  import EmptyState from './empty_state.svelte'
  import { S } from './strings'

  interface Props {
    columns: KanbanColumn<T>[]
    /** A card was dropped on another column. */
    onmove: (itemId: string, toColumnId: string) => void
    card: Snippet<[T]>
  }
  const { columns, onmove, card }: Props = $props()

  let draggingId = $state<string | null>(null)
  let draggingFrom = $state<string | null>(null)
  let overColumn = $state<string | null>(null)

  function dragStart(e: DragEvent, itemId: string, columnId: string): void {
    draggingId = itemId
    draggingFrom = columnId
    e.dataTransfer?.setData('text/plain', itemId)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function dragEnd(): void {
    draggingId = null
    draggingFrom = null
    overColumn = null
  }

  function dragOver(e: DragEvent, columnId: string): void {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    overColumn = columnId
  }

  /** Only clears when the pointer leaves the column itself, not when it enters a child. */
  function dragLeave(e: DragEvent, columnId: string): void {
    const related = e.relatedTarget as Node | null
    if (!(e.currentTarget as HTMLElement).contains(related) && overColumn === columnId) overColumn = null
  }

  function drop(e: DragEvent, toColumnId: string): void {
    e.preventDefault()
    overColumn = null
    const itemId = e.dataTransfer?.getData('text/plain') || draggingId
    const from = draggingFrom
    draggingId = null
    draggingFrom = null
    if (!itemId || from === toColumnId) return
    onmove(itemId, toColumnId)
  }
</script>

<div class="board" role="region" aria-label={S.boardLabel}>
  {#each columns as column (column.id)}
    <section
      class="column"
      class:drop-target={overColumn === column.id && draggingFrom !== column.id}
      data-stage={column.id}
      aria-label={column.label}
      ondragover={(e: DragEvent): void => dragOver(e, column.id)}
      ondragleave={(e: DragEvent): void => dragLeave(e, column.id)}
      ondrop={(e: DragEvent): void => drop(e, column.id)}
    >
      <h3>{column.label} <span class="count">{column.items.length}</span></h3>
      <div class="column-body" role="list">
        {#each column.items as item (item.id)}
          <div
            class="kanban-item"
            class:is-dragging={draggingId === item.id}
            draggable="true"
            role="listitem"
            ondragstart={(e: DragEvent): void => dragStart(e, item.id, column.id)}
            ondragend={dragEnd}
          >
            {@render card(item)}
          </div>
        {:else}
          <EmptyState title={S.columnEmpty} compact={true} />
        {/each}
      </div>
    </section>
  {/each}
</div>
