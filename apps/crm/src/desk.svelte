<script lang="ts">
  import { tick } from 'svelte'
  import { loadColourTags, tagsOf } from '../../trustweb/src/colour_tags'
  import type { Person as TwPerson } from '../../trustweb/src/model'
  import ContactPage from './contact_page.svelte'
  import DeskCompose from './desk_compose.svelte'
  import DeskHome from './desk_home.svelte'
  import DeskIcon from './desk_icon.svelte'
  import DeskKeepInTouch from './desk_keep_in_touch.svelte'
  import DeskMap from './desk_map.svelte'
  import DeskProfile from './desk_profile.svelte'
  import DeskSidebar from './desk_sidebar.svelte'
  import DeskStart from './desk_start.svelte'
  import DeskTopbar from './desk_topbar.svelte'
  import DeskWeb from './desk_web.svelte'
  import Environment from './environment.svelte'
  import Followups from './followups.svelte'
  import ImportContacts from './import_contacts.svelte'
  import People from './people.svelte'
  import PersonRow from './person_row.svelte'
  import Person from './person.svelte'
  import Settings from './settings.svelte'
  import SortPeople from './sort_people.svelte'
  import Timeline from './timeline.svelte'
  import { activityOf, deskStartPage, gettingStarted, keepInTouchDue, remindersDue } from './desk'
  import type { DeskData } from './desk'
  import { baseFields, passesFilters } from './fields'
  import type { FieldValues } from './fields'
  import { host } from './bridge'
  import { DeskPage } from './nav'
  import { nav, openPerson, showDeskPage } from './nav.svelte'
  import { effectivePerson, entityValues } from './person_view'
  import { prefs } from './prefs.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'

  // The Desk opens on the web (people list below) once the rings hold someone, else on Home with Getting started.
  showDeskPage(deskStartPage(store.app.people.length, host.renderRings !== undefined))

  let drawer = $state(false)
  let compose = $state<'reminder' | 'note' | null>(null)
  let root: HTMLElement

  const edits = (id: string): FieldValues | undefined => store.crm.personFields?.[id]
  const byId = $derived(new Map(store.app.people.map((p) => [p.id, p])))
  const valuesOf = (id: string): FieldValues => {
    const p = byId.get(id)
    return p ? entityValues(p, baseFields(p), edits(id)) : {}
  }
  /** One pass per change: the People list's own filter (hidden deceased, famous, sources ...) decides who the Desk lists; `now` is read inside, so a thing logged a second ago counts as past. */
  const data: DeskData = $derived.by(() => {
    const now = Date.now()
    // Field values once per person per pass: the filter, birthdays, groups, map and members all read them (700 people).
    const cache = new Map<string, FieldValues>()
    const values = (id: string): FieldValues => {
      let v = cache.get(id)
      if (!v) { v = valuesOf(id); cache.set(id, v) }
      return v
    }
    const people = store.app.people.filter((p) => passesFilters(values(p.id), prefs.filters, p)).map((p) => effectivePerson(p, edits(p.id)))
    const view = { app: { ...store.app, people }, crm: store.crm }
    const past = activityOf(view, now)
    const visible = new Set(people.map((p) => p.id))
    return { now, view, values, past, reminders: remindersDue(store.crm, now).filter((f) => visible.has(f.personId)), kit: keepInTouchDue(view, past, now) }
  })
  const people = $derived(data.view.app.people)
  const bell = $derived(data.reminders.length + data.kit.filter((r) => r.due).length)
  const steps = $derived(gettingStarted(data.view, prefs.pkms, window.matchMedia?.('(display-mode: standalone)').matches ?? false))

  const group = $derived(nav.deskGroup === null ? undefined : loadColourTags().find((t) => t.id === nav.deskGroup))
  const members = $derived(group ? people.filter((p) => tagsOf({ ring: p.ring, fields: data.values(p.id) as TwPerson['fields'] }, [group]).length > 0) : [])

  async function focusCommand(): Promise<void> {
    showDeskPage(DeskPage.Home)
    await tick()
    root.querySelector<HTMLElement>('[data-field="desk-command"]')?.focus()
  }

  /** Mounted and in the viewport: the host's closed sheet slides the Curator off-screen (and :host{all:initial} resets the inherited visibility), another sheet detaches it. */
  function onScreen(): boolean {
    const r = root.getBoundingClientRect()
    return root.checkVisibility() && r.bottom > 0 && r.top < window.innerHeight
  }

  /** "/" jumps to the search box unless the person is typing somewhere (the shadow root retargets event.target, so read the path), or the Desk is out of sight (the host's closed sheet keeps it mounted). */
  function slash(e: KeyboardEvent): void {
    const target = e.composedPath()[0] as HTMLElement
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || target.closest?.('input, textarea, select, [contenteditable]')) return
    if (!onScreen()) return
    e.preventDefault()
    root.querySelector<HTMLElement>('[data-field="desk-search"]')?.focus()
  }
</script>

<svelte:window onkeydown={slash} />

<div class="desk" data-screen="desk" bind:this={root}>
  <div class="desk-frame">
    <div class="desk-side" class:open={drawer}>
      <DeskSidebar {data} onnavigate={(): void => { drawer = false }} oncommand={focusCommand} />
    </div>
    {#if drawer}<button class="desk-scrim" aria-label={S.desk.nav.close} onclick={(): void => { drawer = false }}></button>{/if}
    <div class="desk-main">
    <DeskTopbar {people} {bell} onburger={(): void => { drawer = true }} oncompose={(k): void => { compose = k }} />
    <div class="desk-body">
    <div class="desk-centre">
      <div class="desk-centre-inner">
        {#if compose}<DeskCompose kind={compose} {people} onclose={(): void => { compose = null }} />{/if}
        {#if nav.sorting}
          <SortPeople />
        {:else if nav.importing}
          <ImportContacts />
        {:else if nav.contactId !== null}
          <ContactPage contactId={nav.contactId} />
        {:else if nav.environmentId !== null}
          <Environment environmentId={nav.environmentId} />
        {:else if nav.personId !== null}
          <Person personId={nav.personId} />
        {:else if nav.deskPage === DeskPage.Web}
          <DeskWeb />
        {:else if nav.deskPage === DeskPage.Home}
          <DeskHome {data} />
        {:else if nav.deskPage === DeskPage.Reminders}
          <Followups />
        {:else if nav.deskPage === DeskPage.Contacts && group}
          <div class="desk-page" data-screen="desk-group">
            <h1 class="desk-title">{S.desk.group(group.label ?? group.id)}</h1>
            <button class="quiet" data-action="desk-all-contacts" onclick={(): void => showDeskPage(DeskPage.Contacts)}>{S.desk.allContacts}</button>
            {#each members as p (p.id)}<PersonRow id={p.id} name={p.name} picture={p.theirProfile?.picture} context={p.context} onopen={openPerson} />{/each}
          </div>
        {:else if nav.deskPage === DeskPage.Contacts}
          <People />
        {:else if nav.deskPage === DeskPage.KeepInTouch}
          <DeskKeepInTouch {data} />
        {:else if nav.deskPage === DeskPage.Timeline}
          <Timeline />
        {:else if nav.deskPage === DeskPage.Map}
          <DeskMap {data} />
        {:else if nav.deskPage === DeskPage.Profile}
          <DeskProfile />
        {:else if nav.deskPage === DeskPage.Settings}
          <Settings />
        {:else}
          <div class="desk-page" data-screen="desk-help">
            <h1 class="desk-title">{S.desk.helpTitle}</h1>
            <p class="privacy">{S.privacy}</p>
            <button class="btn small" onclick={(): void => showDeskPage(DeskPage.Settings)}>{S.desk.helpSettings}</button>
          </div>
        {/if}
      </div>
    </div>
    <aside class="desk-right">
      {#if steps.some((s) => !s.done)}<DeskStart {steps} />{/if}
      <button class="desk-mapcard" data-action="desk-mapcard" onclick={(): void => showDeskPage(DeskPage.Map)}>
        <span class="desk-mapcard-text">
          <span class="desk-label">{S.desk.mapCard.label}</span>
          <strong>{S.desk.mapCard.text}</strong>
          <DeskIcon name="right" size={16} />
        </span>
        <svg class="desk-globe" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="60" cy="60" r="52" /><ellipse cx="60" cy="60" rx="22" ry="52" /><ellipse cx="60" cy="60" rx="40" ry="52" /><path d="M8 60h104M14 36h92M14 84h92" /></svg>
      </button>
    </aside>
    </div>
    </div>
  </div>
</div>
