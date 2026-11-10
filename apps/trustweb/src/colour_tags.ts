/** Colour tags: tags (Tana checkbox fields) that colour a person on the Web view. Everyone is green; each tag a person has adds its own arc around the avatar. This device's choice, set in the Curator's Settings. */
import type { Person } from './model'
import { FAMILY_FIELD, isFamily } from './rings_layout'

export const COLOUR_TAGS_KEY = 'trustweb.v1.colourtags'
export const COLOUR_TAGS_EVENT = 'tw-colour-tags'
export const PERSON_GREEN = 'var(--person-default)'   // warm amber by default, not green (Jakob 2026-10-15 16:10), now the token; the name stays for the callers

export interface ColourTag { id: string; colour: string; label?: string; /** Wave 39: a system tag (`import:<date>-<source>`, import_tags.ts): hidden everywhere unless Tools > "show system tags" is on. */ system?: boolean; /** Wave 28 (trustzones.ts communityTags): this tag is a #community node; the friends and community zone can add its holders. */ community?: boolean }

/** Family is the preset: purple. */
export const FAMILY_PRESET: readonly ColourTag[] = [{ id: FAMILY_FIELD, colour: '#7b1fa2', label: 'family' }]

/** Wave 39: the Tools toggle "show system tags" (a view choice of this device). */
export const SHOW_SYSTEM_TAGS_KEY = 'trustweb.v1.showsystemtags'
export const showSystemTags = (): boolean => { try { return localStorage.getItem(SHOW_SYSTEM_TAGS_KEY) === '1' } catch { return false } }
export function setShowSystemTags(on: boolean): void {
  try { if (on) localStorage.setItem(SHOW_SYSTEM_TAGS_KEY, '1'); else localStorage.removeItem(SHOW_SYSTEM_TAGS_KEY) } catch { /* browser refused: the toggle stays as it was */ }
  window.dispatchEvent(new Event(COLOUR_TAGS_EVENT))
}

function loadAll(): ColourTag[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLOUR_TAGS_KEY) ?? 'null') as ColourTag[] | null
    return Array.isArray(saved) ? saved.filter((t) => typeof t.id === 'string' && /^#[0-9a-f]{6}$/i.test(t.colour)) : [...FAMILY_PRESET]
  } catch {
    return [...FAMILY_PRESET]
  }
}

/** Wave 40: every tag, system ones too (the relation sources read the import tags whether or not the Tools toggle shows them). */
export const allColourTags = (): ColourTag[] => loadAll()

/** The tags the screens use; system tags only while the Tools toggle is on. */
export const loadColourTags = (): ColourTag[] => (showSystemTags() ? loadAll() : loadAll().filter((t) => t.system !== true))

/** Saves what the screens hold; system tags that were hidden meanwhile are kept, never lost. */
export function saveColourTags(tags: readonly ColourTag[]): void {
  const hidden = showSystemTags() ? [] : loadAll().filter((t) => t.system === true && !tags.some((x) => x.id === t.id))
  try { localStorage.setItem(COLOUR_TAGS_KEY, JSON.stringify([...tags, ...hidden])) } catch { /* browser refused: the Web view keeps the last choice */ }
  window.dispatchEvent(new Event(COLOUR_TAGS_EVENT))
}

/** Makes sure the system tag of an import exists (grey, labelled `#<id>`). */
export function defineSystemTag(id: string): void {
  const all = loadAll()
  if (all.some((t) => t.id === id)) return
  try { localStorage.setItem(COLOUR_TAGS_KEY, JSON.stringify([...all, { id, colour: '#9e9e9e', label: `#${id}`, system: true }])) } catch { /* browser refused: the tag stays undefined, the person still holds it */ }
}

const has = (p: Pick<Person, 'ring' | 'fields'>, id: string): boolean => (id === FAMILY_FIELD ? isFamily(p) : String(p.fields?.[id]) === 'true')
/** Wave 39: does this person carry that colour tag (the support ask's tag audience). */
export const hasColourTag = has

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
