// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails (opt-in, local only): which contact a picture belongs to by a phone number in its file or folder name (WhatsApp exports
 * name chats and files after the number). Reads the contacts already on this device; never asks WhatsApp or anything else. Pure.
 */
import type { Person } from '../../model'

const RUN = /\+?\d[\d \-().]*\d/g
const PHONE_FIELD = /phone|mobile|tel|handy/i

/** Digits of every number-like run in `text`: with + or 00 (international), with a leading 0 (national), or a bare run of 10 to 15 digits. */
export function digitsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(RUN)) {
    const raw = m[0]
    const digits = raw.replace(/\D/g, '')
    const d = raw.startsWith('+') ? digits : digits.startsWith('00') ? digits.slice(2) : digits.startsWith('0') ? digits : /^\d{10,15}$/.test(raw) ? digits : ''
    if (d.length >= 7 && d.length <= 15) out.push(d)
  }
  return out
}

/** The numbers a contact has: their channel values and any field that names a phone. */
export const phonesOf = (p: Pick<Person, 'channels' | 'fields'>): string[] => [
  ...Object.values(p.channels ?? {}).flatMap((v) => digitsIn(String(v))),
  ...Object.entries(p.fields ?? {}).filter(([k]) => PHONE_FIELD.test(k)).flatMap(([, v]) => digitsIn(String(v))),
]

/** Equal, or one side is written nationally (leading 0) and is the end of the other. */
function same(a: string, b: string): boolean {
  if (a === b) return true
  const [nat, intl] = a.startsWith('0') ? [a, b] : b.startsWith('0') ? [b, a] : ['', '']
  return nat.length > 7 && !intl.startsWith('0') && intl.endsWith(nat.slice(1))
}

/** The one contact whose number the path carries; none when no number matches or two contacts do. */
export function phoneHint(path: string, people: readonly Pick<Person, 'id' | 'channels' | 'fields'>[]): string | undefined {
  const found = digitsIn(path)
  if (!found.length) return undefined
  const hits = people.filter((p) => phonesOf(p).some((c) => found.some((d) => same(d, c))))
  return hits.length === 1 ? hits[0].id : undefined
}
