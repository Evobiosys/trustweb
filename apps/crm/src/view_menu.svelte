<script lang="ts">
  import { host } from './bridge'
  import DeskIcon from './desk_icon.svelte'
  import { focusFirst, menuKeys } from './desk_menu'
  import { View } from './nav'
  import { prefs, savePrefs } from './prefs.svelte'
  import { S } from './strings'

  interface Props {
    /** The class of the button: the classic header's round icon or the Desk's circle. */
    cls: string
  }
  const { cls }: Props = $props()

  let open = $state(false)
  const rings = $derived(host.showRings)

  function choose(view: View): void {
    prefs.view = view
    savePrefs()
    open = false
  }

  function membranes(): void {
    open = false
    rings?.()
  }
</script>

<div class="desk-menu-wrap" use:menuKeys={(): void => { open = false }}>
  <button class={cls} data-action="view-menu" aria-haspopup="menu" aria-expanded={open} aria-label={S.desk.switchView} title={S.desk.switchView} onclick={(): void => { open = !open }}>
    <DeskIcon name="chevron" size={18} />
  </button>
  {#if open}
    <div class="desk-menu" role="menu" aria-label={S.desk.switchView} use:focusFirst>
      <button role="menuitemradio" aria-checked={prefs.view === View.Desk} data-view="desk" onclick={(): void => choose(View.Desk)}>
        <span class="desk-check">{#if prefs.view === View.Desk}<DeskIcon name="check" size={16} />{/if}</span>{S.views.desk}
      </button>
      <button role="menuitem" aria-disabled={rings ? undefined : 'true'} title={rings ? undefined : S.desk.openInside} data-view="membranes" onclick={rings ? membranes : undefined}>
        <span class="desk-check"></span>{S.views.membranes}
      </button>
      <button role="menuitemradio" aria-checked={prefs.view === View.Classic} data-view="classic" onclick={(): void => choose(View.Classic)}>
        <span class="desk-check">{#if prefs.view === View.Classic}<DeskIcon name="check" size={16} />{/if}</span>{S.views.classic}
      </button>
    </div>
  {/if}
</div>
