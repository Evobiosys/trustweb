<script lang="ts">
  import { host } from './bridge'
  import { openPerson } from './nav.svelte'
  import People from './people.svelte'
  import { reloadRecord, store } from './state.svelte'
  import { S } from './strings'

  /** The host's rings are drawn 352 px square (trustweb ringsView); the block scales them to its width (352, or 520 on a wide Desk). */
  const RINGS = 352
  /** The lent rings stay in the host's light DOM (its stylesheet styles them) and show here through this slot of the Curator's shadow root. */
  const SLOT = 'desk-rings'

  let block: HTMLElement
  let rings: HTMLElement | undefined
  /** A drop on the rings changed the host's record: read it again and draw anew (the dragged dot moved itself). */
  let drawn = $state(0)
  const key = $derived(JSON.stringify(store.app.people.map((p) => [p.id, p.name, p.ring, p.angle, p.fields])))

  function fit(): void {
    if (!rings) return
    const k = block.clientWidth / RINGS
    rings.style.transform = `scale(${k})`
    block.style.height = `${RINGS * k}px`
  }

  $effect(() => {
    block.append(Object.assign(document.createElement('slot'), { name: SLOT }))
    const ro = new ResizeObserver(fit)
    ro.observe(block)
    return (): void => ro.disconnect()
  })

  $effect(() => {
    void key
    void drawn
    const el = host.renderRings?.({ onPick: openPerson, onRing: (): void => { reloadRecord(); drawn++ } })
    if (!el || !host.root) return
    Object.assign(el.style, { margin: '0', maxWidth: 'none', transformOrigin: '0 0' })
    el.slot = SLOT
    host.root.append(el)
    rings = el
    fit()
    return (): void => { el.remove(); if (rings === el) rings = undefined }
  })
</script>

<section class="desk-page desk-web" data-screen="desk-web" aria-label={S.desk.webAria}>
  <div class="desk-web-rings" data-part="desk-rings" bind:this={block}></div>
  <People />
</section>
