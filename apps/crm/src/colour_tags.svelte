<script lang="ts">
  import { COLOUR_TAGS_KEY, loadColourTags, saveColourTags } from '../../trustweb/src/colour_tags'
  import { OLD_INTENDING_KEY, HIDE_KEY } from './fields'
  import { PERSON_FIELDS } from './person_fields'
  import { S } from './strings'

  const FIELDS = PERSON_FIELDS.filter((f) => f.type === 'checkbox' && f.id !== OLD_INTENDING_KEY && f.id !== HIDE_KEY)
  const FRESH = ['#e65100', '#0277bd', '#c2185b', '#6d4c41', '#00838f']
  let tags = $state(loadColourTags())

  function set(next: typeof tags): void { tags = next; saveColourTags(next) }
  const colourOf = (id: string): string | undefined => tags.find((t) => t.id === id)?.colour
  const toggle = (id: string, on: boolean): void => set(on ? [...tags, { id, colour: FRESH[tags.length % FRESH.length], label: PERSON_FIELDS.find((f) => f.id === id)?.label }] : tags.filter((t) => t.id !== id))
  const recolour = (id: string, colour: string): void => set(tags.map((t) => (t.id === id ? { ...t, colour } : t)))
</script>

<h3 class="screen-title" data-part="colour-tags-title" data-key={COLOUR_TAGS_KEY}>{S.colourTagsTitle}</h3>
<p class="muted">{S.colourTagsHint}</p>
{#each FIELDS as f (f.id)}
  <div class="fld check">
    <input type="checkbox" data-colour-tag={f.id} aria-label={f.label} checked={colourOf(f.id) !== undefined} onchange={(e): void => toggle(f.id, e.currentTarget.checked)} />
    <span>{f.label}</span>
    {#if colourOf(f.id)}<input type="color" data-colour-of={f.id} aria-label={S.colourOf(f.label)} value={colourOf(f.id)} onchange={(e): void => recolour(f.id, e.currentTarget.value)} />{/if}
  </div>
{/each}
