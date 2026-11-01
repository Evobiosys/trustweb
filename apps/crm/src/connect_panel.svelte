<script lang="ts">
  import { host } from './bridge'
  import { saveLink } from './connect_links'
  import { store } from './state.svelte'
  import { S as TW } from '../../trustweb/src/strings'
  import { ICONS } from '../../trustweb/src/icons'
  import { LINK_KINDS, linkEntries } from '../../trustweb/src/person_links'
  import type { LinkKind } from '../../trustweb/src/person_links'
  import type { Person } from '../../trustweb/src/model'

  const { person }: { person: Person } = $props()
  const GLYPH: Record<LinkKind, string> = { signal: ICONS.signal, whatsapp: ICONS.whatsapp, other: ICONS.web }

  let open = $state(false)
  let link = $state<string>(TW.cardConnectLoading)
  let editing = $state<LinkKind | null>(null)
  let draft = $state('')
  let bad = $state(false)
  let copied = $state(false)

  const entries = $derived(linkEntries(person))

  function toggle(): void {
    open = !open
    if (open) host.connectLink?.().then((u) => { link = u }, () => { link = TW.cardConnectNoLink })
  }
  function edit(kind: LinkKind): void { editing = kind; draft = person.links?.[kind] ?? ''; bad = false }
  function save(): void {
    if (editing === null) return
    if (!draft.trim() && !person.links?.[editing]) { editing = null; return }
    if (!saveLink(store.app.people, host, person.id, editing, draft)) { bad = true; return }
    editing = null
  }
  const copy = (): void => { void navigator.clipboard.writeText(link).then(() => { copied = true }) }
</script>

<div class="connect" data-part="connect">
  {#each entries as { kind, url } (kind)}
    <div class="connect-row" data-card-link={kind}>
      <span class="tl-glyph" aria-hidden="true">{@html GLYPH[kind]}</span>
      <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
      <button class="link" data-edit-link={kind} onclick={(): void => edit(kind)}>{TW.cardLinkEdit}</button>
      <button class="link" data-remove-link={kind} onclick={(): void => { saveLink(store.app.people, host, person.id, kind, '') }}>{TW.cardLinkRemove}</button>
    </div>
  {/each}
  {#if !person.peerId && host.connectLink}
    <p class="meta-line">{TW.cardNotConnectedLead(person.name)}<button class="link" data-action="connect" aria-expanded={open} onclick={toggle}>{TW.cardConnect}</button>{TW.cardNotConnectedTail}</p>
  {/if}
  {#if open}
    <div class="connect-panel" data-connect-panel={person.id}>
      <p class="connect-link" data-connect-link>{link}</p>
      <div class="add-actions">
        <button class="btn small ghost" data-connect-copy onclick={copy}>{copied ? TW.meetCopied : TW.cardCopy}</button>
        {#each LINK_KINDS as kind (kind)}<button class="btn small ghost" data-add-link={kind} onclick={(): void => edit(kind)}>{TW.cardAddLink[kind]}</button>{/each}
      </div>
      {#if editing}
        <div class="add-actions">
          <input class="field" type="url" maxlength="300" placeholder={TW.cardLinkPh} aria-label={TW.cardAddLink[editing]} data-link-input={editing} bind:value={draft} />
          <button class="btn small" data-link-save={editing} onclick={save}>{TW.tlSave}</button>
          <button class="btn small ghost" onclick={(): void => { editing = null }}>{TW.tlCancel}</button>
        </div>
        {#if bad}<p class="muted" role="alert">{TW.cardLinkBad}</p>{/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .connect-row { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 4px 0 }
  .connect-row a { flex: 1 1 auto; min-width: 0; word-break: break-all }
  .tl-glyph { display: inline-grid; place-items: center; width: 20px; height: 20px; flex-shrink: 0 }
  .connect-panel { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 10px }
  .connect-link { word-break: break-all; margin: 0 }
</style>
