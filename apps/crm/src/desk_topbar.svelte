<script lang="ts">
  import type { Person } from '../../trustweb/src/model'
  import DeskIcon from './desk_icon.svelte'
  import DeskPick from './desk_pick.svelte'
  import { menuKeys, focusFirst } from './desk_menu'
  import { DeskPage } from './nav'
  import { nav, openImport, openPerson, showDeskPage } from './nav.svelte'
  import { S } from './strings'
  import ViewMenu from './view_menu.svelte'

  interface Props {
    people: readonly Person[]
    bell: number
    onburger: () => void
    oncompose: (kind: 'reminder' | 'note') => void
  }
  const { people, bell, onburger, oncompose }: Props = $props()

  let adding = $state(false)

  function compose(kind: 'reminder' | 'note'): void {
    adding = false
    oncompose(kind)
  }
</script>

<header class="desk-topbar">
  <button class="desk-circle desk-burger" data-action="desk-burger" aria-label={S.desk.nav.menu} onclick={onburger}><DeskIcon name="menu" /></button>
  <DeskPick {people} bind:query={nav.deskQuery} placeholder={S.desk.search} field="desk-search" icon onpick={openPerson} />
  <div class="desk-top-actions">
    <button class="desk-circle desk-bell" data-action="desk-bell" aria-label={`${S.desk.nav.reminders}: ${S.desk.bell(bell)}`} onclick={(): void => showDeskPage(DeskPage.Reminders)}>
      <DeskIcon name="bell" />{#if bell > 0}<span class="desk-badge" data-part="desk-bell-count">{bell}</span>{/if}
    </button>
    <div class="desk-menu-wrap" use:menuKeys={(): void => { adding = false }}>
      <button class="desk-circle" data-action="desk-add" aria-haspopup="menu" aria-expanded={adding} aria-label={S.desk.add} title={S.desk.add} onclick={(): void => { adding = !adding }}><DeskIcon name="plus" /></button>
      {#if adding}
        <div class="desk-menu" role="menu" aria-label={S.desk.add} use:focusFirst>
          <button role="menuitem" data-action="desk-add-import" onclick={(): void => { adding = false; openImport() }}>{S.desk.addImport}</button>
          <button role="menuitem" data-action="desk-add-reminder" onclick={(): void => compose('reminder')}>{S.desk.addReminder}</button>
          <button role="menuitem" data-action="desk-add-note" onclick={(): void => compose('note')}>{S.desk.addNote}</button>
        </div>
      {/if}
    </div>
    <ViewMenu cls="desk-circle" />
  </div>
</header>
