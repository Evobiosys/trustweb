<script lang="ts">
  import Avatar from './avatar.svelte'
  import { birthdayText, pointHref } from './contacts'
  import { ContactPointKind } from './model'
  import { closeContact } from './nav.svelte'
  import { store } from './state.svelte'
  import { S } from './strings'

  interface Props {
    contactId: string
  }
  const { contactId }: Props = $props()

  let expanded = $state(false)

  const contact = $derived((store.crm.contacts ?? []).find((c) => c.id === contactId))
  const origins = $derived([...new Set((contact?.sources ?? []).map((o) => S.contactSource[o.source]))].join(', '))
  const orgLine = $derived([contact?.title, contact?.org].filter(Boolean).join(', '))
</script>

<section class="person" data-screen="contact">
  <button class="back" onclick={closeContact}>&larr; {S.back}</button>
  {#if contact}
    <div class="person-head">
      <Avatar id={contact.id} name={contact.name} />
      <div>
        <h2>{contact.name}</h2>
        {#if orgLine}<p class="meta-line">{orgLine}</p>{/if}
        <p class="meta-line" data-part="from">{S.contactFrom(origins)}</p>
      </div>
    </div>

    <h3>{S.contactInfo}</h3>
    <button class="quiet contact-more" data-action="contact-info-toggle" aria-expanded={expanded} onclick={(): void => { expanded = !expanded }}>
      {expanded ? S.contactInfoHide : S.contactInfoShow}
    </button>
    {#if expanded}
      {#each contact.phones as v (v)}
        <div class="contact-row"><span class="contact-label">{S.contactPointLabel[ContactPointKind.Phone]}</span><a href={pointHref(ContactPointKind.Phone, v)}>{v}</a></div>
      {/each}
      {#each contact.emails as v (v)}
        <div class="contact-row"><span class="contact-label">{S.contactPointLabel[ContactPointKind.Email]}</span><a href={pointHref(ContactPointKind.Email, v)}>{v}</a></div>
      {/each}
      {#if contact.phones.length + contact.emails.length === 0}<p class="muted">{S.contactNoDetails}</p>{/if}
    {/if}

    {#if contact.birthday}
      <h3>{S.contactBirthday}</h3>
      <p>{birthdayText(contact.birthday, S.monthShort)}</p>
    {/if}
    {#if contact.labels.length}
      <p class="labels">{#each contact.labels as l (l)}<span class="tagpill tag-note">{l}</span> {/each}</p>
    {/if}
    {#if contact.note}
      <h3>{S.contactNote}</h3>
      <p class="note-text">{contact.note}</p>
    {/if}
  {:else}
    <p class="empty">{S.noPeople}</p>
  {/if}
</section>
