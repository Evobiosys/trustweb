<script lang="ts">
  import { byStage, pipeline } from './contacts'
  import type { PipelineCard } from './contacts'
  import EmptyState from './empty_state.svelte'
  import { shownName } from './display'
  import KanbanBoard from './kanban_board.svelte'
  import type { KanbanColumn } from './kanban_board.svelte'
  import { STAGES } from './model'
  import type { Stage } from './model'
  import { openPerson } from './nav.svelte'
  import { setStage, store } from './state.svelte'
  import { S } from './strings'
  import TagChip from './tag_chip.svelte'

  /** A card keyed by its NoteLine id, the key the stage map uses. */
  interface Item extends PipelineCard {
    id: string
  }

  const cards = $derived(pipeline({ app: store.app, crm: store.crm }))
  const columns = $derived<KanbanColumn<Item>[]>(STAGES.map((stage) => ({
    id: stage,
    label: S.stage[stage],
    items: byStage(cards, stage).map((c) => ({ ...c, id: c.line.id })),
  })))

  function isStage(value: string): value is Stage {
    return (STAGES as readonly string[]).includes(value)
  }

  function move(lineId: string, toStage: string): void {
    if (isStage(toStage)) setStage(lineId, toStage)
  }

  function change(card: PipelineCard, e: Event): void {
    move(card.line.id, (e.currentTarget as HTMLSelectElement).value)
  }
</script>

<section data-screen="pipeline">
  {#if cards.length === 0}
    <EmptyState title={S.noPipeline} description={S.noPipelineHint} />
  {:else}
    <KanbanBoard {columns} onmove={move}>
      {#snippet card(item: Item)}
        <div class="card">
          <button class="link" onclick={(): void => openPerson(item.person.id)}>{shownName(item.person.name)}</button>
          <p>{item.line.text}</p>
          <div><TagChip line={item.line} /></div>
          <select class="field" aria-label={S.stageLabel} value={item.stage} onchange={(e: Event): void => change(item, e)}>
            {#each STAGES as s (s)}
              <option value={s}>{S.stage[s]}</option>
            {/each}
          </select>
        </div>
      {/snippet}
    </KanbanBoard>
  {/if}
</section>
