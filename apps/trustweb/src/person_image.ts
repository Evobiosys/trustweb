// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28: a picture of a person (Person.image), a small JPEG data URL in the record so the card, the who-they-know entries and
 * the Network can show it at once. This phone only: sync_core.ts leaves it out (a Person travels whole, 674 people x ~15 KB would
 * swamp the sealed bundle and the relay hold). Look: image_store.ts shrink() does the scaling.
 */
import { generalNoteOf } from './general_notes'
import { shrink } from './image_store'
import type { Person } from './model'

export const PERSON_IMAGE_SIDE = 256
/** A stored picture is at most this many characters (about 30 KB of JPEG); localStorage holds the whole record. */
export const PERSON_IMAGE_MAX_LEN = 40_000
const QUALITIES = [0.7, 0.5, 0.35]

export const personImageOk = (v: unknown): v is string => typeof v === 'string' && v.length <= PERSON_IMAGE_MAX_LEN && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v)

/** The person as another device may receive it: no picture. The same object when there is none. */
export function withoutPersonImage<T extends Pick<Person, 'image'>>(p: T): T {
  if (!p.image) return p
  const { image: _drop, ...rest } = p
  void _drop
  return rest as T
}

/** What the who-they-know entry shows below the picture: the general note, else where we met; clipped to `max` with an ellipsis. */
export function notePreview(p: Parameters<typeof generalNoteOf>[0] & Pick<Person, 'context'>, max = 140): string {
  const t = (generalNoteOf(p).trim() || p.context?.trim() || '').replace(/\s+/g, ' ')
  return Array.from(t).length <= max ? t : Array.from(t).slice(0, max - 1).join('') + '…'
}

const readUrl = (b: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = (): void => resolve(String(r.result))
  r.onerror = (): void => reject(r.error)
  r.readAsDataURL(b)
})

/** A chosen or photographed file as a stored picture (256 px JPEG, lowering the quality until it fits the cap), or null: not an image, or too big even so. */
export async function pictureFromFile(file: Blob): Promise<string | null> {
  for (const q of QUALITIES) {
    const url = await readUrl(await shrink(file, PERSON_IMAGE_SIDE, q)).catch(() => '')
    if (personImageOk(url)) return url
  }
  return null
}
