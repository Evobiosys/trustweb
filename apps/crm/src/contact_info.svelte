<script lang="ts">
  import { CHANNELS } from '../../trustweb/src/model'
  import type { Person } from '../../trustweb/src/model'
  import { channelLink } from '../../trustweb/src/channel'
  import { pointHref } from './contacts'
  import { ContactPointKind } from './model'
  import { addContactPoint, removeContactPoint, store } from './state.svelte'
  import { S } from './strings'

  interface Props {
    person: Person
  }
  const { person }: Props = $props()

  const MIN_PHONE_DIGITS = 5

  let expanded = $state(false)
  let adding = $state<ContactPointKind | null>(null)
  let draft = $state('')
  let invalid = $state(false)

  const known = $derived(CHANNELS.filter((ch) => !!person.channels?.[ch]))
  const shown = $derived(expanded ? CHANNELS : known)
  const points = $derived(store.crm.contactPoints[person.id] ?? [])
  const nothing = $derived(!expanded && known.length === 0 && points.length === 0)

  function isValid(kind: ContactPointKind, value: string): boolean {
    if (kind === ContactPointKind.Phone) return value.replace(/\D/g, '').length >= MIN_PHONE_DIGITS
    return /^[^\s@]+@[^\s@]+$/.test(value)
  }

  function toggle(): void {
    expanded = !expanded
    if (!expanded) cancel()
  }

  function startAdd(kind: ContactPointKind): void {
    adding = kind
    draft = ''
    invalid = false
  }

  function cancel(): void {
    adding = null
    draft = ''
    invalid = false
  }

  function submit(e: SubmitEvent): void {
    e.preventDefault()
    if (adding === null) return
    const value = draft.trim()
    if (!isValid(adding, value)) {
      invalid = true
      return
    }
    addContactPoint(person.id, adding, value)
    cancel()
  }
</script>

<h3>{S.contactInfo}</h3>
{#each shown as ch (ch)}
  {@const value = person.channels?.[ch]}
  <div class="contact-row">
    <span class="contact-label">{S.chLabel[ch]}</span>
    {#if value}
      <a href={channelLink(ch, value)} target="_blank" rel="noopener">{S.openIn(S.chLabel[ch])}</a>
    {:else}
      <span class="muted">{S.channelEmpty}</span>
    {/if}
  </div>
{/each}
{#each points as point, i (i)}
  <div class="contact-row">
    <span class="contact-label">{S.contactPointLabel[point.kind]}</span>
    <a href={pointHref(point.kind, point.value)}>{point.value}</a>
    {#if expanded}
      <button class="quiet" aria-label={S.removeNamed(point.value)} onclick={(): void => removeContactPoint(person.id, i)}>{S.remove}</button>
    {/if}
  </div>
{/each}
{#if nothing}<p class="muted">{S.contactInfoNone}</p>{/if}

{#if expanded}
  <div class="contact-actions">
    <button class="btn small ghost" onclick={(): void => startAdd(ContactPointKind.Phone)}>{S.addPhone}</button>
    <button class="btn small ghost" onclick={(): void => startAdd(ContactPointKind.Email)}>{S.addEmail}</button>
  </div>
  {#if adding !== null}
    <form class="inline-form" onsubmit={submit}>
      <input
        class="field"
        type={adding === ContactPointKind.Phone ? 'tel' : 'email'}
        placeholder={S.contactPointPh[adding]}
        aria-label={S.contactPointAria(S.contactPointLabel[adding])}
        bind:value={draft}
      />
      {#if invalid}<p class="warn" role="alert">{S.contactPointBad[adding]}</p>{/if}
      <div class="form-actions">
        <button class="btn small" type="submit">{S.save}</button>
        <button class="quiet" type="button" onclick={cancel}>{S.cancel}</button>
      </div>
    </form>
  {/if}
{/if}
<button class="quiet contact-more" aria-expanded={expanded} onclick={toggle}>
  {expanded ? S.contactInfoLess : S.contactInfoMore}
</button>
