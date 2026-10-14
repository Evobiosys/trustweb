<script lang="ts">
  import { Kind, SECTIONS, Section, labelOf, layout } from './placement'
  import { placeField, placementFor, scopeChoices } from './placement.svelte'
  import { prefs, savePrefs } from './prefs.svelte'
  import { S } from './strings'

  let kind = $state<Kind>(Kind.Person)

  const lay = $derived(layout(kind, placementFor(kind), {}))
  const networks = $derived(scopeChoices())

  function toggleNetwork(n: string, on: boolean): void {
    prefs.scope = on ? [...prefs.scope, n] : prefs.scope.filter((x) => x !== n)
    savePrefs()
  }

  function setSection(key: string, section: Section): void {
    placeField(kind, {}, key, section, null)
  }

  function step(section: Section, i: number, dir: -1 | 1): void {
    const list = lay[section]
    const before = dir < 0 ? list[i - 1]?.id : (list[i + 2]?.id ?? null)
    if (before !== undefined) placeField(kind, {}, list[i].id, section, before)
  }
</script>

<h3 class="screen-title">{S.fieldsTitle}</h3>
<p class="muted">{S.fieldsHint}</p>
<div class="seg" role="group" aria-label={S.fieldsTitle}>
  <button aria-pressed={kind === Kind.Person} onclick={(): void => { kind = Kind.Person }}>{S.fieldsKindPerson}</button>
  <button aria-pressed={kind === Kind.Environment} onclick={(): void => { kind = Kind.Environment }}>{S.fieldsKindEnvironment}</button>
</div>
<div class="scope" data-part="scope">
  <label class="fld check"><input type="radio" name="scope" checked={prefs.scope.length === 0} onchange={(): void => { prefs.scope = []; savePrefs() }} /><span>{S.scopeMe}</span></label>
  <span class="muted">{S.scopeNetworks}</span>
  {#each networks as n (n)}
    <label class="fld check"><input type="checkbox" data-network={n} checked={prefs.scope.includes(n)} onchange={(e): void => toggleNetwork(n, e.currentTarget.checked)} /><span>{n}</span></label>
  {/each}
</div>
{#each SECTIONS as s (s)}
  <h4 class="ring-heading">{S.sectionLabel[s]} ({lay[s].length})</h4>
  {#each lay[s] as f, i (f.id)}
    <div class="frow" data-frow={f.id}>
      <span class="flabel">{labelOf(f, {})}</span>
      <select class="field" aria-label={f.label} value={s} onchange={(e): void => setSection(f.id, e.currentTarget.value as Section)}>
        {#each SECTIONS as o (o)}<option value={o}>{S.sectionLabel[o]}</option>{/each}
      </select>
      <button class="quiet" aria-label={S.up} disabled={i === 0} onclick={(): void => step(s, i, -1)}>▲</button>
      <button class="quiet" aria-label={S.down} disabled={i === lay[s].length - 1} onclick={(): void => step(s, i, 1)}>▼</button>
    </div>
  {/each}
{/each}
