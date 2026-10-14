<script lang="ts">
  import EntityFields from './entity_fields.svelte'
  import { baseFields } from './fields'
  import { closeEnvironment } from './nav.svelte'
  import { Kind } from './placement'
  import { effectivePerson, entityValues } from './person_view'
  import { store } from './state.svelte'
  import { S } from './strings'

  interface Props {
    environmentId: string
  }
  const { environmentId }: Props = $props()

  type Env = { id: string; name: string; context: string }
  const raw = $derived(((store.app as { environments?: Env[] }).environments ?? []).find((e) => e.id === environmentId))
  const edits = $derived(store.crm.personFields?.[environmentId])
  const env = $derived(raw && effectivePerson(raw, edits))
  const values = $derived(raw ? entityValues(raw, baseFields(raw), edits) : {})
</script>

<section class="person" data-screen="environment">
  <button class="back" onclick={closeEnvironment}>&larr; {S.back}</button>
  {#if env}
    <h2>{env.name}</h2>
    <EntityFields kind={Kind.Environment} id={env.id} {values} />
  {:else}
    <p class="empty">{S.noEnvironments}</p>
  {/if}
</section>
