/** Colour tags: tags (Tana checkbox fields) that colour a person on the Web view. Everyone is green; each tag a person has adds its own arc around the avatar. This device's choice, set in the Curator's Settings. */
import type { Person } from './model'
import { FAMILY_FIELD, isFamily } from './rings_layout'

export const COLOUR_TAGS_KEY = 'trustweb.v1.colourtags'
export const COLOUR_TAGS_EVENT = 'tw-colour-tags'
export const PERSON_GREEN = '#2e7d32'

export interface ColourTag { id: string; colour: string; label?: string }

/** Family is the preset: purple. */
export const FAMILY_PRESET: readonly ColourTag[] = [{ id: FAMILY_FIELD, colour: '#7b1fa2', label: 'family' }]

export function loadColourTags(): ColourTag[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLOUR_TAGS_KEY) ?? 'null') as ColourTag[] | null
    return Array.isArray(saved) ? saved.filter((t) => typeof t.id === 'string' && /^#[0-9a-f]{6}$/i.test(t.colour)) : [...FAMILY_PRESET]
  } catch {
    return [...FAMILY_PRESET]
  }
}

export function saveColourTags(tags: readonly ColourTag[]): void {
  try { localStorage.setItem(COLOUR_TAGS_KEY, JSON.stringify(tags)) } catch { /* browser refused: the Web view keeps the last choice */ }
  window.dispatchEvent(new Event(COLOUR_TAGS_EVENT))
}

const has = (p: Pick<Person, 'ring' | 'fields'>, id: string): boolean => (id === FAMILY_FIELD ? isFamily(p) : String(p.fields?.[id]) === 'true')

/** The colour tags a person has, in the order the tags were chosen. */
export const tagsOf = (p: Pick<Person, 'ring' | 'fields'>, tags: readonly ColourTag[]): ColourTag[] => tags.filter((t) => has(p, t.id))

export const tagColours = (p: Pick<Person, 'ring' | 'fields'>, tags: readonly ColourTag[]): string[] => tagsOf(p, tags).map((t) => t.colour)

/** Side-by-side arcs (never blended): a conic gradient of hard stops with a small gap, or null for an untagged person. */
export function arcsGradient(colours: readonly string[]): string | null {
  if (!colours.length) return null
  const step = 360 / colours.length
  const gap = colours.length > 1 ? 6 : 0
  return `conic-gradient(${colours.map((c, i) => `transparent ${i * step}deg ${i * step + gap / 2}deg, ${c} ${i * step + gap / 2}deg ${(i + 1) * step - gap / 2}deg, transparent ${(i + 1) * step - gap / 2}deg ${(i + 1) * step}deg`).join(', ')})`
}
