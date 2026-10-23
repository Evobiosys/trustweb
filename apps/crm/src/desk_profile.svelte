<script lang="ts">
  import { host } from './bridge'
  import { S } from './strings'

  /** The lent editor stays in the host's light DOM (its stylesheet styles it) and shows here through this slot of the Curator's shadow root, as the Web page's rings do. */
  const SLOT = 'desk-profile'
  let block: HTMLElement

  $effect(() => {
    const el = host.renderProfile?.()
    if (!el || !host.root) return
    block.append(Object.assign(document.createElement('slot'), { name: SLOT }))
    el.slot = SLOT
    host.root.append(el)
    return (): void => el.remove()
  })
</script>

<section class="desk-page desk-profile-page" data-screen="desk-profile" aria-label={S.desk.profile.title} bind:this={block}></section>
