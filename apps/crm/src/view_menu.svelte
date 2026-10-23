<script lang="ts">
  import { host } from './bridge'
  import DeskIcon from './desk_icon.svelte'
  import { focusFirst, menuKeys } from './desk_menu'
  import { chooseView, prefs } from './prefs.svelte'
  import { S } from './strings'
  import { viewChoices, viewLabel } from './view_pick'
  import type { View } from './nav'

  interface Props {
    /** The class of the button: the classic header's round icon or the Desk's circle. */
    cls: string
  }
  const { cls }: Props = $props()

  let open = $state(false)
  const views = viewChoices(host)

  function choose(view: View): void {
    open = false
    chooseView(view)
  }
</script>

<div class="desk-menu-wrap" use:menuKeys={(): void => { open = false }}>
  <button class={cls} data-action="view-menu" aria-haspopup="menu" aria-expanded={open} aria-label={S.desk.switchView} title={S.desk.switchView} onclick={(): void => { open = !open }}>
    <DeskIcon name="chevron" size={18} />
  </button>
  {#if open}
    <div class="desk-menu" role="menu" aria-label={S.desk.switchView} use:focusFirst>
      {#each views as v (v)}
        <button role="menuitemradio" aria-checked={prefs.view === v} data-view={v} onclick={(): void => choose(v)}>
          <span class="desk-check">{#if prefs.view === v}<DeskIcon name="check" size={16} />{/if}</span>{viewLabel(v)}
        </button>
      {/each}
    </div>
  {/if}
</div>
