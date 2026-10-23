<script lang="ts">
  import { host } from './bridge'
  import DeskIcon from './desk_icon.svelte'
  import { focusFirst, menuKeys } from './desk_menu'
  import { View } from './nav'
  import { chooseView, prefs } from './prefs.svelte'
  import { S } from './strings'
  import { DEX_URL, viewChoices, viewLabel } from './view_pick'

  /** Wave 19 (Jakob 2026-10-23): Settings > View. Label left; right, a half pill with the current view and a chevron that opens the choices. */
  let open = $state(false)
  const views = viewChoices(host)

  function choose(v: View): void {
    open = false
    chooseView(v)
  }
</script>

<div class="fld view-row" data-view-row>
  <span>{S.views.label}</span>
  <div class="desk-menu-wrap" use:menuKeys={(): void => { open = false }}>
    <button class="view-pill" data-view-pill aria-haspopup="menu" aria-expanded={open} aria-label={`${S.views.pickAria}: ${viewLabel(prefs.view)}`} onclick={(): void => { open = !open }}>
      <span>{viewLabel(prefs.view)}</span><span class="view-pill-half" aria-hidden="true"><DeskIcon name="chevron" size={16} /></span>
    </button>
    {#if open}
      <div class="desk-menu" role="menu" aria-label={S.views.pickAria} use:focusFirst>
        {#each views as v (v)}
          <button role="menuitemradio" aria-checked={prefs.view === v} data-view={v} title={v === View.Desk ? S.views.dexAbout : undefined} aria-describedby={v === View.Desk ? 'view-dex-info' : undefined} onclick={(): void => choose(v)}>
            <span class="desk-check">{#if prefs.view === v}<DeskIcon name="check" size={16} />{/if}</span>{viewLabel(v)}
          </button>
        {/each}
        <p class="muted view-dex-info" id="view-dex-info" data-dex-info><a href={DEX_URL} target="_blank" rel="noopener">{S.views.dexInfo}</a></p>
      </div>
    {/if}
  </div>
</div>
