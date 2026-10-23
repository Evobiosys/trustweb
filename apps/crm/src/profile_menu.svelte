<script lang="ts">
  import { onMount } from 'svelte'
  import { host } from './bridge'
  import { focusFirst, menuKeys } from './desk_menu'
  import { initials } from './display'
  import { DeskPage } from './nav'
  import { showDeskPage } from './nav.svelte'
  import { ProfileItem, profileItems } from './profile_menu'
  import { store } from './state.svelte'
  import { S } from './strings'

  let open = $state(false)
  let picture = $state(host.myPicture?.())
  onMount(() => {
    const refresh = (): void => { picture = host.myPicture?.() }
    window.addEventListener('tw:picture-changed', refresh)
    return (): void => window.removeEventListener('tw:picture-changed', refresh)
  })
  const items = profileItems(host)
  const label: Record<ProfileItem, string> = { [ProfileItem.Profile]: S.desk.profile.mine, [ProfileItem.Settings]: S.desk.profile.settings, [ProfileItem.Phone]: S.desk.profile.phone, [ProfileItem.Close]: S.desk.profile.close }

  function choose(item: ProfileItem): void {
    open = false
    if (item === ProfileItem.Profile) showDeskPage(DeskPage.Profile)
    else if (item === ProfileItem.Settings) showDeskPage(DeskPage.Settings)
    else if (item === ProfileItem.Phone) host.showPhoneVersion?.()
    else host.closeDesk?.()
  }
</script>

<div class="desk-menu-wrap" use:menuKeys={(): void => { open = false }}>
  <button class="desk-circle desk-profile" data-profile-button aria-haspopup="menu" aria-expanded={open} aria-label={S.desk.profile.button} title={S.desk.profile.button} onclick={(): void => { open = !open }}>{#if picture}<img class="desk-profile-pic" src={picture} alt="" />{:else}{initials(store.app.me.displayName)}{/if}</button>
  {#if open}
    <div class="desk-menu" role="menu" aria-label={S.desk.profile.button} use:focusFirst>
      {#each items as item (item)}<button role="menuitem" data-profile-item={item} onclick={(): void => choose(item)}>{label[item]}</button>{/each}
    </div>
  {/if}
</div>
