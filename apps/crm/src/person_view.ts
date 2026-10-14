/** What the three person views read: merged values, the person with the user's own edits laid over, the TrustWeb icon and the favourite way to connect. Pure. */
import { channelLink } from '../../trustweb/src/channel'
import { Channel } from '../../trustweb/src/model'
import type { Person, Ring } from '../../trustweb/src/model'
import { MET_THROUGH_KEY, baseFields, isSet, mergedFields, valueText } from './fields'
import type { FieldValues } from './fields'
import { ContactPointKind } from './model'
import type { ContactPoint } from './model'
import { LAST_NAME_KEY } from './placement'

const EMAIL_KEY = 'Bxw7k4FWptqp'
const DAY = 86_400_000
export const DEFAULT_ACTIVITY_DAYS = 7

/** "Anna Maria Beispiel" -> first "Anna Maria", last "Beispiel"; one word is a first name. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length < 2 ? { first: parts[0] ?? '', last: '' } : { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

/** The record's values, the name split where Given/Last are empty, and the person's own edits on top. */
export function entityValues(entity: Pick<Person, 'name' | 'context'> & { ring?: Ring }, base: FieldValues | undefined, edits: FieldValues | undefined): FieldValues {
  const { first, last } = splitName(entity.name)
  const own = { 'tw-first': first, 'tw-context': entity.context, ...(entity.ring ? { 'tw-ring': entity.ring } : {}), ...(last ? { [LAST_NAME_KEY]: last } : {}) }
  return mergedFields({ ...own, ...base }, edits)
}

/** A person with name, context and ring as the person's edits say. */
export function effectivePerson<T extends Pick<Person, 'name' | 'context'> & { ring?: Ring }>(p: T, edits: FieldValues | undefined): T {
  if (!edits) return p
  const v = entityValues(p, baseFields(p), edits)
  const name = 'tw-first' in edits || LAST_NAME_KEY in edits ? [valueText(v['tw-first']), valueText(v[LAST_NAME_KEY])].filter(Boolean).join(' ') : p.name
  return { ...p, name: name || p.name, context: valueText(v['tw-context']), ...(p.ring ? { ring: (v['tw-ring'] === 'family' ? 'unsorted' : v['tw-ring']) as Ring } : {}) }
}

/** Any contact so far: met through someone, a first-met date, an interaction or a note line (the ring markers are no notes). */
export function inContact(person: Pick<Person, 'id' | 'lines'>, values: FieldValues, interactions: readonly { personId: string }[]): boolean {
  return isSet(values[MET_THROUGH_KEY]) || (person as { firstMet?: boolean }).firstMet === true
    || interactions.some((i) => i.personId === person.id) || person.lines.some((l) => l.tag === 'note' && !l.text.startsWith('ring: '))
}

export enum Presence {
  None = 'none',
  Idle = 'idle',
  Active = 'active',
}

/** Not connected on TrustWeb: none; connected and active within the window: filled circle; else hollow. */
export function presence(person: Pick<Person, 'peerId'>, lastPastAt: number | undefined, days: number, now: number): Presence {
  if (!person.peerId) return Presence.None
  return lastPastAt !== undefined && lastPastAt >= now - days * DAY ? Presence.Active : Presence.Idle
}

export interface FavLink {
  href: string
  symbol: string
  label: string
  /** The address or number behind the symbol: tooltip only. */
  title: string
}

const SYMBOL: Record<string, string> = { email: '✉', phone: '☎', sms: '💬', signal: '🔒', whatsapp: '🟢', matrix: '🔷' }
const CHANNEL: Record<string, Channel> = { signal: Channel.Signal, whatsapp: Channel.WhatsApp, matrix: Channel.Matrix }

/** The tappable deep link of the favourite way to connect, or null when it is unset or the person has no address for it. */
export function favLink(person: Pick<Person, 'channels'>, values: FieldValues, points: readonly ContactPoint[] = []): FavLink | null {
  const way = valueText(values['tw-fav'])
  const phone = points.find((p) => p.kind === ContactPointKind.Phone)?.value.replace(/[^\d+]/g, '')
  const email = valueText(values[EMAIL_KEY]) || points.find((p) => p.kind === ContactPointKind.Email)?.value
  const handle = way in CHANNEL ? person.channels?.[CHANNEL[way]] : undefined
  const href = way === 'email' ? email && `mailto:${email}`
    : way === 'phone' ? phone && `tel:${phone}`
      : way === 'sms' ? phone && `sms:${phone}`
        : handle && channelLink(CHANNEL[way], handle)
  return href ? { href, symbol: SYMBOL[way], label: way, title: href.replace(/^\w+:/, '') } : null
}
