<script lang="ts">
  import { decisionFor, plan as makePlan } from './import/intake'
  import type { Decision, IntakePlan } from './import/intake'
  import { readPicked } from './import/pick'
  import type { Picked } from './import/pick'
  import type { ImportedContact } from './import/types'
  import { closeImport } from './nav.svelte'
  import { importContacts, store, undoLastImport } from './state.svelte'
  import { S } from './strings'

  let plan = $state<IntakePlan | null>(null)
  let extra = $state<Pick<Picked, 'other' | 'tooBig'>>({ other: 0, tooBig: 0 })
  let decisions = $state<Record<number, Decision>>({})
  let busy = $state(false)
  let failed = $state<string | null>(null)

  const sure = $derived((plan?.groups ?? []).flatMap((g, i) => (g.sure ? [i] : [])))
  const unsure = $derived((plan?.groups ?? []).flatMap((g, i) => (g.sure ? [] : [i])))

  async function onPick(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement
    const list = [...(input.files ?? [])]
    input.value = ''
    if (list.length === 0) return
    busy = true
    failed = null
    try {
      const picked = await readPicked(list)
      extra = { other: picked.other, tooBig: picked.tooBig }
      decisions = {}
      plan = makePlan(store.crm.contacts ?? [], picked.files)
    } finally {
      busy = false
    }
  }

  function answer(group: number, d: Decision): void {
    decisions[group] = d
  }

  function save(): void {
    if (!plan) return
    if (importContacts(plan, decisions)) closeImport()
    else failed = S.importFull
  }

  function undo(): void {
    failed = undoLastImport() ? null : S.undoFailed
  }

  function hint(c: ImportedContact): string {
    return c.phones[0] ?? c.emails[0] ?? ''
  }
</script>

{#snippet member(c: ImportedContact)}
  <li class="member">
    <strong>{c.name}</strong>
    <span class="tagpill tag-note">{S.contactSource[c.source]}</span>
    {#if hint(c)}<span class="meta">{hint(c)}</span>{/if}
  </li>
{/snippet}

{#snippet verdict(group: number, d: Decision)}
  <div class="seg">
    <button aria-pressed={d === 'same'} data-action="same" onclick={(): void => answer(group, 'same')}>{S.sameBtn}</button>
    <button aria-pressed={d === 'different'} data-action="different" onclick={(): void => answer(group, 'different')}>{S.differentBtn}</button>
  </div>
{/snippet}

<section data-screen="import">
  <button class="back" onclick={closeImport}>&larr; {S.back}</button>
  <h2>{S.importTitle}</h2>
  <p class="muted">{S.importIntro}</p>

  <div class="import-row">
    <label class="file-btn">
      {S.chooseFiles}
      <input type="file" multiple accept=".vcf,.csv,.json" data-input="files" onchange={onPick} />
    </label>
    <label class="file-btn">
      {S.chooseFolder}
      <input type="file" multiple webkitdirectory data-input="folder" onchange={onPick} />
    </label>
  </div>
  {#if busy}<p class="muted" role="status">{S.reading}</p>{/if}

  {#if store.crm.lastImport}
    <button class="quiet" data-action="undo-import" onclick={undo}>{S.undoImport(store.crm.lastImport.added)}</button>
  {/if}
  {#if failed}<p class="warn" role="alert">{failed}</p>{/if}

  {#if plan}
    <h3 class="screen-title">{S.summaryTitle}</h3>
    <ul class="summary" data-part="files">
      {#each plan.files as f, i (i)}
        <li>{S.fileLine(f.name, f.format ? S.formatLabel[f.format] : S.fileUnknown, f.count, f.skipped)}</li>
      {/each}
    </ul>
    {#if extra.other}<p class="muted">{S.otherFiles(extra.other)}</p>{/if}
    {#if extra.tooBig}<p class="muted">{S.tooBigFiles(extra.tooBig)}</p>{/if}
    <p class="totals" data-part="totals">
      <span data-total="new">{S.totalNew(plan.fresh.length)}</span> ·
      <span data-total="already">{S.totalAlready(plan.alreadyHere)}</span> ·
      <span data-total="sure">{S.totalSure(sure.length)}</span> ·
      <span data-total="review">{S.totalReview(unsure.length)}</span>
    </p>

    {#each unsure as gi (gi)}
      <div class="card" data-group="review">
        <ul class="members">
          {#each plan.groups[gi].members as m (m)}{@render member(plan.combined[m])}{/each}
        </ul>
        {@render verdict(gi, decisionFor(plan, decisions, gi))}
      </div>
    {/each}

    {#if sure.length}
      <details class="card" data-part="sure">
        <summary>{S.mergedAuto(sure.length)}</summary>
        {#each sure as gi (gi)}
          <div class="sure-group">
            <ul class="members">
              {#each plan.groups[gi].members as m (m)}{@render member(plan.combined[m])}{/each}
            </ul>
            <button class="btn small ghost" data-action="different" aria-pressed={decisionFor(plan, decisions, gi) === 'different'}
              onclick={(): void => answer(gi, decisionFor(plan!, decisions, gi) === 'different' ? 'same' : 'different')}>{S.differentBtn}</button>
          </div>
        {/each}
      </details>
    {/if}

    <button class="btn" data-action="save-import" onclick={save}>{S.saveImport}</button>
  {/if}
</section>
