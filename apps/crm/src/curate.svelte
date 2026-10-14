<script lang="ts">
  import { DEFAULT_NETWORK, networkNames } from './curation'
  import { curate, store } from './state.svelte'
  import { S } from './strings'

  const DAY = 86_400_000

  let name = $state('')
  let network = $state(DEFAULT_NETWORK)
  let from = $state(new Date().toISOString().slice(0, 10))
  let to = $state(new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10))

  const names = $derived(networkNames(store.crm.curation))
  const admins = $derived(store.crm.curation?.admins ?? [])
  const day = (at: number): string => new Date(at).toISOString().slice(0, 10)

  function addNetwork(): void {
    const n = name.trim()
    if (!n) return
    curate((c) => { c.byNetwork[n] ??= { person: { sections: {}, order: [] }, environment: { sections: {}, order: [] } } })
    network = n
    name = ''
  }

  function addAdmin(): void {
    const start = Date.parse(from)
    const end = Date.parse(to)
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return
    curate((c) => { c.admins = [...c.admins, { networkId: network, from: start, to: end + DAY - 1 }] })
  }

  function removeAdmin(i: number): void {
    curate((c) => { c.admins = c.admins.filter((_, n) => n !== i) })
  }
</script>

<h3 class="screen-title">{S.curateTitle}</h3>
<p class="muted">{S.curateHint}</p>
<div class="row-filter">
  <input class="field" type="text" aria-label={S.curateNetwork} placeholder={S.curateNetwork} data-field="network-name" bind:value={name} />
  <button class="btn small" data-action="add-network" onclick={addNetwork}>{S.curateAdd}</button>
</div>
<div class="row-filter">
  <select class="field" aria-label={S.curateNetwork} data-field="admin-network" bind:value={network}>
    {#each names as n (n)}<option value={n}>{n}</option>{/each}
  </select>
  <input class="field" type="date" aria-label={S.curateFrom} bind:value={from} />
  <input class="field" type="date" aria-label={S.curateTo} bind:value={to} />
  <button class="btn small" data-action="add-admin" onclick={addAdmin}>{S.curateAdmin}</button>
</div>
{#each admins as a, i (i)}
  <p class="line" data-part="admin">{S.curateAdminOf(a.networkId)}: {day(a.from)} – {day(a.to)}
    <button class="quiet" onclick={(): void => removeAdmin(i)}>{S.curateRemove}</button></p>
{/each}
