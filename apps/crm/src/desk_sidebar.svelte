<script lang="ts">
  import { COLOUR_TAGS_EVENT, loadColourTags, tagsOf } from '../../trustweb/src/colour_tags'
  import type { Person } from '../../trustweb/src/model'
  import Avatar from './avatar.svelte'
  import { deskPages, favoriteIds, shownGroups } from './desk'
  import type { DeskData } from './desk'
  import DeskIcon from './desk_icon.svelte'
  import DeskLogo from './desk_logo.svelte'
  import { shownName } from './display'
  import { DeskPage } from './nav'
  import { nav, openEnvironment, openImport, openPerson, showDeskPage } from './nav.svelte'
  import { prefs, savePrefs } from './prefs.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'

  interface Props {
    data: DeskData
    /** A press that navigates also closes the drawer. */
    onnavigate: () => void
    /** The >_ button: Home with the command box focused. */
    oncommand: () => void
  }
  const { data, onnavigate, oncommand }: Props = $props()

  const pages = $derived(deskPages(prefs.view))

  type EnvEntity = { id: string; name: string }
  let tags = $state(loadColourTags())
  $effect(() => {
    const reload = (): void => { tags = loadColourTags() }
    window.addEventListener(COLOUR_TAGS_EVENT, reload)
    return (): void => window.removeEventListener(COLOUR_TAGS_EVENT, reload)
  })

  const overlay = $derived(nav.sorting || nav.importing || nav.contactId !== null || nav.environmentId !== null || nav.personId !== null)
  const people = $derived(data.view.app.people)
  const favorites = $derived(favoriteIds(prefs.favorites, store.crm.merges).map((id) => people.find((p) => p.id === id)).filter((p): p is Person => p !== undefined))
  const groups = $derived(shownGroups(tags.map((t) => ({ tag: t, count: people.filter((p) => tagsOf({ ring: p.ring, fields: data.values(p.id) as Person['fields'] }, [t]).length > 0).length }))))
  const environments = $derived((store.app as { environments?: EnvEntity[] }).environments ?? [])

  const go = (act: () => void): void => { act(); onnavigate() }
</script>

<nav class="desk-nav" aria-label={S.desk.nav.label}>
  <div class="desk-logo-row">
    <span class="desk-brand"><DeskLogo />{S.desk.brand}</span>
    <button class="desk-icon-btn" data-action="desk-command" aria-label={S.desk.commandPh} title={S.desk.commandPh} onclick={(): void => go(oncommand)}><DeskIcon name="terminal" /></button>
  </div>
  <ul class="desk-items">
    {#each pages as item (item.page)}
      <li><button class="desk-item" class:desk-sub-item={item.sub} data-desk-page={item.page} aria-current={!overlay && nav.deskPage === item.page && nav.deskGroup === null ? 'page' : undefined} onclick={(): void => go(() => showDeskPage(item.page))}>
        {#if !item.sub}<DeskIcon name={item.icon} />{/if}{item.label}
      </button></li>
    {/each}
  </ul>

  {#if favorites.length > 0}
  <h3 class="desk-label">{S.desk.favorites}</h3>
  <ul class="desk-items" data-part="desk-favorites">
    {#each favorites as p (p.id)}
      <li><button class="desk-item" onclick={(): void => go(() => openPerson(p.id))}><Avatar id={p.id} name={shownName(p.name)} />{shownName(p.name)}</button></li>
    {/each}
  </ul>
  {/if}

  {#if groups.length > 0 || environments.length > 0}
  <h3 class="desk-label"><button class="desk-fold" data-action="fold-groups" aria-expanded={!prefs.sidebarGroupsFolded} aria-controls="desk-groups" onclick={(): void => { prefs.sidebarGroupsFolded = !prefs.sidebarGroupsFolded; savePrefs() }}>{S.desk.groups}<span class="desk-fold-chev" aria-hidden="true"><DeskIcon name="chevron" size={14} /></span></button></h3>
  {#if !prefs.sidebarGroupsFolded}
  <ul class="desk-items" id="desk-groups" data-part="desk-groups">
    {#each groups as g (g.tag.id)}
      <li><button class="desk-item" data-group={g.tag.id} aria-current={!overlay && nav.deskGroup === g.tag.id ? 'page' : undefined} onclick={(): void => go(() => showDeskPage(DeskPage.Contacts, g.tag.id))}>
        <span class="desk-dot-colour" style:background={g.tag.colour}></span>{g.tag.label ?? g.tag.id}<span class="desk-count">{g.count}</span>
      </button></li>
    {/each}
    {#each environments as e (e.id)}
      <li><button class="desk-item" onclick={(): void => go(() => openEnvironment(e.id))}><DeskIcon name="map" size={16} />{e.name}</button></li>
    {/each}
  </ul>
  {/if}
  {/if}

  <ul class="desk-items desk-bottom">
    <li><button class="desk-item" data-desk-page={DeskPage.Settings} onclick={(): void => go(() => showDeskPage(DeskPage.Settings))}><DeskIcon name="gear" />{S.desk.nav.settings}</button></li>
    <li><button class="desk-item" data-desk-page="import" onclick={(): void => go(openImport)}><DeskIcon name="import" />{S.desk.nav.import}</button></li>
    <li><button class="desk-item" data-desk-page={DeskPage.Help} onclick={(): void => go(() => showDeskPage(DeskPage.Help))}><DeskIcon name="help" />{S.desk.nav.help}</button></li>
  </ul>
</nav>
