<script lang="ts">
  import { onDestroy } from 'svelte'
  import Avatar from './avatar.svelte'
  import { host } from './bridge'
  import { placesOf } from './desk'
  import type { DeskData } from './desk'
  import { initials, shownName } from './display'
  import EmptyState from './empty_state.svelte'
  import { openPerson } from './nav.svelte'
  import { centreOf, fetchPlace, geocodeQueue, geoKey, uncached } from './place_geo'
  import type { MapHandle, Pin } from './place_map'
  import { prefs, savePrefs } from './prefs.svelte'
  import { S } from './strings'
  import { liveTogetherPrefs } from '../../trustweb/src/together_prefs'

  interface Props {
    data: DeskData
  }
  const { data }: Props = $props()

  const AVATARS_SHOWN = 8
  const places = $derived(placesOf(data.view, data.values, prefs.close))
  const pins = $derived<Pin[]>(places.flatMap((g) => {
    const at = prefs.geo[geoKey(g.place)]
    return at ? [{ place: g.place, lat: at.lat, lon: at.lon, people: g.people.map((p) => ({ id: p.id, name: shownName(p.name), initials: initials(shownName(p.name)) })) }] : []
  }))
  const todo = $derived(uncached(prefs.geo, places.map((g) => g.place)))

  const queue = geocodeQueue({ now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), lookup: fetchPlace })
  let missed = $state<string[]>([])
  let waiting = $state<string[]>([])
  let confirming = $state(false)
  let progress = $state<{ done: number; of: number } | null>(null)

  async function locate(place: string): Promise<void> {
    waiting = [...waiting, place]
    const hit = await queue.add(place)
    waiting = waiting.filter((p) => p !== place)
    if (hit) { prefs.geo[geoKey(place)] = { ...hit, at: Date.now() }; savePrefs(); handle?.setView(centreOf([], prefs.geo, [place])) } else missed = [...missed, place]
  }
  async function locateAll(): Promise<void> {
    confirming = false
    const list = [...todo]
    progress = { done: 0, of: list.length }
    await Promise.all(list.map((p) => locate(p).then(() => { if (progress) progress = { ...progress, done: progress.done + 1 } })))
    progress = null
  }
  function cancel(): void { queue.cancel() }

  let box = $state<HTMLElement>()
  let handle: MapHandle | undefined
  let starting = false
  let inView = $state(false)
  $effect(() => {
    if (!box || typeof IntersectionObserver === 'undefined') return
    const watch = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { inView = true; watch.disconnect() } })
    watch.observe(box)
    return (): void => watch.disconnect()
  })
  $effect(() => {
    if (!box || !inView || handle || starting) return
    starting = true
    const view = centreOf(liveTogetherPrefs(host.record?.()?.togetherPrefs, Date.now()), prefs.geo, places.map((g) => g.place))
    void import('./place_map').then(({ createMap }) => createMap(box!, view, openPerson)).then((h) => { handle = h; h.setPins(pins) })
  })
  $effect(() => { const now = pins; handle?.setPins(now) })
  onDestroy(() => { queue.cancel(); handle?.destroy() })
</script>

<div class="desk-page" data-screen="desk-map">
  <h1 class="desk-title">{S.desk.mapTitle}</h1>
  <p class="desk-sub">{S.desk.mapNote}</p>
  <div class="desk-map" data-map bind:this={box} role="region" aria-label={S.desk.mapAria}></div>
  {#if places.length}
    <div class="desk-map-bar">
      {#if progress}
        <span class="desk-sub" data-map-progress>{S.desk.mapProgress(progress.done, progress.of)}</span>
        <button class="btn" onclick={cancel}>{S.desk.mapCancel}</button>
      {:else if confirming}
        <span class="desk-sub" data-map-confirm>{S.desk.mapConfirm(todo.length)}</span>
        <button class="btn" data-map-go onclick={(): Promise<void> => locateAll()}>{S.desk.mapContinue}</button>
        <button class="btn" onclick={(): void => { confirming = false }}>{S.desk.mapCancel}</button>
      {:else if todo.length}
        <button class="btn" data-map-all onclick={(): void => { confirming = true }}>{S.desk.mapLocateAll}</button>
      {/if}
    </div>
  {/if}
  {#each places as g (g.place)}
    {@const key = geoKey(g.place)}
    <section class="desk-place" data-place={g.place}>
      <h2 class="desk-card-title">{g.place} <span class="desk-count">{g.people.length}</span>
        {#if prefs.geo[key]}<span class="desk-sub">{S.desk.mapLocated}</span>
        {:else if missed.includes(g.place)}<span class="desk-sub">{S.desk.mapNotFound}</span>
        {:else}<button class="btn desk-locate" data-locate={g.place} disabled={waiting.includes(g.place)} onclick={(): Promise<void> => locate(g.place)}>{S.desk.mapLocate}</button>{/if}
      </h2>
      <div class="desk-faces">
        {#each g.people.slice(0, AVATARS_SHOWN) as p (p.id)}
          <button class="desk-link" title={shownName(p.name)} onclick={(): void => openPerson(p.id)}><Avatar id={p.id} name={shownName(p.name)} /><span class="desk-sub">{shownName(p.name)}</span></button>
        {/each}
      </div>
    </section>
  {:else}
    <EmptyState title={S.desk.mapEmpty} compact />
  {/each}
</div>
